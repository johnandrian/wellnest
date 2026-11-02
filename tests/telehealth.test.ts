import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api } from "../convex/_generated/api";
import { Id } from "../convex/_generated/dataModel";
import { testProvider } from "../convex/lib/telehealth";
import { cortexCalls, createAppUser, messagesOf, mockApis, pushSends, setEnv, setup } from "./helpers";

// 10:00 in Los Angeles.
const NOW = Date.parse("2026-11-02T18:00:00Z");
const MIN = 60_000;
const TOKEN = "ExponentPushToken[aaaaaaaaaaaaaaaaaaaaaa]";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  setEnv();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

// Runs what's due now without jumping ahead to scheduled reminders or expiries.
const settle = (t: ReturnType<typeof setup>) => t.finishAllScheduledFunctions(() => vi.advanceTimersByTime(1));
const advance = async (t: ReturnType<typeof setup>, ms: number) => {
  vi.advanceTimersByTime(ms);
  await settle(t);
};
const visitsOf = (t: ReturnType<typeof setup>) => t.run((ctx) => ctx.db.query("appointments").collect());
const toolCall = (args: object) => ({
  content: null,
  tool_calls: [{ id: "v1", type: "function", function: { name: "suggest_telehealth", arguments: JSON.stringify(args) } }],
});

async function user(t: ReturnType<typeof setup>) {
  const u = await createAppUser(t);
  await u.as.mutation(api.chat.setTimeZone, { timeZone: "America/Los_Angeles", utcOffsetMin: -480 });
  await u.as.mutation(api.push.register, { token: TOKEN, platform: "ios" });
  return u;
}

async function offered(t: ReturnType<typeof setup>) {
  const u = await user(t);
  const id = await u.as.mutation(api.telehealth.request, { reason: "Burning when urinating for 2 days", urgency: "today" });
  await settle(t);
  return { ...u, id: id as Id<"appointments"> };
}

describe("test provider", () => {
  test("offers three half-hour slots at least 20 minutes out, and books by slot id", async () => {
    const slots = await testProvider.findSlots({ reason: "x", urgency: "today", language: "en", now: NOW });
    expect(slots.map((s) => new Date(s.startsAt).toISOString())).toEqual(["2026-11-02T18:30:00.000Z", "2026-11-02T19:00:00.000Z", "2026-11-02T19:30:00.000Z"]);
    expect(await testProvider.book({ slotId: slots[0].id, reason: "x", summary: "x", language: "en", patient: {} })).toMatchObject({ startsAt: slots[0].startsAt });
  });
});

describe("telehealth flow", () => {
  test("a request posts the times in the chat and pushes; nothing is booked yet", async () => {
    const t = setup();
    const { calls } = mockApis();
    const { userId, as, id } = await offered(t);
    const [visit] = await visitsOf(t);
    expect(visit).toMatchObject({ status: "suggested", provider: "test", providerName: "Test clinic (not real)" });
    expect(visit.slots).toHaveLength(3);
    const msg = (await messagesOf(t, userId)).find((m) => m.kind === "appointment")!;
    expect(msg).toMatchObject({ appointmentId: id, channel: "app" });
    expect(msg.text).toContain("Test clinic (not real) has: 10:30 AM (Dr. Rivera (test))");
    expect(pushSends(calls)).toMatchObject([{ title: "Video visit suggested", body: "First available at 10:30 AM. Open Wellnest to pick a time.", channelId: "appointments" }]);
    expect((await as.query(api.telehealth.get, { id }))!).toMatchObject({ status: "suggested", testProvider: true, joinUrl: null });
  });

  test("confirming a time books it, pushes, reminds 15 minutes before, and shows the join link", async () => {
    const t = setup();
    const { calls } = mockApis();
    const { as, id } = await offered(t);
    const slot = (await visitsOf(t))[0].slots[1];
    await as.mutation(api.telehealth.confirm, { id, slotId: slot.id });
    await settle(t);
    const visit = (await as.query(api.telehealth.get, { id }))!;
    expect(visit).toMatchObject({ status: "booked", startsAt: slot.startsAt, joinUrl: expect.stringContaining("https://example.com/wellnest-test-visit/") });
    expect(pushSends(calls).at(-1)).toMatchObject({ title: "Video visit booked", body: "Dr. Chen (test) at 11:00 AM. We'll remind you 15 minutes before." });
    expect((await as.query(api.telehealth.current))!._id).toBe(id);

    await advance(t, slot.startsAt - 15 * MIN - Date.now());
    expect(pushSends(calls).at(-1)).toMatchObject({ title: "Your video visit starts soon", data: { url: visit.joinUrl } });
  });

  test("cancelling a booked visit cancels the reminder; Not now just dismisses offered times", async () => {
    const t = setup();
    const { calls } = mockApis();
    const { as, id } = await offered(t);
    const slot = (await visitsOf(t))[0].slots[0];
    await as.mutation(api.telehealth.confirm, { id, slotId: slot.id });
    await settle(t);
    await as.mutation(api.telehealth.cancel, { id });
    await settle(t);
    expect((await as.query(api.telehealth.get, { id }))!.status).toBe("cancelled");
    const sent = pushSends(calls).length;
    await advance(t, 60 * MIN);
    expect(pushSends(calls)).toHaveLength(sent); // no "starts soon"

    const t2 = setup();
    mockApis();
    const second = await offered(t2);
    await second.as.mutation(api.telehealth.cancel, { id: second.id });
    expect((await second.as.query(api.telehealth.get, { id: second.id }))!.status).toBe("dismissed");
  });

  test("offered times expire after 2 hours; others can't see or book them; bad slots are refused", async () => {
    const t = setup();
    mockApis();
    const { as, id } = await offered(t);
    const other = await createAppUser(t, "b@example.com");
    const slot = (await visitsOf(t))[0].slots[0];
    expect(await other.as.query(api.telehealth.get, { id })).toBeNull();
    await expect(other.as.mutation(api.telehealth.confirm, { id, slotId: slot.id })).rejects.toThrow(/Not found/);
    await expect(as.mutation(api.telehealth.confirm, { id, slotId: "nope" })).rejects.toThrow(/isn't on offer/);
    await advance(t, 2 * 60 * MIN + MIN);
    expect((await as.query(api.telehealth.get, { id }))!.status).toBe("expired");
    await expect(as.mutation(api.telehealth.confirm, { id, slotId: slot.id })).rejects.toThrow(/expired/);
  });

  test("one open request at a time, and 3 a day", async () => {
    const t = setup();
    mockApis();
    const { as, id } = await offered(t);
    await expect(as.mutation(api.telehealth.request, { reason: "again", urgency: "soon" })).rejects.toThrow(/already waiting/);
    await as.mutation(api.telehealth.cancel, { id });
    await as.mutation(api.telehealth.request, { reason: "2", urgency: "soon" });
    await settle(t);
    const second = (await visitsOf(t)).at(-1)!._id;
    await as.mutation(api.telehealth.cancel, { id: second });
    await as.mutation(api.telehealth.request, { reason: "3", urgency: "soon" });
    await settle(t);
    await as.mutation(api.telehealth.cancel, { id: (await visitsOf(t)).at(-1)!._id });
    await expect(as.mutation(api.telehealth.request, { reason: "4", urgency: "soon" })).rejects.toThrow(/today's 3 video visit requests/);
  });
});

describe("telehealth in chat", () => {
  test("the model can suggest a visit for a non-urgent problem", async () => {
    const t = setup();
    const { calls } = mockApis({ core: [toolCall({ reason: "UTI symptoms 2 days, no fever", urgency: "today" }), { content: "A clinician should look at this." }] });
    const { userId, as } = await user(t);
    await as.mutation(api.chat.send, { text: "it burns when I pee, two days now" });
    await settle(t);
    expect(cortexCalls(calls)[0].body.tools.map((x: any) => x.function.name)).toContain("suggest_telehealth");
    const result = cortexCalls(calls)[1].body.messages.find((m: any) => m.tool_call_id === "v1").content;
    expect(result).toMatch(/^Looking for video visit times now/);
    expect((await messagesOf(t, userId)).some((m) => m.kind === "appointment")).toBe(true);
  });

  test("never for emergencies: the tool isn't offered, and a call is refused", async () => {
    const t = setup();
    const { calls } = mockApis({ jev: { urgent: 0.95 }, core: [toolCall({ reason: "chest pain", urgency: "today" }), { content: "Call 911." }] });
    const { as } = await user(t);
    await as.mutation(api.chat.send, { text: "crushing chest pain" });
    await settle(t);
    expect(cortexCalls(calls)[0].body.tools.map((x: any) => x.function.name)).not.toContain("suggest_telehealth");
    expect(cortexCalls(calls)[1].body.messages.find((m: any) => m.tool_call_id === "v1").content).toMatch(/emergency/);
    expect(await visitsOf(t)).toHaveLength(0);
  });
});

describe("http provider", () => {
  test("follows the REST contract with the API key, and sends the reason and today's visit summary", async () => {
    vi.stubEnv("TELEHEALTH_PROVIDER", "http");
    vi.stubEnv("TELEHEALTH_API_URL", "https://tele.example.com/v1/");
    vi.stubEnv("TELEHEALTH_API_KEY", "tk_test");
    vi.stubEnv("TELEHEALTH_PROVIDER_NAME", "Acme Health");
    const t = setup();
    mockApis();
    const real = globalThis.fetch;
    const seen: { url: string; init?: RequestInit }[] = [];
    vi.stubGlobal("fetch", async (input: any, init?: RequestInit) => {
      const url = String(input);
      if (!url.startsWith("https://tele.example.com/")) return real(input, init);
      seen.push({ url, init });
      if (url.includes("/slots")) return Response.json({ slots: [{ id: "s1", startsAt: NOW + 60 * MIN, clinician: "Dr. Real" }, { id: 7 }] });
      if (init?.method === "POST") return Response.json({ bookingId: "b1", joinUrl: "https://tele.example.com/join/b1", startsAt: NOW + 60 * MIN });
      return new Response(null, { status: 204 });
    });
    const { userId, as } = await user(t);
    await t.run((ctx) => ctx.db.insert("visitSummaries", { userId, days: 30, status: "ready", text: "# Visit summary\nUTI symptoms." }));
    const id = (await as.mutation(api.telehealth.request, { reason: "UTI symptoms", urgency: "today" })) as Id<"appointments">;
    await settle(t);
    const visit = (await as.query(api.telehealth.get, { id }))!;
    expect(visit).toMatchObject({ providerName: "Acme Health", testProvider: false });
    expect(visit.slots).toEqual([{ id: "s1", startsAt: NOW + 60 * MIN, clinician: "Dr. Real" }]);
    await as.mutation(api.telehealth.confirm, { id, slotId: "s1" });
    await settle(t);
    await as.mutation(api.telehealth.cancel, { id });
    await settle(t);

    expect(seen.map((s) => `${s.init?.method ?? "GET"} ${s.url.split("?")[0]}`)).toEqual([
      "GET https://tele.example.com/v1/slots",
      "POST https://tele.example.com/v1/bookings",
      "DELETE https://tele.example.com/v1/bookings/b1",
    ]);
    expect((seen[0].init!.headers as Record<string, string>).Authorization).toBe("Bearer tk_test");
    expect(JSON.parse(seen[1].init!.body as string)).toMatchObject({ slotId: "s1", reason: "UTI symptoms", summary: "# Visit summary\nUTI symptoms.", patient: { email: "a@example.com" } });
    expect((await as.query(api.telehealth.get, { id }))!.status).toBe("cancelled");
  });
});

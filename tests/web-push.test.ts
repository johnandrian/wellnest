import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api } from "../convex/_generated/api";
import { createAppUser, mockApis, setEnv, setup } from "./helpers";

// The real library would sign and send over the network; record what it was asked to send instead.
const sent = vi.hoisted(() => ({ calls: [] as { endpoint: string; payload: any; vapid: any }[], gone: new Set<string>() }));
vi.mock("web-push", () => ({
  default: {
    sendNotification: async (sub: { endpoint: string }, payload: string, opts: { vapidDetails: any }) => {
      sent.calls.push({ endpoint: sub.endpoint, payload: JSON.parse(payload), vapid: opts.vapidDetails });
      if (sent.gone.has(sub.endpoint)) throw Object.assign(new Error("gone"), { statusCode: 410 });
      return { statusCode: 201 };
    },
  },
}));

const NOW = Date.parse("2026-11-02T18:00:00Z");
const H = 3_600_000;
const EP_A = "https://fcm.googleapis.com/fcm/send/aaaa";
const EP_B = "https://updates.push.services.mozilla.com/wpush/v2/bbbb";
const sub = (endpoint: string) => ({ endpoint, p256dh: "BPkey", auth: "authsecret" });

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  setEnv();
  vi.stubEnv("WEB_PUSH_PUBLIC_KEY", "pub");
  vi.stubEnv("WEB_PUSH_PRIVATE_KEY", "priv");
  vi.stubEnv("WEB_PUSH_SUBJECT", "mailto:team@example.com");
  sent.calls = [];
  sent.gone.clear();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

const settle = (t: ReturnType<typeof setup>) => t.finishAllScheduledFunctions(() => vi.advanceTimersByTime(1));
const subsOf = (t: ReturnType<typeof setup>) => t.run((ctx) => ctx.db.query("webPushSubs").collect());

async function withReminder(t: ReturnType<typeof setup>) {
  const u = await createAppUser(t);
  await u.as.mutation(api.chat.setTimeZone, { timeZone: "America/Los_Angeles", utcOffsetMin: -480 });
  await u.as.mutation(api.reminders.add, { name: "Ibuprofen", dose: "400 mg", schedule: { kind: "interval", everyHours: 6, firstAt: NOW + 6 * H } });
  return u;
}

describe("web push subscriptions", () => {
  test("registerWeb needs sign-in and an https endpoint; a browser that switches accounts moves", async () => {
    const t = setup();
    await expect(t.mutation(api.push.registerWeb, sub(EP_A))).rejects.toThrow(/Not signed in/);
    const a = await createAppUser(t, "a@example.com");
    const b = await createAppUser(t, "b@example.com");
    await expect(a.as.mutation(api.push.registerWeb, sub("http://example.com/push"))).rejects.toThrow(/push subscription/);
    await expect(a.as.mutation(api.push.registerWeb, { ...sub(EP_A), auth: "" })).rejects.toThrow(/push subscription/);
    await a.as.mutation(api.push.registerWeb, sub(EP_A));
    await a.as.mutation(api.push.registerWeb, sub(EP_A));
    expect((await subsOf(t)).map((r) => r.userId)).toEqual([a.userId]);
    await b.as.mutation(api.push.registerWeb, sub(EP_A));
    expect((await subsOf(t)).map((r) => r.userId)).toEqual([b.userId]);
    // Signing out of b removes it; a can't remove b's.
    await a.as.mutation(api.push.unregister, { token: EP_A });
    expect(await subsOf(t)).toHaveLength(1);
    await b.as.mutation(api.push.unregister, { token: EP_A });
    expect(await subsOf(t)).toHaveLength(0);
  });

  test("keeps the newest 10 browsers", async () => {
    const t = setup();
    const { as } = await createAppUser(t);
    for (let i = 0; i < 12; i++) await as.mutation(api.push.registerWeb, sub(`https://push.example.com/${i}`));
    const left = (await subsOf(t)).map((r) => r.endpoint);
    expect(left).toHaveLength(10);
    expect(left).not.toContain("https://push.example.com/0");
    expect(left).toContain("https://push.example.com/11");
  });
});

describe("web push sending", () => {
  test("a due dose reaches every browser with its message, and gone browsers are forgotten", async () => {
    const t = setup();
    mockApis();
    const { as } = await withReminder(t);
    await as.mutation(api.push.registerWeb, sub(EP_A));
    await as.mutation(api.push.registerWeb, sub(EP_B));
    sent.gone.add(EP_B);
    vi.advanceTimersByTime(6 * H);
    await settle(t);
    expect(sent.calls.map((c) => c.endpoint)).toEqual([EP_A, EP_B]);
    expect(sent.calls[0].payload).toMatchObject({
      title: "💊 Ibuprofen",
      body: "Time for your Ibuprofen (400 mg). Due 4:00 PM.",
      data: { kind: "reminders" },
    });
    expect(sent.calls[0].vapid).toEqual({ subject: "mailto:team@example.com", publicKey: "pub", privateKey: "priv" });
    expect((await subsOf(t)).map((r) => r.endpoint)).toEqual([EP_A]);
  });

  test("without VAPID keys nothing is sent", async () => {
    vi.stubEnv("WEB_PUSH_PRIVATE_KEY", "");
    const t = setup();
    mockApis();
    const { as } = await withReminder(t);
    await as.mutation(api.push.registerWeb, sub(EP_A));
    vi.advanceTimersByTime(6 * H);
    await settle(t);
    expect(sent.calls).toHaveLength(0);
  });

  test("delete everything removes the account's browsers", async () => {
    const t = setup();
    mockApis();
    const { as } = await createAppUser(t);
    await as.mutation(api.push.registerWeb, sub(EP_A));
    await as.mutation(api.me.deleteData, { category: "everything" });
    await settle(t);
    expect(await subsOf(t)).toHaveLength(0);
  });
});

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api } from "../convex/_generated/api";
import { Id } from "../convex/_generated/dataModel";
import { daysLeft, doseAt, statusOf } from "../convex/lib/meds";
import { cortexCalls, createAppUser, messagesOf, mockApis, pushSends, setEnv, setup } from "./helpers";

// 10:00 in Los Angeles.
const NOW = Date.parse("2026-11-02T18:00:00Z");
const H = 3_600_000;
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

const settle = (t: ReturnType<typeof setup>) => t.finishAllScheduledFunctions(() => vi.advanceTimersByTime(1));
const advance = async (t: ReturnType<typeof setup>, ms: number) => {
  vi.advanceTimersByTime(ms);
  await settle(t);
};
const reminders = async (t: ReturnType<typeof setup>, userId: any) => (await messagesOf(t, userId)).filter((m) => m.kind === "reminder");

async function user(t: ReturnType<typeof setup>) {
  const u = await createAppUser(t);
  await u.as.mutation(api.chat.setTimeZone, { timeZone: "America/Los_Angeles", utcOffsetMin: -480 });
  return u;
}

describe("medication helpers", () => {
  test("days left, per-time doses and status", () => {
    const daily = { kind: "daily" as const, times: ["08:00", "20:00"] };
    expect(daysLeft(daily, { left: 30, perDose: 1, warnDays: 7 })).toBe(15);
    expect(daysLeft({ kind: "interval", everyHours: 6, firstAt: 0 }, { left: 10, perDose: 2, warnDays: 7 })).toBe(1);
    expect(daysLeft(daily)).toBeNull();
    expect(doseAt("20:00", "1 tablet", [{ time: "20:00", dose: "2 tablets" }])).toBe("2 tablets");
    expect(doseAt("08:00", "1 tablet", [{ time: "20:00", dose: "2 tablets" }])).toBe("1 tablet");
    expect(statusOf({ active: false, pausedAt: 1 })).toBe("paused");
    expect(statusOf({ active: false, stoppedAt: 1 })).toBe("stopped");
  });
});

describe("medications", () => {
  test("details, per-time doses in the reminder text, and a dated history", async () => {
    const t = setup();
    mockApis();
    const { userId, as } = await user(t);
    const id = (await as.mutation(api.reminders.add, {
      name: "Gabapentin",
      dose: "300 mg",
      schedule: { kind: "daily", times: ["08:00", "20:00"] },
      genericName: "gabapentin",
      form: "capsule",
      prescriber: "Dr. Lee",
      timeDoses: [{ time: "20:00", dose: "600 mg" }, { time: "13:00", dose: "ignored" }],
    })) as Id<"medications">;
    await as.mutation(api.medications.update, { id, dose: "400 mg", notes: "with food" });
    const d = (await as.query(api.medications.detail, { id }))!;
    expect(d).toMatchObject({ genericName: "gabapentin", form: "capsule", prescriber: "Dr. Lee", notes: "with food", dose: "400 mg", status: "active" });
    expect(d.timeDoses).toEqual([{ time: "20:00", dose: "600 mg" }]);
    expect(d.events.map((e) => [e.kind, e.note])).toEqual([
      ["dose_changed", "300 mg → 400 mg"],
      ["started", null],
    ]);
    await advance(t, 10 * H); // 20:00 local
    expect((await reminders(t, userId))[0].text).toBe("💊 Time for your **Gabapentin** (600 mg). Due 8:00 PM.");
  });

  test("pause cancels reminders, resume brings them back, stop keeps the medication in the list", async () => {
    const t = setup();
    mockApis();
    const { userId, as } = await user(t);
    const id = (await as.mutation(api.reminders.add, { name: "Zinc", schedule: { kind: "daily", times: ["20:00"] } })) as Id<"medications">;
    await as.mutation(api.medications.pause, { id });
    await advance(t, 24 * H);
    expect(await reminders(t, userId)).toHaveLength(0);
    expect((await as.query(api.medications.all))[0]).toMatchObject({ status: "paused", nextAt: null });
    await as.mutation(api.medications.resume, { id });
    expect((await as.query(api.medications.all))[0].status).toBe("active");
    await advance(t, 24 * H);
    expect(await reminders(t, userId)).toHaveLength(1);
    await as.mutation(api.reminders.remove, { id });
    const [m] = await as.query(api.medications.all);
    expect(m.status).toBe("stopped");
    expect((await as.query(api.medications.detail, { id }))!.events.map((e) => e.kind)).toEqual(["stopped", "resumed", "paused", "started"]);
  });

  test("supply counts down on Taken, warns once in the chat and by push, and resets on refill", async () => {
    const t = setup();
    const { calls } = mockApis();
    const { userId, as } = await user(t);
    await as.mutation(api.push.register, { token: TOKEN, platform: "ios" });
    const id = (await as.mutation(api.reminders.add, { name: "Iron", schedule: { kind: "interval", everyHours: 24, firstAt: NOW + H } })) as Id<"medications">;
    await as.mutation(api.medications.setSupply, { id, left: 9, perDose: 1, warnDays: 7 });
    await advance(t, H);
    const [first] = await reminders(t, userId);
    await as.mutation(api.reminders.log, { messageId: first._id, status: "taken" });
    await as.mutation(api.reminders.log, { messageId: first._id, status: "taken" }); // counted once
    let d = (await as.query(api.medications.detail, { id }))!;
    expect(d.supply).toMatchObject({ left: 8 });
    expect(d.daysLeft).toBe(8);
    expect((await reminders(t, userId)).some((m) => m.text.includes("running low"))).toBe(false);

    await advance(t, 24 * H);
    const second = (await reminders(t, userId)).at(-1)!;
    await as.mutation(api.reminders.log, { messageId: second._id, status: "taken" });
    await settle(t);
    const low = (await reminders(t, userId)).filter((m) => m.text.includes("running low"));
    expect(low.map((m) => m.text)).toEqual(["💊 You're running low on **Iron**: about 7 days left. Time to order a refill."]);
    expect(pushSends(calls).at(-1)).toMatchObject({ title: "💊 Iron", body: "💊 You're running low on Iron: about 7 days left. Time to order a refill." });

    await as.mutation(api.medications.refill, { id, amount: 30 });
    d = (await as.query(api.medications.detail, { id }))!;
    expect(d.supply).toMatchObject({ left: 37 });
    expect(d.events[0]).toMatchObject({ kind: "refilled", note: "+30" });
  });

  test("side effects are dated and removable; only the owner can touch a medication", async () => {
    const t = setup();
    mockApis();
    const { as } = await user(t);
    const other = await createAppUser(t, "b@example.com");
    const id = (await as.mutation(api.reminders.add, { name: "Sertraline", schedule: { kind: "daily", times: ["08:00"] } })) as Id<"medications">;
    await as.mutation(api.medications.addSideEffect, { id, effect: "nausea", severity: 4 });
    const [effect] = (await as.query(api.medications.detail, { id }))!.sideEffects;
    expect(effect).toMatchObject({ date: "2026-11-02", effect: "nausea", severity: 4 });
    await expect(other.as.mutation(api.medications.pause, { id })).rejects.toThrow(/Not found/);
    await expect(other.as.mutation(api.medications.removeSideEffect, { id: effect._id })).rejects.toThrow(/Not found/);
    expect(await other.as.query(api.medications.detail, { id })).toBeNull();
    await as.mutation(api.medications.removeSideEffect, { id: effect._id });
    expect((await as.query(api.medications.detail, { id }))!.sideEffects).toEqual([]);
  });

  test("an eScript photo must be the user's own unused image upload", async () => {
    const t = setup();
    mockApis();
    const { as } = await user(t);
    const other = await createAppUser(t, "b@example.com");
    const id = (await as.mutation(api.reminders.add, { name: "Salbutamol", schedule: { kind: "daily", times: ["08:00"] } })) as Id<"medications">;
    const photo = await t.run((ctx) => ctx.storage.store(new Blob(["qr"], { type: "image/png" })));
    await other.as.mutation(api.chat.claimUpload, { storageId: photo });
    await expect(as.mutation(api.medications.setScript, { id, storageId: photo })).rejects.toThrow(/didn't upload/);
    const mine = await t.run((ctx) => ctx.storage.store(new Blob(["qr"], { type: "image/png" })));
    await as.mutation(api.chat.claimUpload, { storageId: mine });
    await as.mutation(api.medications.setScript, { id, storageId: mine });
    expect((await as.query(api.medications.detail, { id }))!.scriptUrl).toContain("http");
    // It can't also be sent as a chat photo.
    await expect(as.mutation(api.chat.send, { text: "x", imageId: mine })).rejects.toThrow(/didn't upload/);
  });
});

describe("medications in chat", () => {
  const toolCall = (args: object) => ({
    content: null,
    tool_calls: [{ id: "m1", type: "function", function: { name: "update_medication", arguments: JSON.stringify(args) } }],
  });
  const toolResult = (calls: any[]) => cortexCalls(calls).flatMap((c) => c.body.messages).find((m: any) => m.tool_call_id === "m1")?.content;

  test("update_medication records side effects and dose changes; the model sees details and history", async () => {
    const t = setup();
    const { calls } = mockApis({
      core: [toolCall({ name: "sertraline", action: "side_effect", side_effect: "dizzy in the mornings", severity: 3 }), { content: "Noted." }, toolCall({ name: "Sertraline", action: "change_dose", dose: "100 mg" }), { content: "Updated." }, { content: "ok" }],
    });
    const { as } = await user(t);
    await as.mutation(api.reminders.add, { name: "Sertraline", dose: "50 mg", genericName: "sertraline", schedule: { kind: "daily", times: ["08:00"] } });
    await as.mutation(api.chat.send, { text: "sertraline makes me dizzy in the mornings" });
    await settle(t);
    expect(toolResult(calls)).toBe("Logged a side effect for Sertraline: dizzy in the mornings.");
    await as.mutation(api.chat.send, { text: "doctor upped my sertraline to 100 mg" });
    await settle(t);
    await as.mutation(api.chat.send, { text: "what am I on?" });
    await settle(t);
    const system = cortexCalls(calls).at(-1)!.body.messages[0].content;
    expect(system).toContain("- Sertraline [sertraline] 100 mg, daily at 08:00, since 2026-11-02");
    expect(system).toContain("dose changes: 2026-11-02 50 mg → 100 mg");
    expect(system).toContain("side effects: 2026-11-02 dizzy in the mornings 3/10");
  });

  test("an unknown medication is reported, not created", async () => {
    const t = setup();
    const { calls } = mockApis({ core: [toolCall({ name: "warfarin", action: "pause" }), { content: "?" }] });
    const { as } = await user(t);
    await as.mutation(api.chat.send, { text: "pause my warfarin" });
    await settle(t);
    expect(toolResult(calls)).toMatch(/no current medication matches "warfarin"/);
  });
});

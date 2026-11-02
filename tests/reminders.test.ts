import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api } from "../convex/_generated/api";
import { checkSchedule, describeSchedule, nextDue, zonedTime, zoneOffsetMin } from "../convex/lib/reminders";
import { cortexCalls, createAppUser, messagesOf, mockApis, setEnv, setup } from "./helpers";

// 2026-11-02 10:00 in Los Angeles (PST, UTC-8).
const NOW = Date.parse("2026-11-02T18:00:00Z");
const LA = "America/Los_Angeles";
const H = 3_600_000;

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

async function laUser(t: ReturnType<typeof setup>) {
  const u = await createAppUser(t);
  await u.as.mutation(api.chat.setTimeZone, { timeZone: LA, utcOffsetMin: -480 });
  return u;
}

const reminders = async (t: ReturnType<typeof setup>, userId: any) =>
  (await messagesOf(t, userId)).filter((m) => m.kind === "reminder");

// Runs what's due now, a few rounds deep, without running future reminders (they recur forever).
async function settle(t: ReturnType<typeof setup>) {
  await t.finishAllScheduledFunctions(() => vi.advanceTimersByTime(1));
}

// Moves the clock forward and runs whatever came due.
async function advance(t: ReturnType<typeof setup>, ms: number) {
  vi.advanceTimersByTime(ms);
  await settle(t);
}

describe("schedules", () => {
  test("daily times are checked, normalized and sorted", () => {
    expect(checkSchedule({ kind: "daily", times: ["20:30", "8:00", "08:00"] })).toEqual({ schedule: { kind: "daily", times: ["08:00", "20:30"] } });
    expect(checkSchedule({ kind: "daily", times: ["25:00"] })).toEqual({ error: "Times must look like 08:00 or 20:30." });
    expect(checkSchedule({ kind: "daily", times: [] })).toHaveProperty("error");
    expect(checkSchedule({ kind: "interval", everyHours: 0.5, firstAt: 0 })).toEqual({ error: "Every 1 to 72 hours." });
  });

  test("next daily time is in the user's zone, rolling over to tomorrow", () => {
    const s = { kind: "daily" as const, times: ["08:00", "20:00"] };
    expect(new Date(nextDue(s, NOW, LA)).toISOString()).toBe("2026-11-03T04:00:00.000Z"); // 20:00 PST today
    expect(new Date(nextDue(s, Date.parse("2026-11-03T05:00:00Z"), LA)).toISOString()).toBe("2026-11-03T16:00:00.000Z"); // 08:00 tomorrow
  });

  test("daylight saving: 08:00 stays 08:00 local across the change", () => {
    // US clocks fall back on 2026-11-01; Oct 31 08:00 PDT = 15:00Z, Nov 2 08:00 PST = 16:00Z.
    expect(new Date(zonedTime(2026, 9, 31, "08:00", LA)).toISOString()).toBe("2026-10-31T15:00:00.000Z");
    expect(new Date(zonedTime(2026, 10, 2, "08:00", LA)).toISOString()).toBe("2026-11-02T16:00:00.000Z");
    expect(zoneOffsetMin(NOW, LA)).toBe(-480);
    // An unknown zone falls back to the given offset.
    expect(zoneOffsetMin(NOW, "Not/AZone", 120)).toBe(120);
  });

  test("intervals count from the first dose", () => {
    const s = { kind: "interval" as const, everyHours: 6, firstAt: NOW + 6 * H };
    expect(nextDue(s, NOW, LA)).toBe(NOW + 6 * H);
    expect(nextDue(s, NOW + 6 * H, LA)).toBe(NOW + 12 * H);
    expect(nextDue(s, NOW + 13 * H, LA)).toBe(NOW + 18 * H);
    expect(describeSchedule(s)).toBe("every 6 hours");
  });
});

describe("reminders", () => {
  test("need sign-in", async () => {
    const t = setup();
    await expect(t.mutation(api.reminders.add, { name: "x", schedule: { kind: "daily", times: ["08:00"] } })).rejects.toThrow(/Not signed in/);
    expect(await t.query(api.reminders.list)).toEqual([]);
  });

  test("a due dose posts a reminder in the chat, and the next one is scheduled", async () => {
    const t = setup();
    const { userId, as } = await laUser(t);
    await as.mutation(api.reminders.add, { name: " Vitamin D ", dose: "1000 IU", schedule: { kind: "daily", times: ["20:00"] } });
    const [med] = await as.query(api.reminders.list);
    expect(med).toMatchObject({ name: "Vitamin D", dose: "1000 IU", schedule: "daily at 20:00", nextAt: Date.parse("2026-11-03T04:00:00Z") });

    await advance(t, 9 * H); // 19:00 local: nothing yet
    expect(await reminders(t, userId)).toHaveLength(0);
    await advance(t, 1 * H); // 20:00 local
    const [msg] = await reminders(t, userId);
    expect(msg).toMatchObject({ role: "assistant", channel: "app", text: "💊 Time for your **Vitamin D** (1000 IU). Due 8:00 PM." });
    expect(msg.embedding).toBeUndefined(); // reminders stay out of memory search
    expect((await as.query(api.reminders.list))[0].nextAt).toBe(Date.parse("2026-11-04T04:00:00Z"));

    await advance(t, 24 * H);
    expect(await reminders(t, userId)).toHaveLength(2);
  });

  test("Taken / Skip is saved on the message and in the dose history, and can be changed", async () => {
    const t = setup();
    const { userId, as } = await laUser(t);
    await as.mutation(api.reminders.add, { name: "Ibuprofen", schedule: { kind: "interval", everyHours: 6, firstAt: NOW + 6 * H } });
    await advance(t, 6 * H);
    const [msg] = await reminders(t, userId);
    await as.mutation(api.reminders.log, { messageId: msg._id, status: "skipped" });
    await as.mutation(api.reminders.log, { messageId: msg._id, status: "taken" });
    expect((await reminders(t, userId))[0].reminder?.status).toBe("taken");
    const logs = await t.run((ctx) => ctx.db.query("doseLogs").collect());
    expect(logs.map((l) => [l.dueAt, l.status])).toEqual([[NOW + 6 * H, "taken"]]);

    // Someone else can't answer it.
    const other = await createAppUser(t, "b@example.com");
    await expect(other.as.mutation(api.reminders.log, { messageId: msg._id, status: "skipped" })).rejects.toThrow(/Not found/);
  });

  test("a course ends after its days; stopping cancels the next reminder", async () => {
    const t = setup();
    const { userId, as } = await laUser(t);
    await as.mutation(api.reminders.add, { name: "Amoxicillin", schedule: { kind: "interval", everyHours: 12, firstAt: NOW + 12 * H }, days: 1 });
    await advance(t, 12 * H);
    await advance(t, 12 * H); // the 24h dose is past the 1-day course
    expect(await reminders(t, userId)).toHaveLength(1);
    expect(await as.query(api.reminders.list)).toEqual([]);

    await as.mutation(api.reminders.add, { name: "Zinc", schedule: { kind: "daily", times: ["20:00"] } });
    const [zinc] = await as.query(api.reminders.list);
    await as.mutation(api.reminders.remove, { id: zinc._id });
    await advance(t, 24 * H);
    expect((await reminders(t, userId)).map((m) => m.text)).not.toContainEqual(expect.stringContaining("Zinc"));
  });

  test("bad input and the active cap are refused", async () => {
    const t = setup();
    const { as } = await laUser(t);
    await expect(as.mutation(api.reminders.add, { name: " ", schedule: { kind: "daily", times: ["08:00"] } })).rejects.toThrow(/name/);
    await expect(as.mutation(api.reminders.add, { name: "x", schedule: { kind: "daily", times: ["8am"] } })).rejects.toThrow(/08:00/);
    for (let i = 0; i < 20; i++) await as.mutation(api.reminders.add, { name: `m${i}`, schedule: { kind: "daily", times: ["08:00"] } });
    await expect(as.mutation(api.reminders.add, { name: "one more", schedule: { kind: "daily", times: ["08:00"] } })).rejects.toThrow(/up to 20/);
  });
});

describe("reminders in chat", () => {
  const toolCall = (name: string, args: object) => ({
    content: null,
    tool_calls: [{ id: "r1", type: "function", function: { name, arguments: JSON.stringify(args) } }],
  });
  const toolResult = (calls: any[]) =>
    cortexCalls(calls).flatMap((c) => c.body.messages).find((m: any) => m.role === "tool" && m.tool_call_id === "r1")?.content as string;

  test("set_medication_reminder sets one up in the user's zone; the model sees it on later turns", async () => {
    const t = setup();
    const { calls } = mockApis({
      core: [toolCall("set_medication_reminder", { name: "Ibuprofen", dose: "400 mg", times: ["8:00", "20:00"], days: 3 }), { content: "Done." }, { content: "ok" }],
    });
    const { as } = await laUser(t);
    await as.mutation(api.chat.send, { text: "remind me to take ibuprofen 400mg at 8 and 8 for 3 days" });
    await settle(t);
    expect(toolResult(calls)).toBe(
      "Reminder set: Ibuprofen 400 mg, daily at 08:00, 20:00 for 3 days. First reminder at 8:00 PM. Reminders appear in the app chat " +
        "with Taken / Skip buttons; they can be managed in the Reminders panel (pill button).",
    );
    expect(await as.query(api.reminders.list)).toMatchObject([{ name: "Ibuprofen", schedule: "daily at 08:00, 20:00" }]);

    await as.mutation(api.chat.send, { text: "what am I taking?" });
    await settle(t);
    expect(cortexCalls(calls).at(-1)!.body.messages[0].content).toContain(
      "Medication reminders the user has set up:\n- Ibuprofen 400 mg, daily at 08:00, 20:00, since 2026-11-02",
    );
  });

  test("without a known time zone, times are UTC and the model is told", async () => {
    const t = setup();
    const { calls } = mockApis({ core: [toolCall("set_medication_reminder", { name: "Iron", times: ["09:00"] }), { content: "Done." }] });
    const { as } = await createAppUser(t);
    await as.mutation(api.chat.send, { text: "remind me to take iron at 9" });
    await settle(t);
    expect(toolResult(calls)).toContain("times are UTC until they open the app");
  });

  test("cancel_medication_reminder stops it by name", async () => {
    const t = setup();
    const { calls } = mockApis({ core: [toolCall("cancel_medication_reminder", { name: "ibuprofen" }), { content: "Stopped." }] });
    const { as } = await laUser(t);
    await as.mutation(api.reminders.add, { name: "Ibuprofen", schedule: { kind: "daily", times: ["08:00"] } });
    await as.mutation(api.chat.send, { text: "stop my ibuprofen reminders" });
    await settle(t);
    expect(toolResult(calls)).toBe("Stopped reminders for Ibuprofen.");
    expect(await as.query(api.reminders.list)).toEqual([]);
  });

  test("visit summaries include medications and the dose history", async () => {
    const t = setup();
    const { calls } = mockApis({ core: [{ content: "# Visit summary" }] });
    const { userId, as } = await laUser(t);
    await as.mutation(api.reminders.add, { name: "Sumatriptan", dose: "50 mg", schedule: { kind: "interval", everyHours: 24, firstAt: NOW + H } });
    await advance(t, H);
    const [msg] = await reminders(t, userId);
    await as.mutation(api.reminders.log, { messageId: msg._id, status: "taken" });
    await as.mutation(api.visit.create, {});
    await settle(t);
    const material = cortexCalls(calls).at(-1)!.body.messages[1].content;
    expect(material).toContain("- Sumatriptan 50 mg, every 24 hours, since 2026-11-02; last 30 days: 1 taken, 0 skipped");
  });
});

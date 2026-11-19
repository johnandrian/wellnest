// Today's doses, Taken late, as-needed doses, snooze, and the monthly dose calendar (convex/reminders.ts,
// convex/medications.ts).
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api } from "../convex/_generated/api";
import { Id } from "../convex/_generated/dataModel";
import { checkSchedule, describeSchedule, dueTimes, nextDue } from "../convex/lib/reminders";
import { daysLeft, dosesPerDay } from "../convex/lib/meds";
import { createAppUser, messagesOf, setEnv, setup } from "./helpers";

// Monday 2026-11-02, 10:00 in Los Angeles.
const NOW = Date.parse("2026-11-02T18:00:00Z");
const H = 3_600_000;
const LA = "America/Los_Angeles";
// That Monday's local midnight to midnight.
const DAY = { from: Date.parse("2026-11-02T08:00:00Z"), to: Date.parse("2026-11-03T08:00:00Z") };

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
const reminders = async (t: ReturnType<typeof setup>, userId: Id<"users">) => (await messagesOf(t, userId)).filter((m) => m.kind === "reminder");

async function user(t: ReturnType<typeof setup>) {
  const u = await createAppUser(t);
  await u.as.mutation(api.chat.setTimeZone, { timeZone: LA, utcOffsetMin: -480 });
  return u;
}

describe("today's doses", () => {
  test("the dashboard counts doses an hour past due and unanswered as overdue", async () => {
    const t = setup();
    vi.setSystemTime(NOW - 24 * H);
    const { as } = await user(t);
    const id = (await as.mutation(api.reminders.add, { name: "Metformin", schedule: { kind: "daily", times: ["08:00", "09:30", "20:00"] } })) as Id<"medications">;
    vi.setSystemTime(NOW);
    const overdue = async () => (await as.query(api.dashboard.view, { today: "2026-11-02", now: Date.now() }))!.meds.overdue;
    // 10:00: 08:00 is two hours late, 09:30 only half an hour, 20:00 not yet due.
    expect(await overdue()).toBe(1);
    const [morning] = (await as.query(api.reminders.today, DAY))!.doses;
    await as.mutation(api.reminders.mark, { medicationId: id, dueAt: morning.dueAt, status: "skipped" });
    expect(await overdue()).toBe(0);
    vi.setSystemTime(NOW + H);
    expect(await overdue()).toBe(1);
  });

  test("lists the day's doses and answers them, with Taken late and the supply", async () => {
    const t = setup();
    // Added yesterday, so this morning's dose is owed.
    vi.setSystemTime(NOW - 24 * H);
    const { as } = await user(t);
    const id = (await as.mutation(api.reminders.add, { name: "Metformin", dose: "500 mg", schedule: { kind: "daily", times: ["08:00", "20:00"] } })) as Id<"medications">;
    await as.mutation(api.medications.setSupply, { id, left: 10, perDose: 1 });
    vi.setSystemTime(NOW);
    const today = await as.query(api.reminders.today, DAY);
    expect(today!.doses.map((d) => [d.time, d.status])).toEqual([
      ["08:00", null],
      ["20:00", null],
    ]);

    // The 08:00 dose, two hours late.
    const morning = today!.doses[0].dueAt;
    await as.mutation(api.reminders.mark, { medicationId: id, dueAt: morning, status: "taken" });
    let [dose] = (await as.query(api.reminders.today, DAY))!.doses;
    expect(dose).toMatchObject({ status: "taken", takenAt: NOW });
    expect((await as.query(api.medications.detail, { id }))!.supply!.left).toBe(9);

    // Changing it to Skip puts the dose back.
    await as.mutation(api.reminders.mark, { medicationId: id, dueAt: morning, status: "skipped" });
    [dose] = (await as.query(api.reminders.today, DAY))!.doses;
    expect(dose.status).toBe("skipped");
    expect((await as.query(api.medications.detail, { id }))!.supply!.left).toBe(10);

    // Too far from now, and other people's, are refused.
    await expect(as.mutation(api.reminders.mark, { medicationId: id, dueAt: NOW - 5 * 24 * H, status: "taken" })).rejects.toThrow(/too far/);
    const other = await createAppUser(t, "b@example.com");
    await expect(other.as.mutation(api.reminders.mark, { medicationId: id, dueAt: morning, status: "taken" })).rejects.toThrow(/Not found/);
  });

  test("a medication added today doesn't owe the doses before it", async () => {
    const t = setup();
    const { as } = await user(t);
    await as.mutation(api.reminders.add, { name: "Zinc", schedule: { kind: "daily", times: ["08:00", "20:00"] } });
    expect((await as.query(api.reminders.today, DAY))!.doses.map((d) => d.time)).toEqual(["20:00"]);
  });

  test("answering from the list updates the chat reminder too", async () => {
    const t = setup();
    const { userId, as } = await user(t);
    const id = (await as.mutation(api.reminders.add, { name: "Zinc", schedule: { kind: "daily", times: ["12:00"] } })) as Id<"medications">;
    await advance(t, 2 * H);
    const [msg] = await reminders(t, userId);
    await as.mutation(api.reminders.mark, { medicationId: id, dueAt: msg.reminder!.dueAt, status: "taken" });
    expect((await reminders(t, userId))[0].reminder?.status).toBe("taken");
  });

  test("as-needed medications have no reminders and are logged with Took one", async () => {
    const t = setup();
    const { userId, as } = await user(t);
    const id = (await as.mutation(api.reminders.add, { name: "Ibuprofen", schedule: { kind: "asNeeded" } })) as Id<"medications">;
    await as.mutation(api.medications.setSupply, { id, left: 20, perDose: 2 });
    const [listed] = await as.query(api.reminders.list);
    expect(listed).toMatchObject({ schedule: "as needed", nextAt: null, rule: { kind: "asNeeded" } });

    const at = await as.mutation(api.reminders.takeNow, { medicationId: id });
    let today = await as.query(api.reminders.today, DAY);
    expect(today!.asNeeded).toMatchObject([{ name: "Ibuprofen", taken: [at] }]);
    expect((await as.query(api.medications.detail, { id }))!.supply!.left).toBe(18);

    // Undo puts it back.
    await as.mutation(api.reminders.unmark, { medicationId: id, dueAt: at });
    today = await as.query(api.reminders.today, DAY);
    expect(today!.asNeeded[0].taken).toEqual([]);
    expect((await as.query(api.medications.detail, { id }))!.supply!.left).toBe(20);

    await advance(t, 48 * H);
    expect(await reminders(t, userId)).toEqual([]);
  });
});

describe("snooze", () => {
  test("reminds again in 15 minutes unless the dose was answered", async () => {
    const t = setup();
    const { userId, as } = await user(t);
    const id = (await as.mutation(api.reminders.add, { name: "Zinc", schedule: { kind: "daily", times: ["12:00"] } })) as Id<"medications">;
    await advance(t, 2 * H);
    const [msg] = await reminders(t, userId);
    await as.mutation(api.reminders.snooze, { medicationId: id, dueAt: msg.reminder!.dueAt });
    await advance(t, 15 * 60_000);
    const again = await reminders(t, userId);
    expect(again).toHaveLength(2);
    expect(again[1].reminder?.dueAt).toBe(msg.reminder!.dueAt);

    // Answering one answers both; a second snooze then does nothing.
    await as.mutation(api.reminders.log, { messageId: again[1]._id, status: "taken" });
    expect((await reminders(t, userId)).map((m) => m.reminder?.status)).toEqual(["taken", "taken"]);
    await as.mutation(api.reminders.snooze, { medicationId: id, dueAt: msg.reminder!.dueAt });
    await advance(t, 15 * 60_000);
    expect(await reminders(t, userId)).toHaveLength(2);
  });
});

describe("dose calendar", () => {
  test("counts due, taken, and skipped doses per local day", async () => {
    const t = setup();
    vi.setSystemTime(NOW - 48 * H); // Saturday 10:00
    const { as } = await user(t);
    const id = (await as.mutation(api.reminders.add, { name: "Zinc", schedule: { kind: "daily", times: ["12:00"] } })) as Id<"medications">;
    vi.setSystemTime(NOW);
    const sat = Date.parse("2026-10-31T19:00:00Z");
    const sun = Date.parse("2026-11-01T20:00:00Z"); // after the clocks went back
    await as.mutation(api.reminders.mark, { medicationId: id, dueAt: sat, status: "taken" });
    await as.mutation(api.reminders.mark, { medicationId: id, dueAt: sun, status: "skipped" });
    const days = await as.query(api.medications.calendar, { id, from: Date.parse("2026-10-31T07:00:00Z"), to: Date.parse("2026-11-03T08:00:00Z") });
    expect(days).toEqual([
      { date: "2026-10-31", due: 1, taken: 1, skipped: 0 },
      { date: "2026-11-01", due: 1, taken: 0, skipped: 1 },
      { date: "2026-11-02", due: 1, taken: 0, skipped: 0 },
    ]);
  });
});

// Weekday, every-other-day, and as-needed schedules, and changing a medication's schedule (convex/lib/reminders.ts,
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

describe("schedules", () => {
  test("weekdays and every other day are checked", () => {
    expect(checkSchedule({ kind: "daily", times: ["08:00"], weekdays: [5, 1, 1] })).toEqual({ schedule: { kind: "daily", times: ["08:00"], weekdays: [1, 5] } });
    // All seven days is just daily.
    expect(checkSchedule({ kind: "daily", times: ["08:00"], weekdays: [0, 1, 2, 3, 4, 5, 6] })).toEqual({ schedule: { kind: "daily", times: ["08:00"] } });
    expect(checkSchedule({ kind: "daily", times: ["08:00"], weekdays: [] })).toEqual({ error: "Pick at least one day of the week." });
    expect(checkSchedule({ kind: "daily", times: ["08:00"], everyOtherDay: "soon" })).toHaveProperty("error");
    expect(checkSchedule({ kind: "asNeeded" })).toEqual({ schedule: { kind: "asNeeded" } });
  });

  test("the next dose skips days off", () => {
    // Monday and Friday at 08:00: after Monday 10:00 the next is Friday.
    const s = { kind: "daily" as const, times: ["08:00"], weekdays: [1, 5] };
    expect(new Date(nextDue(s, NOW, LA)).toISOString()).toBe("2026-11-06T16:00:00.000Z");
    // Every other day from Monday: Wednesday next.
    const other = { kind: "daily" as const, times: ["08:00"], everyOtherDay: "2026-11-02" };
    expect(new Date(nextDue(other, NOW, LA)).toISOString()).toBe("2026-11-04T16:00:00.000Z");
    expect(dueTimes(other, NOW, NOW + 7 * 24 * H, LA).map((at) => new Date(at).toISOString().slice(0, 10))).toEqual(["2026-11-04", "2026-11-06", "2026-11-08"]);
  });

  test("words and supply follow the schedule", () => {
    expect(describeSchedule({ kind: "daily", times: ["08:00"], weekdays: [1, 5] })).toBe("on Mon, Fri at 08:00");
    expect(describeSchedule({ kind: "daily", times: ["08:00"], everyOtherDay: "2026-11-02" })).toBe("every other day at 08:00");
    expect(describeSchedule({ kind: "asNeeded" })).toBe("as needed");
    expect(dosesPerDay({ kind: "daily", times: ["08:00"], everyOtherDay: "2026-11-02" })).toBe(0.5);
    expect(daysLeft({ kind: "daily", times: ["08:00"], everyOtherDay: "2026-11-02" }, { left: 10, perDose: 1, warnDays: 7 })).toBe(20);
    expect(daysLeft({ kind: "asNeeded" }, { left: 10, perDose: 1, warnDays: 7 })).toBeNull();
  });
});

describe("editing a schedule", () => {
  test("a new schedule moves the next reminder; as-needed stops them", async () => {
    const t = setup();
    const { userId, as } = await user(t);
    const id = (await as.mutation(api.reminders.add, { name: "Zinc", schedule: { kind: "daily", times: ["20:00"] } })) as Id<"medications">;
    await as.mutation(api.medications.update, { id, schedule: { kind: "interval", everyHours: 6, firstAt: NOW + H } });
    expect((await as.query(api.medications.detail, { id }))!).toMatchObject({ rule: { kind: "interval", everyHours: 6 }, nextAt: NOW + H });

    // Setup's times keep the weekdays.
    await as.mutation(api.medications.update, { id, schedule: { kind: "daily", times: ["09:00"], weekdays: [1, 3] } });
    await as.mutation(api.medications.update, { id, times: ["07:00"] });
    expect((await as.query(api.medications.detail, { id }))!.rule).toEqual({ kind: "daily", times: ["07:00"], weekdays: [1, 3] });

    await as.mutation(api.medications.update, { id, schedule: { kind: "asNeeded" } });
    expect((await as.query(api.medications.detail, { id }))!.nextAt).toBeNull();
    await advance(t, 72 * H);
    expect(await reminders(t, userId)).toEqual([]);
  });
});

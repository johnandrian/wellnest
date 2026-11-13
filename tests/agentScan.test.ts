import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "../convex/_generated/api";
import { Id } from "../convex/_generated/dataModel";
import { highFastingRule, urgentGlucoseRule, worseningRule, GlucoseReading } from "../convex/lib/agentRules";
import { DEFAULT_UNITS } from "../convex/lib/units";
import { createAppUser, drain, mockApis, pushSends, setEnv, setup } from "./helpers";

// 09:30 UTC on Nov 13 (users without a time zone are on UTC, so it's their morning).
const NOW = Date.parse("2026-11-13T09:30:00Z");
const TODAY = "2026-11-13";
const DAY = 86_400_000;
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

const fasting = (date: string, value: number): GlucoseReading => ({ date, at: Date.parse(`${date}T07:00:00Z`), value, context: "fasting" });
const MMOL = { glucose: "mmol/L", weight: "kg" } as const;

describe("agent rules", () => {
  test("three high fasting mornings in a row draft a doctor message that mentions a recent medication change", () => {
    const readings = [fasting("2026-11-11", 168), fasting("2026-11-12", 174), fasting(TODAY, 181)];
    const p = highFastingRule(readings, TODAY, [{ name: "Metformin", kind: "dose_changed", date: "2026-11-08" }], "en", DEFAULT_UNITS)!;
    expect(p).toMatchObject({ rule: "glucose_high_fasting", urgent: false, details: { kind: "message_doctor", to: "Your doctor" } });
    expect(p.reason).toBe("Your fasting glucose has been above 130 mg/dL on 3 mornings in a row since Metformin changed.");
    expect(p.details.kind === "message_doctor" && p.details.body).toContain("168 mg/dL to 181 mg/dL for the last 3 mornings, since my Metformin dose changed on Nov 8");
    expect(p.evidence).toHaveLength(4);
    expect(p.evidence[3]).toMatchObject({ label: "Medication change", value: "Metformin (dose changed)" });
  });

  test("the run can end yesterday, readings show in the user's unit, and the text follows their language", () => {
    const readings = [fasting("2026-11-10", 150), fasting("2026-11-11", 160), fasting("2026-11-12", 170)];
    const p = highFastingRule(readings, TODAY, [], "es", MMOL)!;
    expect(p.title).toBe("Escribe a tu médico sobre la glucosa alta");
    expect(p.evidence[0].value).toBe("8.3 mmol/L");
    expect(p.evidence).toHaveLength(3);
  });

  test("no high run: a gap, a normal morning, only two days, non-fasting readings, or an older run", () => {
    expect(highFastingRule([fasting("2026-11-11", 168), fasting(TODAY, 181)], TODAY, [], "en", DEFAULT_UNITS)).toBeNull();
    expect(highFastingRule([fasting("2026-11-11", 168), fasting("2026-11-12", 120), fasting(TODAY, 181)], TODAY, [], "en", DEFAULT_UNITS)).toBeNull();
    const afterMeal = ["2026-11-11", "2026-11-12", TODAY].map((d) => ({ ...fasting(d, 200), context: "after_meal" }));
    expect(highFastingRule(afterMeal, TODAY, [], "en", DEFAULT_UNITS)).toBeNull();
    expect(highFastingRule([fasting("2026-11-08", 168), fasting("2026-11-09", 174), fasting("2026-11-10", 181)], TODAY, [], "en", DEFAULT_UNITS)).toBeNull();
    // The day's first fasting reading counts.
    const lateLow = [...["2026-11-11", "2026-11-12", TODAY].map((d) => fasting(d, 170)), { ...fasting(TODAY, 110), at: Date.parse(`${TODAY}T07:30:00Z`) }];
    expect(highFastingRule(lateLow, TODAY, [], "en", DEFAULT_UNITS)).not.toBeNull();
  });

  test("a very low or very high reading today is urgent; one from yesterday or in range isn't", () => {
    const low = urgentGlucoseRule([{ date: TODAY, at: NOW, value: 48 }], TODAY, "en", DEFAULT_UNITS)!;
    expect(low).toMatchObject({ rule: "glucose_urgent", urgent: true, cooldownDays: 1, details: { kind: "book_visit", urgency: "today" } });
    expect(low.reason).toBe("You logged a glucose of 48 mg/dL, which is very low.");
    expect(urgentGlucoseRule([{ date: TODAY, at: NOW, value: 320 }], TODAY, "en", DEFAULT_UNITS)!.reason).toContain("very high");
    expect(urgentGlucoseRule([{ date: "2026-11-12", at: NOW - DAY, value: 40 }], TODAY, "en", DEFAULT_UNITS)).toBeNull();
    expect(urgentGlucoseRule([{ date: TODAY, at: NOW, value: 54 }, { date: TODAY, at: NOW, value: 300 }], TODAY, "en", DEFAULT_UNITS)).toBeNull();
  });

  test("pain worse than last week suggests a visit only when nothing is booked", () => {
    const stats = [
      { outcome: "pain" as const, thisWeek: 6.1, lastWeek: 3.8, days: 5, better: false },
      { outcome: "mood" as const, thisWeek: 2, lastWeek: 4, days: 5, better: false },
    ];
    const p = worseningRule(stats, false, "en")!;
    expect(p).toMatchObject({ rule: "worse:pain", details: { kind: "book_visit", urgency: "soon" } });
    expect(p.evidence.map((e) => e.value)).toEqual(["6.1/10", "3.8/10"]);
    expect(worseningRule(stats, true, "en")).toBeNull();
    expect(worseningRule([{ ...stats[0], thisWeek: 4.5 }], false, "en")).toBeNull();
    expect(worseningRule([{ ...stats[0], better: true }], false, "en")).toBeNull();
    expect(worseningRule([{ ...stats[0], days: 2 }], false, "en")).toBeNull();
    expect(worseningRule([stats[1]], false, "en")).toBeNull();
  });
});

async function logFasting(t: ReturnType<typeof setup>, userId: Id<"users">, dates: string[], value: number) {
  await t.run(async (ctx) => {
    for (const date of dates) {
      await ctx.db.insert("trackerEntries", { userId, date, at: Date.parse(`${date}T07:00:00Z`), tracker: "glucose", glucose: { value, context: "fasting" }, source: "manual" });
    }
  });
}

describe("agent morning check", () => {
  test("proposes once, pushes, and doesn't propose the same thing again during the cooldown, even after a dismissal", async () => {
    const t = setup();
    const { calls } = mockApis();
    const { userId, as } = await createAppUser(t);
    await as.mutation(api.push.register, { token: TOKEN, platform: "ios" });
    await logFasting(t, userId, ["2026-11-11", "2026-11-12", TODAY], 175);

    await t.mutation(internal.agentScan.scan, {});
    await drain(t);
    const rows = await as.query(api.agent.list, {});
    expect(rows).toMatchObject([{ status: "proposed", rule: "glucose_high_fasting", details: { kind: "message_doctor" } }]);
    expect(pushSends(calls)).toMatchObject([{ to: TOKEN, title: "Something needs your OK", body: "Message your doctor about high glucose", data: { kind: "agent", open: "agent" } }]);

    // Same morning: the scan doesn't run twice.
    await t.mutation(internal.agentScan.scan, {});
    await drain(t);
    expect(await as.query(api.agent.list, {})).toHaveLength(1);

    await as.mutation(api.agent.dismiss, { id: rows[0]._id });
    vi.setSystemTime(NOW + 5 * DAY);
    await logFasting(t, userId, ["2026-11-14", "2026-11-15", "2026-11-16", "2026-11-17", "2026-11-18"], 175);
    expect(await t.mutation(internal.agentScan.check, { userId, force: true })).toBe(0);

    vi.setSystemTime(NOW + 15 * DAY);
    await logFasting(t, userId, ["2026-11-19", "2026-11-20", "2026-11-21", "2026-11-22", "2026-11-23", "2026-11-24", "2026-11-25", "2026-11-26", "2026-11-27", "2026-11-28"], 175);
    expect(await t.mutation(internal.agentScan.check, { userId, force: true })).toBe(1);
    await drain(t);
    expect(pushSends(calls)).toHaveLength(2);
  });

  test("only runs at 9 AM in the user's own time zone, and nothing is proposed or pushed when nothing matches", async () => {
    const t = setup();
    const { calls } = mockApis();
    const { userId, as } = await createAppUser(t);
    await as.mutation(api.push.register, { token: TOKEN, platform: "ios" });
    await t.run((ctx) => ctx.db.patch(userId, { timeZone: "America/Los_Angeles" }));
    await logFasting(t, userId, ["2026-11-11", "2026-11-12", TODAY], 175);

    await t.mutation(internal.agentScan.scan, {}); // 1:30 AM in Los Angeles
    await drain(t);
    expect(await as.query(api.agent.list, {})).toEqual([]);

    vi.setSystemTime(Date.parse("2026-11-13T17:30:00Z")); // 9:30 AM there
    await t.mutation(internal.agentScan.scan, {});
    await drain(t);
    expect(await as.query(api.agent.list, {})).toHaveLength(1);

    const other = await createAppUser(t, "b@example.com");
    expect(await t.mutation(internal.agentScan.check, { userId: other.userId, force: true })).toBe(0);
    expect(pushSends(calls)).toHaveLength(1);
  });

  test("a very low reading logged in the app becomes an urgent card right away, once a day", async () => {
    const t = setup();
    const { calls } = mockApis();
    const { userId, as } = await createAppUser(t);
    await as.mutation(api.push.register, { token: TOKEN, platform: "ios" });

    await as.mutation(api.trackers.add, { tracker: "glucose", glucose: { value: 110 } });
    await drain(t);
    expect(await as.query(api.agent.list, {})).toEqual([]);

    await as.mutation(api.trackers.add, { tracker: "glucose", glucose: { value: 48 } });
    await drain(t);
    expect(await as.query(api.agent.list, {})).toMatchObject([{ urgent: true, rule: "glucose_urgent", details: { kind: "book_visit", urgency: "today" } }]);
    expect(pushSends(calls)).toMatchObject([{ title: "Get care today for a glucose reading", body: expect.stringContaining("911") }]);

    await as.mutation(api.trackers.add, { tracker: "glucose", glucose: { value: 45 } });
    await drain(t);
    expect(await as.query(api.agent.list, {})).toHaveLength(1);
    expect(await t.run((ctx) => ctx.db.query("agentActions").withIndex("by_user", (q) => q.eq("userId", userId)).collect())).toHaveLength(1);
  });

  test("skips accounts being deleted", async () => {
    const t = setup();
    mockApis();
    const { userId } = await createAppUser(t);
    await logFasting(t, userId, ["2026-11-11", "2026-11-12", TODAY], 175);
    await t.run((ctx) => ctx.db.patch(userId, { deleting: true }));
    expect(await t.mutation(internal.agentScan.check, { userId, force: true })).toBe(0);
  });
});

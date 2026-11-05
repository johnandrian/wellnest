// Weight, glucose, and lab results as pattern inputs; units; medication markers on charts; and air quality alerts.
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "../convex/_generated/api";
import { Id } from "../convex/_generated/dataModel";
import { chartMarks, chartSeries, dateList, findPatterns, Inputs, labEffects, medEffects, shiftDate, weekStats } from "../convex/lib/insights";
import { airAlertText, labEffectText, medEffectText, patternText, weekStatLine } from "../convex/lib/insightsText";
import { cleanMetrics, formatDays, glucoseDay } from "../convex/lib/health";
import { cleanGlucose, trackersText } from "../convex/lib/trackers";
import { checkinText, detect } from "../convex/lib/checkins";
import { fmtGlucose, fmtWeight, glucoseToMgdl } from "../convex/lib/units";
import { createAppUser, messagesOf, mockApis, pushSends, setEnv, setup } from "./helpers";

const NOW = Date.parse("2026-11-02T19:15:00Z"); // 7:15 PM in UTC
const TODAY = "2026-11-02";
const TOMORROW = "2026-11-03";
const KG = { glucose: "mmol/L", weight: "kg" } as const;

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

const empty = (): Inputs => ({ entries: [], trackers: [], daily: [], health: [], weather: [] });
const lastDays = (n: number, end = TODAY) => dateList(shiftDate(end, -(n - 1)), end);
const settle = (t: ReturnType<typeof setup>) => t.finishAllScheduledFunctions(() => vi.advanceTimersByTime(1));
const glucose = (date: string, value: number) => ({ date, at: Date.parse(`${date}T08:00:00Z`), tracker: "glucose" as const, glucose: { value } });

describe("units", () => {
  test("US units unless changed; values are stored in mg/dL and kg", () => {
    expect(fmtWeight(80, { glucose: "mg/dL", weight: "lb" })).toBe("176.4 lb");
    expect(fmtWeight(80, KG)).toBe("80 kg");
    expect(fmtGlucose(144, { glucose: "mg/dL", weight: "lb" })).toBe("144 mg/dL");
    expect(fmtGlucose(144, KG)).toBe("8 mmol/L");
    expect(Math.round(glucoseToMgdl(7.2, "mmol/L"))).toBe(130);
  });

  test("the setting is saved on the account", async () => {
    const t = setup();
    const { as } = await createAppUser(t);
    expect((await as.query(api.chat.me))!.units).toEqual({ glucose: "mg/dL", weight: "lb" });
    await as.mutation(api.chat.setUnits, { units: KG });
    expect((await as.query(api.chat.me))!.units).toEqual(KG);
  });
});

describe("weight", () => {
  // 20 days of weight; on every fourth day it's 1.5 kg up on the days before, and energy is low on exactly those days.
  function gains(): Inputs {
    const days = lastDays(20);
    return {
      ...empty(),
      health: days.map((date, i) => ({ date, metrics: { weightKg: i % 4 === 3 ? 81.5 : 80 } })),
      daily: days.map((date, i) => ({ date, energy: i % 4 === 3 ? 2 : 4 })),
    };
  }

  test("a quick gain is a pattern input, worded in the user's unit", () => {
    const [p] = findPatterns(gains(), lastDays(20));
    expect(p).toMatchObject({ outcome: "energy", factor: "weightGain", side: "yes", worse: 2, other: 4 });
    expect(patternText(p, "en")).toBe("Energy averaged 2/5 on days with a weight gain of 2 lb or more over 3 days (5 days), vs 4/5 on other days (14).");
    expect(patternText(p, "en", KG)).toContain("a weight gain of 1 kg or more over 3 days");
  });

  test("weight is never a pattern outcome, and isn't called better or worse after a medication change", () => {
    const days = lastDays(28);
    const input: Inputs = { ...empty(), health: days.map((date, i) => ({ date, metrics: { weightKg: i < 14 ? 80 : 82 } })) };
    expect(findPatterns(input, days).filter((p) => p.outcome === "weight")).toEqual([]);
    const [e] = medEffects(input, [{ name: "Prednisone", kind: "started", date: days[14] }], days, TODAY);
    expect(e).toMatchObject({ outcome: "weight", before: 80, after: 82 });
    expect(e.better).toBeUndefined();
    expect(medEffectText(e, "en")).toBe("Weight since starting Prednisone on Oct 20: 180.8 lb, vs 176.4 lb in the 2 weeks before.");
    expect(medEffectText(e, "en", KG)).toBe("Weight since starting Prednisone on Oct 20: 82 kg, vs 80 kg in the 2 weeks before.");
    const [week] = weekStats(input, days, TODAY);
    expect(week.better).toBeUndefined();
    expect(weekStatLine(week, "en")).toBe("Weight: 180.8 lb (last week 180.8 lb)");
  });

  test("the chart is in the user's unit with a 7-day average", () => {
    const days = lastDays(10);
    const input: Inputs = { ...empty(), health: days.map((date, i) => ({ date, metrics: { weightKg: 80 + (i % 2) } })) };
    const lb = chartSeries(input, "weightKg", days);
    expect(lb.points[0]).toEqual({ date: days[0], value: 176.4 });
    expect(lb.trend![0]).toEqual({ date: days[1], value: 177.5 });
    const kg = chartSeries(input, "weightKg", days, undefined, KG);
    expect(kg.trend!.at(-1)).toEqual({ date: TODAY, value: 80.6 });
    // Other measures have no average line.
    expect(chartSeries({ ...empty(), daily: days.map((date) => ({ date, mood: 3 })) }, "mood", days).trend).toBeUndefined();
  });

  test("the model reads weight in the user's unit", () => {
    expect(formatDays([{ date: TODAY, metrics: { weightKg: 80 } }])).toBe(`${TODAY}: weight 176.4 lb`);
    expect(formatDays([{ date: TODAY, metrics: { weightKg: 80 } }], KG)).toBe(`${TODAY}: weight 80 kg`);
  });
});

describe("glucose", () => {
  // 20 days: under 6 hours of sleep on even days, with glucose about 190; a full night on odd days, about 140.
  function sleepAndGlucose(fromSensor: boolean): Inputs {
    const days = lastDays(20);
    const value = (i: number) => (i % 2 ? 140 : 190);
    return {
      ...empty(),
      trackers: fromSensor ? [] : days.flatMap((d, i) => [glucose(d, value(i) - 10), glucose(d, value(i) + 10)]),
      health: days.map((date, i) => ({ date, metrics: { sleepHours: i % 2 ? 8 : 5, ...(fromSensor && { glucoseAvg: value(i) }) } })),
    };
  }

  test("short sleep goes with higher glucose, from logged readings or a sensor, in either unit", () => {
    for (const fromSensor of [false, true]) {
      const [p] = findPatterns(sleepAndGlucose(fromSensor), lastDays(20));
      expect(p).toMatchObject({ outcome: "glucose", factor: "sleepHours", side: "below", worse: 190, other: 140 });
      expect(patternText(p, "en")).toBe("Glucose averaged 190 mg/dL on days with under 6.5 h of sleep (10 days), vs 140 mg/dL on other days (10).");
      expect(patternText(p, "en", KG)).toBe("Glucose averaged 10.5 mmol/L on days with under 6.5 h of sleep (10 days), vs 7.8 mmol/L on other days (10).");
    }
  });

  test("a sensor's day wins over readings logged by hand on the same day", () => {
    const input: Inputs = { ...empty(), trackers: [glucose(TODAY, 200)], health: [{ date: TODAY, metrics: { glucoseAvg: 150 } }] };
    expect(chartSeries(input, "glucose", [TODAY]).points).toEqual([{ date: TODAY, value: 150 }]);
    expect(chartSeries(input, "glucose", [TODAY], undefined, KG).points).toEqual([{ date: TODAY, value: 8.3 }]);
  });

  test("the phone sums a day of readings up; odd values are dropped", () => {
    expect(glucoseDay([60, 100, 150, 200])).toEqual({ glucoseAvg: 127.5, glucoseMin: 60, glucoseMax: 200, glucoseInRange: 50, glucoseReadings: 4 });
    expect(cleanMetrics({ glucoseAvg: 127.5, glucoseMin: 60, glucoseMax: 900, glucoseInRange: 50, glucoseReadings: 4 })).toEqual({ glucoseAvg: 128, glucoseMin: 60, glucoseInRange: 50, glucoseReadings: 4 });
    expect(formatDays([{ date: TODAY, metrics: { glucoseAvg: 128, glucoseMin: 60, glucoseMax: 200, glucoseInRange: 50, glucoseReadings: 4 } }])).toBe(
      `${TODAY}: glucose average 128 mg/dL (60 mg/dL to 200 mg/dL, 50% in range, 4 readings)`,
    );
  });

  test("readings are checked and summed up for the model and reports", () => {
    expect(cleanGlucose({ value: 10 })).toEqual({ error: expect.stringMatching(/between 20 and 600/) });
    expect(cleanGlucose({ value: 142.4, context: "fasting" })).toEqual({ value: 142, context: "fasting" });
    expect(cleanGlucose({ value: 142, context: "brunch" })).toEqual({ value: 142, context: undefined });
    const text = trackersText([{ ...glucose(TODAY, 110), glucose: { value: 110, context: "fasting" } }, glucose(TODAY, 190)]);
    expect(text).toBe(`Glucose: 2 readings, average 150 mg/dL, 110 mg/dL to 190 mg/dL.\n${TODAY}: glucose 110 mg/dL (fasting)\n${TODAY}: glucose 190 mg/dL`);
  });

  test("logged from the Journal and from chat; chat readings in mmol/L are stored in mg/dL", async () => {
    const t = setup();
    const { userId, as } = await createAppUser(t);
    await as.mutation(api.trackers.add, { tracker: "glucose", glucose: { value: 128, context: "fasting" } });
    await expect(as.mutation(api.trackers.add, { tracker: "glucose", glucose: { value: 900 } })).rejects.toThrow(/between 20 and 600/);
    expect(await t.mutation(internal.trackers.fromChat, { userId, tracker: "glucose", glucose: { value: Math.round(glucoseToMgdl(7.9, "mmol/L")) } })).toMatch(/^Logged a glucose entry/);
    const view = await as.query(api.trackers.view, { since: shiftDate(TODAY, -7) });
    expect(view!.glucose.map((g) => [g.value, g.context ?? null])).toEqual([
      [128, "fasting"],
      [142, null],
    ]);
  });

  test("a morning check-in when glucose runs well above their usual for two days", () => {
    const days = lastDays(10).map((date, i) => ({ date, metrics: { glucoseAvg: i >= 8 ? 185 : 140 } }));
    const signal = detect(days, TODAY);
    expect(signal).toEqual({ kind: "glucose", avg: 185, base: 140 });
    expect(checkinText(signal!, "en")).toBe(
      "🩺 Your glucose has averaged 185 mg/dL the last two days, higher than your usual 140 mg/dL. Short sleep, stress, a missed dose, or getting sick can all push it up. How are you doing?",
    );
    expect(checkinText(signal!, "en", KG)).toContain("10.3 mmol/L");
    expect(detect(lastDays(10).map((date) => ({ date, metrics: { glucoseAvg: 140 } })), TODAY)).toBeNull();
  });
});

describe("medication markers on charts", () => {
  test("one per day in the chart's range; a start wins over a dose change", () => {
    const marks = chartMarks(
      [
        { name: "Metformin", kind: "dose_changed", date: "2026-10-20" },
        { name: "Lisinopril", kind: "started", date: "2026-10-20" },
        { name: "Old", kind: "started", date: "2026-09-01" },
        { name: "Metformin", kind: "dose_changed", date: "2026-10-28" },
      ],
      "2026-10-06",
      TODAY,
    );
    expect(marks).toEqual([
      { date: "2026-10-20", name: "Lisinopril", kind: "started" },
      { date: "2026-10-28", name: "Metformin", kind: "dose_changed" },
    ]);
  });

  test("the dashboard and charts in chat carry the person's own changes", async () => {
    const t = setup();
    const { userId, as } = await createAppUser(t);
    await t.run(async (ctx) => {
      await ctx.db.patch(userId, { timeZone: "UTC" });
      const medicationId = await ctx.db.insert("medications", { userId, name: "Metformin", schedule: { kind: "daily", times: ["08:00"] }, timeZone: "UTC", utcOffsetMin: 0, active: true });
      await ctx.db.insert("medicationEvents", { userId, medicationId, kind: "started", at: Date.parse("2026-10-20T09:00:00Z") });
      for (const [i, date] of lastDays(10).entries()) await ctx.db.insert("trackerEntries", { userId, ...glucose(date, 150 + (i % 3)), source: "manual" });
    });
    const dash = await as.query(api.dashboard.view, { today: TODAY, now: NOW });
    expect(dash!.charts[0]).toMatchObject({ metric: "glucose", unit: "mg/dL", meds: [{ date: "2026-10-20", name: "Metformin", kind: "started" }] });
    // Weekly averages in mg/dL are whole numbers, like the readings.
    expect([dash!.charts[0].week, dash!.charts[0].prevWeek]).toEqual([151, 151]);
    const chart = await t.query(internal.insights.chartFor, { userId, metric: "glucose", days: 30 });
    expect(chart).toMatchObject({ meds: [{ date: "2026-10-20", name: "Metformin" }] });
  });
});

describe("lab results before and after a medication change", () => {
  const a1c = (date: string, value: number) => ({ key: "a1c", test: "HbA1c", date, value, unit: "%", high: 5.6 });

  test("a result before the change and one a few months after, with the range it crossed", () => {
    const [e] = labEffects([a1c("2026-05-10", 8.1), a1c("2026-06-01", 8.3), a1c("2026-09-15", 7.2)], [{ name: "metformin", kind: "dose_changed", date: "2026-06-12" }]);
    expect(e).toMatchObject({ test: "HbA1c", before: 8.3, after: 7.2, beforeDate: "2026-06-01", afterDate: "2026-09-15", months: 3 });
    expect(e.range).toBeUndefined();
    expect(labEffectText(e, "en")).toBe("HbA1c went from 8.3% to 7.2% in the 3 months after changing the dose of metformin (Jun 12).");
    const [back] = labEffects([a1c("2026-06-01", 6.1), a1c("2026-07-20", 5.4)], [{ name: "metformin", kind: "started", date: "2026-06-12" }]);
    expect(labEffectText(back, "en")).toBe("HbA1c went from 6.1% to 5.4% in the month after starting metformin (Jun 12), back in the normal range.");
    expect(labEffectText(back, "es")).toBe("HbA1c pasó de 6,1% a 5,4% en 1 mes después de empezar metformin (12 jun), de nuevo en el rango normal.");
  });

  test("nothing without a result on both sides, too soon after, or when the value didn't move", () => {
    const change = [{ name: "metformin", kind: "started" as const, date: "2026-06-12" }];
    expect(labEffects([a1c("2026-09-15", 7.2)], change)).toEqual([]);
    expect(labEffects([a1c("2026-06-01", 8.1), a1c("2026-06-20", 7.2)], change)).toEqual([]);
    expect(labEffects([a1c("2026-06-01", 8.1), a1c("2026-09-15", 8.1)], change)).toEqual([]);
  });

  test("the main measure is shown alongside when there are days to compare", () => {
    const days = lastDays(200);
    const input: Inputs = { ...empty(), trackers: days.map((d) => glucose(d, d < "2026-06-12" ? 180 : 140)) };
    const [e] = labEffects([a1c("2026-06-01", 8.1), a1c("2026-09-15", 7.2)], [{ name: "metformin", kind: "started", date: "2026-06-12" }], input, days);
    expect(e.alongside).toEqual({ outcome: "glucose", before: 180, after: 140 });
    expect(labEffectText(e, "en")).toMatch(/ Glucose averaged 140 mg\/dL in the month before the later test, vs 180 mg\/dL before the earlier one\.$/);
  });

  test("the Journal card and the model get them from uploaded reports", async () => {
    const t = setup();
    const { userId, as } = await createAppUser(t);
    await t.run(async (ctx) => {
      await ctx.db.patch(userId, { timeZone: "UTC" });
      const medicationId = await ctx.db.insert("medications", { userId, name: "Metformin", schedule: { kind: "daily", times: ["08:00"] }, timeZone: "UTC", utcOffsetMin: 0, active: true });
      await ctx.db.insert("medicationEvents", { userId, medicationId, kind: "started", at: Date.parse("2026-06-12T09:00:00Z") });
      for (const [date, value] of [["2026-06-01", 8.1], ["2026-09-15", 7.2]] as const) {
        const recordId = await ctx.db.insert("records", { userId, status: "done", fileType: "pdf", kind: "lab", date });
        await ctx.db.insert("labResults", { userId, recordId, date, test: "HbA1c", key: "hba1c", value, unit: "%", high: 5.6, explanation: "" });
      }
    });
    expect((await as.query(api.insights.view, { today: TODAY }))!.labEffects).toEqual([
      "HbA1c went from 8.1% to 7.2% in the 3 months after starting Metformin (Jun 12).",
    ]);
    expect(await t.query(internal.insights.forModel, { userId })).toContain("Lab results before and after medication changes");
  });
});

describe("air quality alerts", () => {
  async function seed(t: ReturnType<typeof setup>, userId: Id<"users">, aqi: number) {
    await t.run(async (ctx) => {
      await ctx.db.patch(userId, { timeZone: "UTC", location: "Berkeley, CA" });
      await ctx.db.insert("weatherDays", { userId, date: TOMORROW, aqi });
    });
  }

  test("the wording follows the band", () => {
    const sensitive = airAlertText(130, "en");
    expect(sensitive.title).toBe("Air quality alert for tomorrow");
    expect(sensitive.text).toBe(
      "😷 **Air quality alert for tomorrow**\n\nTomorrow's air quality index is forecast to reach 130 (unhealthy for sensitive groups). People with asthma or other lung or heart conditions, older adults, and children should cut back on long or hard time outdoors. If you use a reliever inhaler, keep it with you.",
    );
    expect(airAlertText(180, "en").text).toContain("(unhealthy). Everyone should cut back");
    expect(airAlertText(180, "es").title).toBe("Alerta de calidad del aire para mañana");
  });

  test("everyone with a location gets one at 7 PM for an index of 101 or more, with a push; not below, and not when off", async () => {
    const t = setup();
    const { calls } = mockApis();
    const bad = await createAppUser(t);
    const fine = await createAppUser(t, "b@example.com");
    const off = await createAppUser(t, "c@example.com");
    await bad.as.mutation(api.push.register, { token: "ExponentPushToken[aaaaaaaaaaaaaaaaaaaaaa]", platform: "ios" });
    await seed(t, bad.userId, 135);
    await seed(t, fine.userId, 80);
    await seed(t, off.userId, 160);
    await off.as.mutation(api.forecast.setAirAlerts, { enabled: false });
    await t.mutation(internal.forecast.scan, {});
    await settle(t);
    expect((await messagesOf(t, bad.userId)).filter((m) => m.kind === "forecast").map((m) => m.text)).toEqual([expect.stringMatching(/^😷 \*\*Air quality alert for tomorrow\*\*/)]);
    expect(pushSends(calls)).toEqual([expect.objectContaining({ title: "Air quality alert for tomorrow", body: expect.stringContaining("reach 135") })]);
    for (const u of [fine, off]) expect((await messagesOf(t, u.userId)).filter((m) => m.kind === "forecast")).toEqual([]);
  });

  test("still sent with the flare forecast switched off", async () => {
    const t = setup();
    mockApis();
    const u = await createAppUser(t);
    await seed(t, u.userId, 155);
    await u.as.mutation(api.forecast.setEnabled, { enabled: false });
    await t.mutation(internal.forecast.scan, {});
    await settle(t);
    expect((await messagesOf(t, u.userId)).filter((m) => m.kind === "forecast")).toHaveLength(1);
  });
});

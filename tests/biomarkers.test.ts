// Weight as a pattern input, units, and medication markers on charts.
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "../convex/_generated/api";
import { Id } from "../convex/_generated/dataModel";
import { chartMarks, chartSeries, dateList, findPatterns, Inputs, medEffects, shiftDate, weekStats } from "../convex/lib/insights";
import { medEffectText, patternText, weekStatLine } from "../convex/lib/insightsText";
import { formatDays } from "../convex/lib/health";
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
});

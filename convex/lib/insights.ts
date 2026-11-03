// Insights: turns everything a user logs (symptoms, trackers, the daily check-in, Apple Health / Health Connect days,
// local weather) into one number per day per measure, then finds what goes with days getting worse, what changed
// after a medication was started or its dose changed, and the series for charts in chat.
// Pure functions; convex/insights.ts gathers the rows. Wording is in ./insightsText.ts.
import { v } from "convex/values";
import type { Entry, DailyLog } from "./journal";
import type { HealthDay } from "./health";
import type { TrackerEntry } from "./trackers";
import type { WeatherDay } from "./weather";

export type Series = Map<string, number>; // date -> value

// What the user wants to get better. `worse`: which direction is bad. `min`: the smallest gap worth a mention.
export type OutcomeKey = "pain" | "mood" | "energy" | "sleepQuality" | "peakFlow" | "reliever" | "seizures" | `symptom:${string}`;
export type Outcome = { key: OutcomeKey; worse: "high" | "low"; min: number; values: Series };

// Things that might go with it. `lag` 1 means the day before counts (yesterday's steps, today's pain).
export const FACTOR_KEYS = [
  "sleepHours", "sleepQuality", "steps", "restingHeartRate", "hrv", "period",
  "tempMax", "humidity", "pressureDrop", "rain", "aqi", "pollen",
] as const;
export type FactorKey = (typeof FACTOR_KEYS)[number];
type Factor = { key: FactorKey; values: Series; lag: 0 | 1; binary?: boolean; step: number };

export type Inputs = {
  entries: Entry[]; // symptom journal (pain tracker scores are added separately)
  trackers: TrackerEntry[];
  daily: DailyLog[];
  health: HealthDay[];
  weather: WeatherDay[];
};

const MIN_PAIRS = 10; // days with both numbers before a pattern counts
const MIN_GROUP = 4; // days on each side
const MIN_EFFECT = 0.5; // the gap in standard deviations
export const MAX_SYMPTOMS = 3; // the most-rated symptoms get their own outcome

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const sd = (xs: number[]) => {
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / Math.max(1, xs.length - 1));
};
const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};
const r1 = (n: number) => Math.round(n * 10) / 10;

export function shiftDate(date: string, days: number) {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

// The same records from `from` on.
export function sliceInputs(input: Inputs, from: string): Inputs {
  const keep = <T extends { date: string }>(xs: T[]) => xs.filter((x) => x.date >= from);
  return { entries: keep(input.entries), trackers: keep(input.trackers), daily: keep(input.daily), health: keep(input.health), weather: keep(input.weather) };
}

export function dateList(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to && out.length < 400; d = shiftDate(d, 1)) out.push(d);
  return out;
}

function maxBy(pairs: [string, number][]): Series {
  const out: Series = new Map();
  for (const [d, x] of pairs) out.set(d, Math.max(out.get(d) ?? -Infinity, x));
  return out;
}
function minBy(pairs: [string, number][]): Series {
  const out: Series = new Map();
  for (const [d, x] of pairs) out.set(d, Math.min(out.get(d) ?? Infinity, x));
  return out;
}
function sumBy(pairs: [string, number][]): Series {
  const out: Series = new Map();
  for (const [d, x] of pairs) out.set(d, (out.get(d) ?? 0) + x);
  return out;
}

// Every outcome with data. Seizures count per day from the first logged one, so seizure-free days count as 0.
export function outcomes(input: Inputs, dates: string[]): Outcome[] {
  const out: Outcome[] = [];
  const pain = maxBy([
    ...input.trackers.flatMap((e): [string, number][] => (e.pain ? [[e.date, e.pain.severity]] : [])),
    ...input.entries.flatMap((e): [string, number][] => (e.symptom === "pain" && e.severity !== undefined ? [[e.date, e.severity]] : [])),
  ]);
  if (pain.size) out.push({ key: "pain", worse: "high", min: 1, values: pain });

  const rated = new Map<string, [string, number][]>();
  for (const e of input.entries) {
    if (e.severity === undefined || e.symptom === "pain") continue;
    rated.set(e.symptom, [...(rated.get(e.symptom) ?? []), [e.date, e.severity]]);
  }
  for (const [symptom, pairs] of [...rated].sort((a, b) => b[1].length - a[1].length).slice(0, MAX_SYMPTOMS)) {
    out.push({ key: `symptom:${symptom}`, worse: "high", min: 1, values: maxBy(pairs) });
  }

  for (const key of ["mood", "energy", "sleepQuality"] as const) {
    const values: Series = new Map(input.daily.flatMap((d): [string, number][] => (d[key] === undefined ? [] : [[d.date, d[key]!]])));
    if (values.size) out.push({ key, worse: "low", min: 0.5, values });
  }

  const asthma = input.trackers.filter((e) => e.asthma);
  const peak = minBy(asthma.flatMap((e): [string, number][] => (e.asthma!.peakFlow !== undefined ? [[e.date, e.asthma!.peakFlow]] : [])));
  if (peak.size) out.push({ key: "peakFlow", worse: "low", min: Math.max(10, r1(mean([...peak.values()]) * 0.05)), values: peak });
  const puffs = sumBy(asthma.flatMap((e): [string, number][] => (e.asthma!.reliever !== undefined ? [[e.date, e.asthma!.reliever]] : [])));
  if (puffs.size) out.push({ key: "reliever", worse: "high", min: 1, values: puffs });

  const seizures = input.trackers.filter((e) => e.tracker === "seizure");
  if (seizures.length) {
    const first = seizures.map((e) => e.date).sort()[0];
    const counts = sumBy(seizures.map((e): [string, number] => [e.date, 1]));
    out.push({ key: "seizures", worse: "high", min: 0.2, values: new Map(dates.filter((d) => d >= first).map((d) => [d, counts.get(d) ?? 0])) });
  }
  return out;
}

function factors(input: Inputs): Factor[] {
  const health = (key: "sleepHours" | "steps" | "restingHeartRate" | "hrvMs"): Series =>
    new Map(input.health.flatMap((d): [string, number][] => (d.metrics[key] === undefined ? [] : [[d.date, d.metrics[key]!]])));
  const weather = (pick: (w: WeatherDay) => number | undefined): Series =>
    new Map(input.weather.flatMap((w): [string, number][] => {
      const x = pick(w);
      return x === undefined ? [] : [[w.date, x]];
    }));
  const byDate = new Map(input.weather.map((w) => [w.date, w]));
  const pressureDrop: Series = new Map(
    input.weather.flatMap((w): [string, number][] => {
      const before = byDate.get(shiftDate(w.date, -1))?.pressure;
      return w.pressure === undefined || before === undefined ? [] : [[w.date, before - w.pressure >= 3 ? 1 : 0]];
    }),
  );
  return [
    { key: "sleepHours", values: health("sleepHours"), lag: 0, step: 0.5 },
    { key: "sleepQuality", values: new Map(input.daily.flatMap((d): [string, number][] => (d.sleepQuality === undefined ? [] : [[d.date, d.sleepQuality]]))), lag: 0, step: 1 },
    { key: "steps", values: health("steps"), lag: 1, step: 500 },
    { key: "restingHeartRate", values: health("restingHeartRate"), lag: 0, step: 1 },
    { key: "hrv", values: health("hrvMs"), lag: 0, step: 1 },
    {
      key: "period",
      values: new Map(input.health.flatMap((d): [string, number][] => (d.metrics.menstrualFlow === undefined ? [] : [[d.date, d.metrics.menstrualFlow === "none" ? 0 : 1]]))),
      lag: 0,
      binary: true,
      step: 1,
    },
    { key: "tempMax", values: weather((w) => w.tempMax), lag: 0, step: 1 },
    { key: "humidity", values: weather((w) => w.humidity), lag: 0, step: 5 },
    { key: "pressureDrop", values: pressureDrop, lag: 0, binary: true, step: 1 },
    { key: "rain", values: weather((w) => (w.precip === undefined ? undefined : w.precip >= 1 ? 1 : 0)), lag: 0, binary: true, step: 1 },
    { key: "aqi", values: weather((w) => w.aqi), lag: 0, step: 5 },
    { key: "pollen", values: weather((w) => w.pollen), lag: 0, step: 5 },
  ];
}

// A pattern: on days on the `side` of `threshold` (or "yes" days for a yes/no factor), the outcome was worse.
export type Pattern = {
  outcome: OutcomeKey;
  factor: FactorKey;
  side: "below" | "atLeast" | "yes";
  threshold?: number;
  worse: number; // the outcome's average on those days
  other: number; // and on the rest
  worseDays: number;
  otherDays: number;
  effect: number; // the gap in standard deviations, for ranking
};

function compare(o: Outcome, f: Factor): Pattern | null {
  const pairs: [number, number][] = [];
  for (const [date, y] of o.values) {
    const x = f.values.get(f.lag ? shiftDate(date, -1) : date);
    if (x !== undefined) pairs.push([x, y]);
  }
  if (pairs.length < MIN_PAIRS) return null;
  const ys = pairs.map(([, y]) => y);
  const spread = sd(ys);
  if (!spread) return null;

  // Split at the factor's median, rounded to a friendly step; yes/no factors split on yes.
  const threshold = f.binary ? 1 : Math.round(median(pairs.map(([x]) => x)) / f.step) * f.step;
  const high = pairs.filter(([x]) => x >= threshold).map(([, y]) => y);
  const low = pairs.filter(([x]) => x < threshold).map(([, y]) => y);
  if (high.length < MIN_GROUP || low.length < MIN_GROUP) return null;
  const gap = mean(high) - mean(low);
  if (Math.abs(gap) < o.min || Math.abs(gap) / spread < MIN_EFFECT) return null;

  // The side where the outcome is worse.
  const highIsWorse = o.worse === "high" ? gap > 0 : gap < 0;
  if (f.binary && !highIsWorse) return null; // "no rain goes with more pain" isn't worth saying
  const [worse, other] = highIsWorse ? [high, low] : [low, high];
  return {
    outcome: o.key,
    factor: f.key,
    side: f.binary ? "yes" : highIsWorse ? "atLeast" : "below",
    threshold: f.binary ? undefined : r1(threshold),
    worse: r1(mean(worse)),
    other: r1(mean(other)),
    worseDays: worse.length,
    otherDays: other.length,
    effect: Math.abs(gap) / spread,
  };
}

// The strongest patterns, at most two per outcome. Associations, not causes; the wording says so.
export function findPatterns(input: Inputs, dates: string[], limit = 6): Pattern[] {
  const fs = factors(input);
  const found: Pattern[] = [];
  for (const o of outcomes(input, dates)) {
    // Sleep quality is both an outcome and a factor; never compare it with itself.
    found.push(...fs.filter((f) => f.key !== o.key).flatMap((f) => compare(o, f) ?? []).sort((a, b) => b.effect - a.effect).slice(0, 2));
  }
  return found.sort((a, b) => b.effect - a.effect).slice(0, limit);
}

// ---------- Medications: before and after ----------

export type MedChange = { name: string; kind: "started" | "dose_changed"; date: string; note?: string };
export type MedEffect = MedChange & { outcome: OutcomeKey; before: number; after: number; better: boolean; days: number };

const WINDOW = 14;
const MIN_SIDE = 4;

// For each start or dose change in the last months: each outcome's average in the two weeks before vs the days
// after (up to two weeks, at least four), when the change is big enough to matter.
export function medEffects(input: Inputs, changes: MedChange[], dates: string[], today: string): MedEffect[] {
  const os = outcomes(input, dates);
  const out: MedEffect[] = [];
  for (const c of changes) {
    for (const o of os) {
      const before: number[] = [];
      const after: number[] = [];
      for (const [date, y] of o.values) {
        if (date >= shiftDate(c.date, -WINDOW) && date < c.date) before.push(y);
        else if (date > c.date && date <= shiftDate(c.date, WINDOW) && date <= today) after.push(y);
      }
      if (before.length < MIN_SIDE || after.length < MIN_SIDE) continue;
      const gap = mean(after) - mean(before);
      if (Math.abs(gap) < o.min) continue;
      out.push({ ...c, outcome: o.key, before: r1(mean(before)), after: r1(mean(after)), better: o.worse === "high" ? gap < 0 : gap > 0, days: after.length });
    }
  }
  return out.sort((a, b) => b.date.localeCompare(a.date)).slice(0, 8);
}

// ---------- Charts in chat ----------

export const CHART_METRICS = [
  "pain", "symptom", "mood", "energy", "sleepQuality", "sleepHours", "steps", "restingHeartRate", "hrv",
  "weightKg", "peakFlow", "reliever", "seizures", "tempMax", "aqi", "pollen",
] as const;
export type ChartMetric = (typeof CHART_METRICS)[number];

export const chartValidator = v.object({
  metric: v.string(),
  title: v.string(),
  unit: v.string(),
  max: v.number(),
  worse: v.union(v.literal("high"), v.literal("low"), v.literal("none")),
  from: v.string(),
  to: v.string(),
  points: v.array(v.object({ date: v.string(), value: v.number() })),
});
export type Chart = {
  metric: string;
  title: string;
  unit: string;
  max: number;
  worse: "high" | "low" | "none";
  from: string;
  to: string;
  points: { date: string; value: number }[];
};

const SCALE: Partial<Record<ChartMetric, number>> = { pain: 10, symptom: 10, mood: 5, energy: 5, sleepQuality: 5 };
const WORSE: Partial<Record<ChartMetric, "high" | "low">> = {
  pain: "high", symptom: "high", mood: "low", energy: "low", sleepQuality: "low", peakFlow: "low", reliever: "high", seizures: "high", aqi: "high", pollen: "high",
};

// One value per day for a chart, oldest first. `symptom` picks a journal symptom by name.
export function chartSeries(input: Inputs, metric: ChartMetric, dates: string[], symptom?: string): { points: { date: string; value: number }[]; max: number; worse: "high" | "low" | "none" } {
  let values: Series;
  if (metric === "symptom") {
    values = maxBy(input.entries.flatMap((e): [string, number][] => (e.symptom === symptom && e.severity !== undefined ? [[e.date, e.severity]] : [])));
  } else if (["pain", "mood", "energy", "sleepQuality", "peakFlow", "reliever", "seizures"].includes(metric)) {
    values = outcomes(input, dates).find((o) => o.key === metric)?.values ?? new Map();
  } else if (metric === "tempMax" || metric === "aqi" || metric === "pollen") {
    values = new Map(input.weather.flatMap((w): [string, number][] => (w[metric] === undefined ? [] : [[w.date, w[metric]!]])));
  } else {
    const key = metric === "hrv" ? "hrvMs" : (metric as "sleepHours" | "steps" | "restingHeartRate" | "weightKg");
    values = new Map(input.health.flatMap((d): [string, number][] => (d.metrics[key] === undefined ? [] : [[d.date, d.metrics[key]!]])));
  }
  const points = dates.flatMap((date) => (values.has(date) ? [{ date, value: Math.round(values.get(date)! * 10) / 10 }] : []));
  const top = Math.max(0, ...points.map((p) => p.value));
  return { points, max: SCALE[metric] ?? (top || 1), worse: WORSE[metric] ?? "none" };
}

// ---------- The week in numbers (weekly summary) ----------

export type WeekStat = { outcome: OutcomeKey; thisWeek: number; lastWeek?: number; days: number; better?: boolean };

// Each outcome's average this week (and last week, when there's enough), worst change first.
export function weekStats(input: Inputs, dates: string[], today: string): WeekStat[] {
  const start = shiftDate(today, -6);
  const prevStart = shiftDate(today, -13);
  const out: WeekStat[] = [];
  for (const o of outcomes(input, dates)) {
    const now = [...o.values].filter(([d]) => d >= start && d <= today).map(([, y]) => y);
    const prev = [...o.values].filter(([d]) => d >= prevStart && d < start).map(([, y]) => y);
    if (!now.length) continue;
    const stat: WeekStat = { outcome: o.key, thisWeek: r1(mean(now)), days: now.length };
    if (prev.length >= 2) {
      stat.lastWeek = r1(mean(prev));
      const gap = stat.thisWeek - stat.lastWeek;
      if (Math.abs(gap) >= o.min) stat.better = o.worse === "high" ? gap < 0 : gap > 0;
    }
    out.push(stat);
  }
  return out;
}

// Insights: turns everything a user logs (symptoms, trackers, the daily check-in, Apple Health / Health Connect days,
// local weather) into one number per day per measure, then finds what goes with days getting worse, what changed
// after a medication was started or its dose changed, and the series for charts in chat.
// Pure functions; convex/insights.ts gathers the rows. Wording is in ./insightsText.ts.
import { v } from "convex/values";
import type { Entry, DailyLog } from "./journal";
import type { HealthDay } from "./health";
import type { TrackerEntry } from "./trackers";
import type { WeatherDay } from "./weather";
import { DEFAULT_UNITS, showGlucose, showWeight, type Units } from "./units";

export type Series = Map<string, number>; // date -> value

// What the user wants to get better. `worse`: which direction is bad. `min`: the smallest gap worth a mention.
// Weight has no bad direction ("none"): it's shown before and after medication changes and in the weekly summary,
// but never called better or worse, and patterns aren't looked for in it.
export type OutcomeKey = "pain" | "mood" | "energy" | "sleepQuality" | "peakFlow" | "reliever" | "seizures" | "glucose" | "weight" | `symptom:${string}`;
export type Outcome = { key: OutcomeKey; worse: "high" | "low" | "none"; min: number; values: Series };

// Things that might go with it. `lag` 1 means the day before counts (yesterday's steps, today's pain).
export const FACTOR_KEYS = [
  "sleepHours", "sleepQuality", "steps", "restingHeartRate", "hrv", "period", "weightGain", "glucose",
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

  const glucose = glucoseSeries(input);
  if (glucose.size) out.push({ key: "glucose", worse: "high", min: 10, values: glucose });

  const weight = weightSeries(input);
  if (weight.size) out.push({ key: "weight", worse: "none", min: WEIGHT_STEP_KG, values: weight });
  return out;
}

// The day's average glucose (mg/dL): from a sensor or meter in the phone's health data when there is one, else the
// average of the readings logged in the glucose tracker.
function glucoseSeries(input: Inputs): Series {
  const out: Series = new Map();
  const logged = new Map<string, number[]>();
  for (const e of input.trackers) if (e.glucose) logged.set(e.date, [...(logged.get(e.date) ?? []), e.glucose.value]);
  for (const [date, xs] of logged) out.set(date, mean(xs));
  for (const d of input.health) if (d.metrics.glucoseAvg !== undefined) out.set(d.date, d.metrics.glucoseAvg);
  return out;
}

// Weight (kg) per day from the phone's health data.
const weightSeries = (input: Inputs): Series =>
  new Map(input.health.flatMap((d): [string, number][] => (d.metrics.weightKg === undefined ? [] : [[d.date, d.metrics.weightKg]])));

// A gain this big over a few days is worth looking at (fluid, a flare, a new medicine); 1 kg is about 2 lb.
export const WEIGHT_STEP_KG = 1;
const GAIN_DAYS = 3;

// 1 on days weight is up 1 kg or more on its lowest in the 3 days before, 0 on other weighed days. Days with no
// weighing in the 3 days before are left out.
function weightGain(weight: Series): Series {
  const out: Series = new Map();
  for (const [date, kg] of weight) {
    const before = Array.from({ length: GAIN_DAYS }, (_, i) => weight.get(shiftDate(date, -(i + 1)))).filter((x): x is number => x !== undefined);
    if (before.length) out.set(date, kg - Math.min(...before) >= WEIGHT_STEP_KG ? 1 : 0);
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
    { key: "weightGain", values: weightGain(weightSeries(input)), lag: 0, binary: true, step: 1 },
    { key: "glucose", values: glucoseSeries(input), lag: 0, step: 10 },
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
// `only`: look at just these factors (the flare forecast wants every weather pattern, not the top two overall).
export function findPatterns(input: Inputs, dates: string[], limit = 6, only?: readonly FactorKey[]): Pattern[] {
  const fs = factors(input).filter((f) => !only || only.includes(f.key));
  const found: Pattern[] = [];
  for (const o of outcomes(input, dates)) {
    if (o.worse === "none") continue;
    // Sleep quality is both an outcome and a factor; never compare it with itself.
    found.push(...fs.filter((f) => f.key !== o.key).flatMap((f) => compare(o, f) ?? []).sort((a, b) => b.effect - a.effect).slice(0, 2));
  }
  return found.sort((a, b) => b.effect - a.effect).slice(0, limit);
}

// ---------- Flare forecast: tomorrow's weather against the user's own weather patterns ----------

export const WEATHER_FACTORS = ["tempMax", "humidity", "pressureDrop", "rain", "aqi", "pollen"] as const satisfies readonly FactorKey[];
export type ForecastMatch = { pattern: Pattern; value: number }; // `value`: the factor on `date` (1 or 0 for yes/no)

// The weather patterns `date`'s forecast falls on the worse side of, the strongest per outcome, at most `limit`.
export function forecastMatches(patterns: Pattern[], weather: WeatherDay[], date: string, limit = 2): ForecastMatch[] {
  const values = new Map(factors({ entries: [], trackers: [], daily: [], health: [], weather }).map((f) => [f.key, f.values.get(date)]));
  const out: ForecastMatch[] = [];
  for (const p of [...patterns].sort((a, b) => b.effect - a.effect)) {
    const value = values.get(p.factor);
    if (value === undefined || out.some((m) => m.pattern.outcome === p.outcome)) continue;
    const hit = p.side === "yes" ? value === 1 : p.side === "atLeast" ? value >= p.threshold! : value < p.threshold!;
    if (hit) out.push({ pattern: p, value });
  }
  return out.slice(0, limit);
}

// ---------- Medications: before and after ----------

export type MedChange = { name: string; kind: "started" | "dose_changed"; date: string; note?: string };
// `better` is left out for weight, which has no good or bad direction.
export type MedEffect = MedChange & { outcome: OutcomeKey; before: number; after: number; better?: boolean; days: number };

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
      out.push({ ...c, outcome: o.key, before: r1(mean(before)), after: r1(mean(after)), ...(o.worse !== "none" && { better: o.worse === "high" ? gap < 0 : gap > 0 }), days: after.length });
    }
  }
  return out.sort((a, b) => b.date.localeCompare(a.date)).slice(0, 8);
}

// ---------- Charts in chat ----------

export const CHART_METRICS = [
  "pain", "symptom", "mood", "energy", "sleepQuality", "sleepHours", "steps", "restingHeartRate", "hrv",
  "weightKg", "glucose", "peakFlow", "reliever", "seizures", "tempMax", "aqi", "pollen",
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
  // The 7-day average, drawn as a line of dots over the bars (weight, where single days jump around).
  trend: v.optional(v.array(v.object({ date: v.string(), value: v.number() }))),
  // Medication starts and dose changes in the chart's days, marked above the bars.
  meds: v.optional(v.array(v.object({ date: v.string(), name: v.string(), kind: v.union(v.literal("started"), v.literal("dose_changed")) }))),
});
export type ChartMark = { date: string; name: string; kind: "started" | "dose_changed" };
export type Chart = {
  metric: string;
  title: string;
  unit: string;
  max: number;
  worse: "high" | "low" | "none";
  from: string;
  to: string;
  points: { date: string; value: number }[];
  trend?: { date: string; value: number }[];
  meds?: ChartMark[];
};

// The changes to mark on a chart from `from` to `to`, at most one per day (a start wins over a dose change).
export function chartMarks(changes: MedChange[], from: string, to: string): ChartMark[] {
  const byDate = new Map<string, ChartMark>();
  for (const c of [...changes].sort((a, b) => (a.kind === "started" ? 1 : 0) - (b.kind === "started" ? 1 : 0))) {
    if (c.date >= from && c.date <= to) byDate.set(c.date, { date: c.date, name: c.name, kind: c.kind });
  }
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}

const SCALE: Partial<Record<ChartMetric, number>> = { pain: 10, symptom: 10, mood: 5, energy: 5, sleepQuality: 5 };
const WORSE: Partial<Record<ChartMetric, "high" | "low">> = {
  pain: "high", symptom: "high", mood: "low", energy: "low", sleepQuality: "low", peakFlow: "low", reliever: "high", seizures: "high", aqi: "high", pollen: "high",
  glucose: "high",
};

// One value per day for a chart, oldest first, in the user's units. `symptom` picks a journal symptom by name.
export function chartSeries(
  input: Inputs,
  metric: ChartMetric,
  dates: string[],
  symptom?: string,
  units: Units = DEFAULT_UNITS,
): { points: { date: string; value: number }[]; max: number; worse: "high" | "low" | "none"; trend?: { date: string; value: number }[] } {
  let values: Series;
  if (metric === "symptom") {
    values = maxBy(input.entries.flatMap((e): [string, number][] => (e.symptom === symptom && e.severity !== undefined ? [[e.date, e.severity]] : [])));
  } else if (metric === "glucose") {
    values = glucoseSeries(input);
  } else if (["pain", "mood", "energy", "sleepQuality", "peakFlow", "reliever", "seizures"].includes(metric)) {
    values = outcomes(input, dates).find((o) => o.key === metric)?.values ?? new Map();
  } else if (metric === "tempMax" || metric === "aqi" || metric === "pollen") {
    values = new Map(input.weather.flatMap((w): [string, number][] => (w[metric] === undefined ? [] : [[w.date, w[metric]!]])));
  } else {
    const key = metric === "hrv" ? "hrvMs" : (metric as "sleepHours" | "steps" | "restingHeartRate" | "weightKg");
    values = new Map(input.health.flatMap((d): [string, number][] => (d.metrics[key] === undefined ? [] : [[d.date, d.metrics[key]!]])));
  }
  const show = (x: number) => (metric === "weightKg" ? showWeight(x, units) : metric === "glucose" ? showGlucose(x, units) : x);
  const points = dates.flatMap((date) => (values.has(date) ? [{ date, value: r1(show(values.get(date)!)) }] : []));
  const top = Math.max(0, ...points.map((p) => p.value));
  const out = { points, max: SCALE[metric] ?? (top || 1), worse: WORSE[metric] ?? ("none" as const) };
  // Weight jumps a pound or two from day to day; the 7-day average shows where it's really heading.
  if (metric !== "weightKg" || points.length < 3) return out;
  const trend = dates.flatMap((date) => {
    const week = dates.filter((d) => d <= date && d > shiftDate(date, -7) && values.has(d)).map((d) => show(values.get(d)!));
    return week.length >= 2 ? [{ date, value: r1(mean(week)) }] : [];
  });
  return { ...out, trend };
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
      if (Math.abs(gap) >= o.min && o.worse !== "none") stat.better = o.worse === "high" ? gap < 0 : gap > 0;
    }
    out.push(stat);
  }
  return out;
}

// ---------- Lab results: before and after a medication change ----------

// A numeric lab result (convex/records.ts reads them from uploaded reports). `key` lines the same test up across reports.
export type LabPoint = { key: string; test: string; date: string; value: number; unit?: string; low?: number; high?: number };
export type LabEffect = MedChange & {
  test: string;
  unit?: string;
  before: number;
  after: number;
  beforeDate: string;
  afterDate: string;
  months: number; // from the change to the later result
  range?: "back_in" | "now_out"; // when the later result crossed the report's normal range
  // The person's main measure (pain, glucose, …) in the 30 days before each result, when both have enough days.
  alongside?: { outcome: OutcomeKey; before: number; after: number };
};

const LAB_BEFORE_DAYS = 180; // the earlier result: the latest one up to 6 months before the change
const LAB_AFTER = [21, 200] as const; // the later one: the latest from 3 weeks to about 6 months after
const ALONGSIDE_DAYS = 30;

const outOfRange = (x: number, p: LabPoint) => (p.low !== undefined && x < p.low) || (p.high !== undefined && x > p.high);

// Labs are tested every few months, so no day-by-day pattern can be claimed. Instead: for each medication start or
// dose change, each test with a result before it and another a few weeks to months after, when the value moved.
export function labEffects(labs: LabPoint[], changes: MedChange[], input?: Inputs, dates?: string[]): LabEffect[] {
  const byKey = new Map<string, LabPoint[]>();
  for (const p of [...labs].sort((a, b) => a.date.localeCompare(b.date))) byKey.set(p.key, [...(byKey.get(p.key) ?? []), p]);
  // The measure shown alongside: the first one with a bad direction (pain, symptoms, mood, glucose, …).
  const main = input && dates ? outcomes(input, dates).find((o) => o.worse !== "none") : undefined;
  const avgBefore = (date: string) => {
    if (!main) return undefined;
    const xs = [...main.values].filter(([d]) => d < date && d >= shiftDate(date, -ALONGSIDE_DAYS)).map(([, y]) => y);
    return xs.length >= MIN_SIDE ? r1(mean(xs)) : undefined;
  };
  const out: LabEffect[] = [];
  for (const c of changes) {
    for (const points of byKey.values()) {
      const before = points.filter((p) => p.date <= c.date && p.date >= shiftDate(c.date, -LAB_BEFORE_DAYS)).at(-1);
      const after = points.filter((p) => p.date >= shiftDate(c.date, LAB_AFTER[0]) && p.date <= shiftDate(c.date, LAB_AFTER[1])).at(-1);
      if (!before || !after || before.value === after.value) continue;
      const wasOut = outOfRange(before.value, before);
      const isOut = outOfRange(after.value, after);
      const days = Math.round((Date.parse(`${after.date}T00:00:00Z`) - Date.parse(`${c.date}T00:00:00Z`)) / 86_400_000);
      const [a, b] = [avgBefore(before.date), avgBefore(after.date)];
      out.push({
        ...c,
        test: after.test,
        unit: after.unit,
        before: before.value,
        after: after.value,
        beforeDate: before.date,
        afterDate: after.date,
        months: Math.max(1, Math.round(days / 30.4)),
        ...(wasOut && !isOut ? { range: "back_in" as const } : !wasOut && isOut ? { range: "now_out" as const } : {}),
        ...(main && a !== undefined && b !== undefined && { alongside: { outcome: main.key, before: a, after: b } }),
      });
    }
  }
  return out.sort((a, b) => b.afterDate.localeCompare(a.afterDate)).slice(0, 6);
}

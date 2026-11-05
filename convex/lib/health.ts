// Apple Health daily summaries: validation of what the phone sends, and the text the model and CREAO read.
// The phone sends one summary per local calendar day (convex/health.ts sync); raw samples never leave the phone.
import { Infer, v } from "convex/values";
import { DEFAULT_UNITS, fmtGlucose, fmtWeight, type Units } from "./units";

export const menstrualFlow = v.union(
  v.literal("none"),
  v.literal("unspecified"),
  v.literal("light"),
  v.literal("medium"),
  v.literal("heavy"),
);

// Where the phone read it: Apple Health (iPhone) or Health Connect (Android).
export const healthSource = v.union(v.literal("apple_health"), v.literal("health_connect"));
export const SOURCE_NAMES = { apple_health: "Apple Health", health_connect: "Health Connect" } as const;

export const healthMetrics = v.object({
  steps: v.optional(v.number()),
  activeEnergyKcal: v.optional(v.number()),
  restingHeartRate: v.optional(v.number()), // bpm
  hrvMs: v.optional(v.number()), // SDNN, ms
  sleepHours: v.optional(v.number()), // asleep time for the night ending on this day
  respiratoryRate: v.optional(v.number()), // breaths/min
  oxygenSaturation: v.optional(v.number()), // percent
  wristTempC: v.optional(v.number()), // Apple Watch sleeping wrist temperature
  weightKg: v.optional(v.number()),
  // Blood glucose for the day, from a sensor (Dexcom, Libre) or a meter that writes to the phone's health data:
  // the average, lowest and highest reading (mg/dL), the share of readings in 70-180 mg/dL, and how many there were.
  glucoseAvg: v.optional(v.number()),
  glucoseMin: v.optional(v.number()),
  glucoseMax: v.optional(v.number()),
  glucoseInRange: v.optional(v.number()), // percent
  glucoseReadings: v.optional(v.number()),
  menstrualFlow: v.optional(menstrualFlow),
});

export type HealthMetrics = Infer<typeof healthMetrics>;
export type HealthDay = { date: string; metrics: HealthMetrics };

type NumericKey = Exclude<keyof HealthMetrics, "menstrualFlow">;

// Plausible ranges; anything outside is dropped as a sensor or unit glitch.
const RANGES: Record<NumericKey, [number, number]> = {
  steps: [0, 150_000],
  activeEnergyKcal: [0, 15_000],
  restingHeartRate: [20, 250],
  hrvMs: [1, 500],
  sleepHours: [0, 24],
  respiratoryRate: [3, 80],
  oxygenSaturation: [50, 100],
  wristTempC: [25, 45],
  weightKg: [2, 650],
  glucoseAvg: [20, 600],
  glucoseMin: [20, 600],
  glucoseMax: [20, 600],
  glucoseInRange: [0, 100],
  glucoseReadings: [1, 5000],
};

// The usual target range for glucose readings, mg/dL.
export const GLUCOSE_RANGE = [70, 180] as const;

// A day of glucose readings (mg/dL) -> the day's summary. The phone does this, so single readings never leave it.
export function glucoseDay(readings: number[]): HealthMetrics {
  const xs = readings.filter((x) => Number.isFinite(x) && x > 0);
  if (!xs.length) return {};
  const inRange = xs.filter((x) => x >= GLUCOSE_RANGE[0] && x <= GLUCOSE_RANGE[1]).length;
  return {
    glucoseAvg: xs.reduce((a, b) => a + b, 0) / xs.length,
    glucoseMin: Math.min(...xs),
    glucoseMax: Math.max(...xs),
    glucoseInRange: (inRange / xs.length) * 100,
    glucoseReadings: xs.length,
  };
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
export const MAX_SYNC_DAYS = 90;

export function isDate(s: string) {
  return DATE.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`));
}

// ISO calendar date `days` before `now` (UTC).
export function dateDaysAgo(now: number, days: number) {
  return new Date(now - days * 86_400_000).toISOString().slice(0, 10);
}

// Keeps only plausible values, rounded to a sensible precision. Returns null when nothing is left.
export function cleanMetrics(m: HealthMetrics): HealthMetrics | null {
  const out: HealthMetrics = {};
  for (const key of Object.keys(RANGES) as NumericKey[]) {
    const value = m[key];
    if (typeof value !== "number" || !Number.isFinite(value)) continue;
    const [lo, hi] = RANGES[key];
    if (value < lo || value > hi) continue;
    out[key] = ["steps", "activeEnergyKcal", "glucoseAvg", "glucoseMin", "glucoseMax", "glucoseInRange", "glucoseReadings"].includes(key)
      ? Math.round(value)
      : Math.round(value * 10) / 10;
  }
  if (m.menstrualFlow) out.menstrualFlow = m.menstrualFlow;
  return Object.keys(out).length ? out : null;
}

const bleeding = (m: HealthMetrics) => !!m.menstrualFlow && m.menstrualFlow !== "none";

function mean(values: number[]) {
  return values.length ? values.reduce((s, x) => s + x, 0) / values.length : undefined;
}

const fmt = (n: number, digits = 0) => n.toLocaleString("en-US", { maximumFractionDigits: digits });

// One line per day, oldest first. Wrist temperature is shown as the change from the range's average, like the Health app.
export function formatDays(days: HealthDay[], units: Units = DEFAULT_UNITS): string {
  const tempBase = mean(days.flatMap((d) => (d.metrics.wristTempC === undefined ? [] : [d.metrics.wristTempC])));
  return days
    .map(({ date, metrics: m }) => {
      const parts: string[] = [];
      if (m.steps !== undefined) parts.push(`steps ${fmt(m.steps)}`);
      if (m.activeEnergyKcal !== undefined) parts.push(`active ${fmt(m.activeEnergyKcal)} kcal`);
      if (m.restingHeartRate !== undefined) parts.push(`resting HR ${fmt(m.restingHeartRate)} bpm`);
      if (m.hrvMs !== undefined) parts.push(`HRV ${fmt(m.hrvMs)} ms`);
      if (m.sleepHours !== undefined) parts.push(`sleep ${fmt(m.sleepHours, 1)} h`);
      if (m.respiratoryRate !== undefined) parts.push(`breathing ${fmt(m.respiratoryRate, 1)}/min`);
      if (m.oxygenSaturation !== undefined) parts.push(`SpO2 ${fmt(m.oxygenSaturation)}%`);
      if (m.wristTempC !== undefined && tempBase !== undefined) {
        const delta = m.wristTempC - tempBase;
        parts.push(`wrist temp ${delta >= 0 ? "+" : "−"}${fmt(Math.abs(delta), 1)}°C vs average`);
      }
      if (m.weightKg !== undefined) parts.push(`weight ${fmtWeight(m.weightKg, units)}`);
      if (m.glucoseAvg !== undefined) {
        const extra = [
          m.glucoseMin !== undefined && m.glucoseMax !== undefined && `${fmtGlucose(m.glucoseMin, units)} to ${fmtGlucose(m.glucoseMax, units)}`,
          m.glucoseInRange !== undefined && `${m.glucoseInRange}% in range`,
          m.glucoseReadings !== undefined && `${m.glucoseReadings} readings`,
        ].filter(Boolean);
        parts.push(`glucose average ${fmtGlucose(m.glucoseAvg, units)}${extra.length ? ` (${extra.join(", ")})` : ""}`);
      }
      if (bleeding(m)) parts.push(`period (${m.menstrualFlow === "unspecified" ? "flow not given" : m.menstrualFlow})`);
      return parts.length ? `${date}: ${parts.join(" · ")}` : null;
    })
    .filter((line) => line !== null)
    .join("\n");
}

// Averages across the range, and how the last 3 days compare, for the metrics that shift when someone gets sick
// (and glucose, when there is any).
export function summarize(days: HealthDay[], units: Units = DEFAULT_UNITS): string {
  const lines: string[] = [];
  const recent = days.slice(-3);
  const earlier = days.slice(0, -3);
  const pick = (ds: HealthDay[], k: NumericKey) => ds.flatMap((d) => (d.metrics[k] === undefined ? [] : [d.metrics[k]!]));
  const rows: [NumericKey, string, string, number][] = [
    ["restingHeartRate", "Resting heart rate", "bpm", 0],
    ["hrvMs", "HRV", "ms", 0],
    ["sleepHours", "Sleep", "h", 1],
    ["steps", "Steps", "", 0],
    ["respiratoryRate", "Breathing rate", "/min", 1],
  ];
  for (const [key, label, unit, digits] of rows) {
    const all = mean(pick(days, key));
    if (all === undefined) continue;
    let line = `${label}: average ${fmt(all, digits)}${unit && unit !== "/min" ? " " : ""}${unit}`;
    const r = mean(pick(recent, key));
    const e = mean(pick(earlier, key));
    if (r !== undefined && e !== undefined && earlier.length >= 4) line += `; last 3 days ${fmt(r, digits)} vs ${fmt(e, digits)} before`;
    lines.push(line);
  }
  const glucose = mean(pick(days, "glucoseAvg"));
  if (glucose !== undefined) {
    const inRange = mean(pick(days, "glucoseInRange"));
    lines.push(`Glucose: average ${fmtGlucose(glucose, units)}${inRange !== undefined ? `, ${fmt(inRange)}% of readings in range (70-180 mg/dL)` : ""}`);
  }
  return lines.join("\n");
}

// First day of each period: a bleeding day after at least 2 days without bleeding (or the first bleeding day logged).
export function periodStarts(days: HealthDay[]): string[] {
  const starts: string[] = [];
  let lastBleed: string | undefined;
  for (const d of days) {
    if (!bleeding(d.metrics)) continue;
    if (!lastBleed || daysBetween(lastBleed, d.date) > 2) starts.push(d.date);
    lastBleed = d.date;
  }
  return starts;
}

export function daysBetween(a: string, b: string) {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

// Cycle facts from logged flow (Flo, Clue and the Health app all write it to Apple Health). null when nothing is logged.
export function cycleSummary(days: HealthDay[], today: string): { text: string; lastPeriodStart: string } | null {
  const starts = periodStarts(days);
  if (!starts.length) return null;
  const last = starts[starts.length - 1];
  const lengths = starts.slice(1).map((s, i) => daysBetween(starts[i], s));
  const parts = [`Period starts logged: ${starts.join(", ")}.`, `Today is cycle day ${daysBetween(last, today) + 1}.`];
  const avg = mean(lengths);
  if (avg !== undefined) parts.push(`Average cycle length ${fmt(avg)} days (${lengths.join(", ")}).`);
  return { text: parts.join(" "), lastPeriodStart: last };
}

// Everything the model gets from get_health_data.
export function healthReport(days: HealthDay[], today: string, units: Units = DEFAULT_UNITS): string {
  if (!days.length) return "No health data for that period yet. The phone app syncs when Wellnest is opened.";
  const out = [`Health data, ${days[0].date} to ${days[days.length - 1].date}:`];
  const summary = summarize(days, units);
  if (summary) out.push(summary);
  const cycle = cycleSummary(days, today);
  if (cycle) out.push(`Cycle: ${cycle.text}`);
  out.push("Daily:\n" + formatDays(days, units));
  return out.join("\n\n");
}

// The CREAO analyzer's biosensor_data field: the summary plus the last week, kept short.
export function biosensorText(days: HealthDay[]): string | undefined {
  const withVitals = days.filter((d) => Object.keys(d.metrics).some((k) => k !== "menstrualFlow"));
  if (!withVitals.length) return undefined;
  return [`From the phone's health data (${withVitals.length} days).`, summarize(withVitals), formatDays(withVitals.slice(-7))]
    .filter(Boolean)
    .join("\n")
    .slice(0, 2000);
}

// Symptom journal: entries the model logs from chat ("my headache's a 6 today") or the user adds, and simple
// patterns against Apple Health (sleep, resting heart rate, activity, period days). Shared by convex/journal.ts,
// the model's get_symptom_journal tool, visit summaries and the Journal tab.
import { v } from "convex/values";
import type { HealthDay } from "./health";

export const entrySource = v.union(v.literal("chat"), v.literal("manual"), v.literal("checkin"));

export type Entry = { date: string; symptom: string; severity?: number; note?: string };

export const MAX_PER_DAY = 20;

// "Headaches " -> "headache": lower case, trimmed, simple plural dropped, so entries group by symptom.
export function normalizeSymptom(s: string): string {
  const clean = s.toLowerCase().replace(/[^\p{L}\p{N}\s'-]/gu, " ").replace(/\s+/g, " ").trim().slice(0, 60);
  return clean.length > 4 && /[^s]s$/.test(clean) && !/(ness|sis|us)$/.test(clean) ? clean.slice(0, -1) : clean;
}

export function clampSeverity(n: unknown): number | undefined {
  const x = Number(n);
  return Number.isFinite(x) ? Math.min(10, Math.max(0, Math.round(x))) : undefined;
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : undefined);
const fmt = (n: number) => (Math.round(n * 10) / 10).toString();

// One severity per symptom per day: the highest logged that day.
export function dailySeverity(entries: Entry[]): Map<string, Map<string, number>> {
  const out = new Map<string, Map<string, number>>();
  for (const e of entries) {
    if (e.severity === undefined) continue;
    const days = out.get(e.symptom) ?? new Map<string, number>();
    days.set(e.date, Math.max(days.get(e.date) ?? 0, e.severity));
    out.set(e.symptom, days);
  }
  return out;
}

type Factor = { label: string; test: (d: HealthDay) => boolean | undefined };

const FACTORS: Factor[] = [
  { label: "under 6 h of sleep", test: (d) => (d.metrics.sleepHours === undefined ? undefined : d.metrics.sleepHours < 6) },
  { label: "fewer than 4,000 steps", test: (d) => (d.metrics.steps === undefined ? undefined : d.metrics.steps < 4000) },
  { label: "a period day", test: (d) => (d.metrics.menstrualFlow === undefined ? undefined : d.metrics.menstrualFlow !== "none") },
];

// Patterns worth mentioning: a symptom's average severity on days with a factor vs without, when there are at least
// 3 days on each side and the gap is at least 1.5 points. Not causation, and the text says so.
export function patterns(entries: Entry[], health: HealthDay[]): string[] {
  const byDate = new Map(health.map((d) => [d.date, d]));
  const out: string[] = [];
  for (const [symptom, days] of dailySeverity(entries)) {
    for (const f of FACTORS) {
      const yes: number[] = [];
      const no: number[] = [];
      for (const [date, sev] of days) {
        const h = byDate.get(date);
        const hit = h && f.test(h);
        if (hit === true) yes.push(sev);
        else if (hit === false) no.push(sev);
      }
      const a = mean(yes);
      const b = mean(no);
      if (a === undefined || b === undefined || yes.length < 3 || no.length < 3 || Math.abs(a - b) < 1.5) continue;
      out.push(`${cap(symptom)} averaged ${fmt(a)}/10 on days with ${f.label} (${yes.length} days) vs ${fmt(b)}/10 otherwise (${no.length} days).`);
    }
  }
  return out;
}

// Per symptom: how many days logged, average and latest severity, and whether it's trending up or down.
export function summaries(entries: Entry[]): string[] {
  const out: string[] = [];
  const daysBySymptom = dailySeverity(entries);
  const counts = new Map<string, Set<string>>();
  for (const e of entries) counts.set(e.symptom, (counts.get(e.symptom) ?? new Set()).add(e.date));
  for (const [symptom, dates] of counts) {
    const sev = [...(daysBySymptom.get(symptom) ?? new Map()).entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, s]) => s);
    let line = `${cap(symptom)}: logged on ${dates.size} day${dates.size === 1 ? "" : "s"}`;
    if (sev.length) {
      line += `, average ${fmt(mean(sev)!)}/10, latest ${sev[sev.length - 1]}/10`;
      if (sev.length >= 6) {
        const half = Math.floor(sev.length / 2);
        const diff = mean(sev.slice(half))! - mean(sev.slice(0, half))!;
        if (Math.abs(diff) >= 1) line += `, ${diff > 0 ? "getting worse" : "getting better"} (${diff > 0 ? "+" : ""}${fmt(diff)})`;
      }
    }
    out.push(line + ".");
  }
  return out;
}

// The daily check-in (convex/daily.ts): 1-5 for mood, energy and sleep quality.
export type DailyLog = { date: string; mood?: number; energy?: number; sleepQuality?: number; note?: string };
const DAILY_KEYS = [
  ["mood", "Mood"],
  ["energy", "Energy"],
  ["sleepQuality", "Sleep quality"],
] as const;

export function dailySummary(daily: DailyLog[]): string[] {
  return DAILY_KEYS.flatMap(([key, label]) => {
    const vals = daily.flatMap((d) => (d[key] === undefined ? [] : [d[key]!]));
    if (!vals.length) return [];
    const recent = mean(vals.slice(-3))!;
    return [`${label}: average ${fmt(mean(vals)!)}/5 over ${vals.length} days, last 3 days ${fmt(recent)}/5.`];
  });
}

// Mood and energy on days with a health factor vs without (3+ days each side, a gap of at least 1 point).
export function dailyPatterns(daily: DailyLog[], health: HealthDay[]): string[] {
  const byDate = new Map(health.map((d) => [d.date, d]));
  const out: string[] = [];
  for (const [key, label] of DAILY_KEYS.slice(0, 2)) {
    for (const f of FACTORS) {
      const yes: number[] = [];
      const no: number[] = [];
      for (const d of daily) {
        const h = byDate.get(d.date);
        const hit = h && f.test(h);
        if (d[key] === undefined) continue;
        if (hit === true) yes.push(d[key]!);
        else if (hit === false) no.push(d[key]!);
      }
      const a = mean(yes);
      const b = mean(no);
      if (a === undefined || b === undefined || yes.length < 3 || no.length < 3 || Math.abs(a - b) < 1) continue;
      out.push(`${label} averaged ${fmt(a)}/5 on days with ${f.label} (${yes.length} days) vs ${fmt(b)}/5 otherwise (${no.length} days).`);
    }
  }
  return out;
}

// What the model and visit summaries read.
export function journalText(entries: Entry[], health: HealthDay[], daily: DailyLog[] = []): string {
  if (!entries.length && !daily.length) return "No symptom journal entries for that period.";
  const checkins = daily.length
    ? "Daily check-ins (1-5):\n" +
      dailySummary(daily).join("\n") +
      "\n" +
      daily
        .slice(-30)
        .map((d) => `${d.date}: ${[d.mood && `mood ${d.mood}`, d.energy && `energy ${d.energy}`, d.sleepQuality && `sleep quality ${d.sleepQuality}`, d.note].filter(Boolean).join(", ")}`)
        .join("\n")
    : "";
  const dailyFound = dailyPatterns(daily, health);
  if (!entries.length) {
    return [checkins, dailyFound.length ? "Patterns with health data (associations, not causes):\n" + dailyFound.join("\n") : ""].filter(Boolean).join("\n\n");
  }
  const lines = entries
    .slice(-60)
    .map((e) => `${e.date}: ${e.symptom}${e.severity !== undefined ? ` ${e.severity}/10` : ""}${e.note ? ` (${e.note})` : ""}`);
  const found = [...patterns(entries, health), ...dailyFound];
  return [
    "Summary:\n" + summaries(entries).join("\n"),
    found.length ? "Patterns with health data (associations, not causes):\n" + found.join("\n") : "",
    "Entries:\n" + lines.join("\n"),
    checkins,
  ]
    .filter(Boolean)
    .join("\n\n");
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

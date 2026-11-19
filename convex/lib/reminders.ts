// Medication reminder schedules: validation, the next due time in the user's time zone, and readable text.
import { Infer, v } from "convex/values";

export const schedule = v.union(
  // At these local times ("08:00") every day, or only on some weekdays (0 Sunday to 6 Saturday), or every other day
  // counting from `everyOtherDay` ("2026-11-18").
  v.object({ kind: v.literal("daily"), times: v.array(v.string()), weekdays: v.optional(v.array(v.number())), everyOtherDay: v.optional(v.string()) }),
  // Every N hours from the first dose.
  v.object({ kind: v.literal("interval"), everyHours: v.number(), firstAt: v.number() }),
  // Only when needed: no reminders, logged with "Took one".
  v.object({ kind: v.literal("asNeeded") }),
);
export type Schedule = Infer<typeof schedule>;
// A schedule with due times (everything but as-needed).
export type Timed = Exclude<Schedule, { kind: "asNeeded" }>;
export const isTimed = (s: Schedule): s is Timed => s.kind !== "asNeeded";

// What the app shows of a schedule (the interval's first dose stays on the server).
export function ruleOf(s: Schedule) {
  return s.kind === "interval" ? { kind: "interval" as const, everyHours: s.everyHours } : s;
}

export const MAX_TIMES = 8;
export const MAX_ACTIVE = 20;
const TIME = /^([01]?\d|2[0-3]):([0-5]\d)$/;
const HOUR = 3_600_000;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

// "8:00", "08:00" and "20:30" are fine; returns "08:00" form, or null.
export function normalizeTime(s: string): string | null {
  const m = s.trim().match(TIME);
  return m ? `${m[1].padStart(2, "0")}:${m[2]}` : null;
}

// Checks a schedule and returns it cleaned up (sorted, de-duplicated times), or an error for the user.
export function checkSchedule(s: Schedule): { schedule: Schedule } | { error: string } {
  if (s.kind === "asNeeded") return { schedule: { kind: "asNeeded" } };
  if (s.kind === "daily") {
    const times = [...new Set(s.times.map(normalizeTime))];
    if (!times.length || times.includes(null)) return { error: "Times must look like 08:00 or 20:30." };
    if (times.length > MAX_TIMES) return { error: `At most ${MAX_TIMES} times a day.` };
    const out: Schedule = { kind: "daily", times: (times as string[]).sort() };
    if (s.weekdays !== undefined) {
      const days = [...new Set(s.weekdays)].filter((d) => Number.isInteger(d) && d >= 0 && d <= 6).sort();
      if (!days.length) return { error: "Pick at least one day of the week." };
      if (days.length < 7) out.weekdays = days;
    }
    if (s.everyOtherDay !== undefined) {
      if (!DAY.test(s.everyOtherDay)) return { error: "Pick the day to start from." };
      if (out.weekdays) return { error: "Choose either days of the week or every other day." };
      out.everyOtherDay = s.everyOtherDay;
    }
    return { schedule: out };
  }
  if (!Number.isFinite(s.everyHours) || s.everyHours < 1 || s.everyHours > 72) {
    return { error: "Every 1 to 72 hours." };
  }
  return { schedule: { kind: "interval", everyHours: Math.round(s.everyHours * 4) / 4, firstAt: s.firstAt } };
}

// Minutes the zone is ahead of UTC at `at`. Falls back to `fallbackMin` if the runtime can't do time zones.
export function zoneOffsetMin(at: number, timeZone: string, fallbackMin = 0): number {
  try {
    const parts = Object.fromEntries(
      new Intl.DateTimeFormat("en-US", {
        timeZone,
        hourCycle: "h23",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      })
        .formatToParts(new Date(at))
        .map((p) => [p.type, p.value]),
    );
    const asUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute);
    return Math.round((asUtc - Math.floor(at / 60_000) * 60_000) / 60_000);
  } catch {
    return fallbackMin;
  }
}

// The UTC instant of a local date + "HH:MM" in the zone (a time skipped by a DST jump lands an hour later).
export function zonedTime(y: number, m: number, d: number, hhmm: string, timeZone: string, fallbackMin = 0) {
  const [hh, mm] = hhmm.split(":").map(Number);
  const guess = Date.UTC(y, m, d, hh, mm);
  let at = guess - zoneOffsetMin(guess, timeZone, fallbackMin) * 60_000;
  const again = guess - zoneOffsetMin(at, timeZone, fallbackMin) * 60_000;
  if (again !== at) at = again;
  return at;
}

// Whether a daily schedule has doses on this local calendar day (UTC fields of `day` hold the local date).
function onDay(s: Extract<Schedule, { kind: "daily" }>, day: Date) {
  if (s.weekdays && !s.weekdays.includes(day.getUTCDay())) return false;
  if (s.everyOtherDay) {
    const diff = Math.round((day.getTime() - Date.parse(`${s.everyOtherDay}T00:00:00Z`)) / (24 * HOUR));
    return diff % 2 === 0;
  }
  return true;
}

// The first due time strictly after `after`.
export function nextDue(s: Timed, after: number, timeZone: string, fallbackMin = 0): number {
  if (s.kind === "interval") {
    const period = s.everyHours * HOUR;
    if (s.firstAt > after) return s.firstAt;
    return s.firstAt + (Math.floor((after - s.firstAt) / period) + 1) * period;
  }
  const local = new Date(after + zoneOffsetMin(after, timeZone, fallbackMin) * 60_000);
  for (let day = 0; day < 9; day++) {
    if (!onDay(s, new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() + day)))) continue;
    for (const t of s.times) {
      const at = zonedTime(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() + day, t, timeZone, fallbackMin);
      if (at > after) return at;
    }
  }
  throw new Error("no next time"); // unreachable for a valid daily schedule
}

// Every due time in [from, to), at most `max` of them.
export function dueTimes(s: Timed, from: number, to: number, timeZone: string, fallbackMin = 0, max = 400): number[] {
  const out: number[] = [];
  let at = nextDue(s, from - 1, timeZone, fallbackMin);
  while (at < to && out.length < max) {
    out.push(at);
    at = nextDue(s, at, timeZone, fallbackMin);
  }
  return out;
}

// The local calendar day ("2026-11-18") and time ("08:00") of an instant in the zone.
export function localParts(at: number, timeZone: string, fallbackMin = 0) {
  const iso = new Date(at + zoneOffsetMin(at, timeZone, fallbackMin) * 60_000).toISOString();
  return { date: iso.slice(0, 10), time: iso.slice(11, 16) };
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function describeSchedule(s: Schedule): string {
  if (s.kind === "asNeeded") return "as needed";
  if (s.kind === "daily") {
    const at = `at ${s.times.join(", ")}`;
    if (s.weekdays) return `on ${s.weekdays.map((d) => WEEKDAYS[d]).join(", ")} ${at}`;
    if (s.everyOtherDay) return `every other day ${at}`;
    return `daily ${at}`;
  }
  return s.everyHours === 24 ? "every 24 hours" : `every ${s.everyHours} hours`;
}

// "8:05 AM"-style local time for messages.
export function localTimeText(at: number, timeZone: string) {
  try {
    return new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", minute: "2-digit" }).format(new Date(at));
  } catch {
    return new Date(at).toISOString().slice(11, 16) + " UTC";
  }
}

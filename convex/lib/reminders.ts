// Medication reminder schedules: validation, the next due time in the user's time zone, and readable text.
import { Infer, v } from "convex/values";

export const schedule = v.union(
  // At these local times every day ("08:00").
  v.object({ kind: v.literal("daily"), times: v.array(v.string()) }),
  // Every N hours from the first dose.
  v.object({ kind: v.literal("interval"), everyHours: v.number(), firstAt: v.number() }),
);
export type Schedule = Infer<typeof schedule>;

export const MAX_TIMES = 8;
export const MAX_ACTIVE = 20;
const TIME = /^([01]?\d|2[0-3]):([0-5]\d)$/;
const HOUR = 3_600_000;

// "8:00", "08:00" and "20:30" are fine; returns "08:00" form, or null.
export function normalizeTime(s: string): string | null {
  const m = s.trim().match(TIME);
  return m ? `${m[1].padStart(2, "0")}:${m[2]}` : null;
}

// Checks a schedule and returns it cleaned up (sorted, de-duplicated times), or an error for the user.
export function checkSchedule(s: Schedule): { schedule: Schedule } | { error: string } {
  if (s.kind === "daily") {
    const times = [...new Set(s.times.map(normalizeTime))];
    if (!times.length || times.includes(null)) return { error: "Times must look like 08:00 or 20:30." };
    if (times.length > MAX_TIMES) return { error: `At most ${MAX_TIMES} times a day.` };
    return { schedule: { kind: "daily", times: (times as string[]).sort() } };
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

// The first due time strictly after `after`.
export function nextDue(s: Schedule, after: number, timeZone: string, fallbackMin = 0): number {
  if (s.kind === "interval") {
    const period = s.everyHours * HOUR;
    if (s.firstAt > after) return s.firstAt;
    return s.firstAt + (Math.floor((after - s.firstAt) / period) + 1) * period;
  }
  const local = new Date(after + zoneOffsetMin(after, timeZone, fallbackMin) * 60_000);
  for (let day = 0; day < 3; day++) {
    for (const t of s.times) {
      const at = zonedTime(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() + day, t, timeZone, fallbackMin);
      if (at > after) return at;
    }
  }
  throw new Error("no next time"); // unreachable for a valid daily schedule
}

export function describeSchedule(s: Schedule): string {
  if (s.kind === "daily") return s.times.length === 1 ? `daily at ${s.times[0]}` : `daily at ${s.times.join(", ")}`;
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

// A medication's schedule in the app's language, and the local day's bounds the dose queries need.
import type { Strings } from "./i18n";

export type Rule =
  | { kind: "daily"; times: string[]; weekdays?: number[]; everyOtherDay?: string }
  | { kind: "interval"; everyHours: number }
  | { kind: "asNeeded" };

// "Mon", "lun", "Δευ", "周一": weekday 0 is Sunday. Nov 15 2026 was a Sunday.
export const weekdayName = (d: number, s: Strings) => new Date(Date.UTC(2026, 10, 15 + d)).toLocaleDateString(s.locale, { weekday: "short", timeZone: "UTC" });

export function describeRule(r: Rule, s: Strings) {
  if (r.kind === "asNeeded") return s.medAsNeededRule;
  if (r.kind === "interval") return s.everyNHours.replace("{n}", String(r.everyHours));
  const times = r.times.join(", ");
  if (r.weekdays) return s.medOnDays.replace("{days}", r.weekdays.map((d) => weekdayName(d, s)).join(", ")).replace("{times}", times);
  if (r.everyOtherDay) return s.medEveryOtherDay.replace("{times}", times);
  return s.dailyAt.replace("{times}", times);
}

// Midnight to midnight of the day `offset` days from `at`, on this device's clock.
export function dayBounds(at = Date.now(), offset = 0) {
  const d = new Date(at);
  const from = new Date(d.getFullYear(), d.getMonth(), d.getDate() + offset).getTime();
  const to = new Date(d.getFullYear(), d.getMonth(), d.getDate() + offset + 1).getTime();
  return { from, to };
}

// The first instant of a month and of the next one (month 0 is January; out-of-range months roll over).
export function monthBounds(year: number, month: number) {
  return { from: new Date(year, month, 1).getTime(), to: new Date(year, month + 1, 1).getTime() };
}

// The next time the clock reads "HH:MM" after `after`: today if it's still ahead, else tomorrow.
export function nextClock(hhmm: string, after = Date.now()) {
  const [h, m] = hhmm.split(":").map(Number);
  const d = new Date(after);
  d.setHours(h, m, 0, 0);
  if (d.getTime() <= after) d.setDate(d.getDate() + 1);
  return d.getTime();
}

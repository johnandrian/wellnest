// Is a place open now? A small reader for OpenStreetMap's opening_hours for the common forms ("24/7",
// "Mo-Fr 08:00-20:00; Sa 09:00-14:00", "Mo-Su 07:00-01:00", "08:00-18:00", "Su off"). Anything it can't read is
// null ("hours unknown"), never a guess. Public-holiday rules (PH) are skipped.

const DAYS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];

// "Mo-Fr,Su" → the weekday numbers it covers (0 = Monday).
function daysOf(spec: string): number[] | null {
  const out: number[] = [];
  for (const part of spec.split(",")) {
    const m = part.trim().match(/^([A-Z][a-z])(?:-([A-Z][a-z]))?$/);
    if (!m) return null;
    const a = DAYS.indexOf(m[1]);
    const b = m[2] ? DAYS.indexOf(m[2]) : a;
    if (a < 0 || b < 0) return null;
    for (let d = a; ; d = (d + 1) % 7) {
      out.push(d);
      if (d === b) break;
    }
  }
  return out;
}

const minutes = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
};

export function openNow(hours: string | undefined, at = new Date()): boolean | null {
  const text = hours?.trim();
  if (!text) return null;
  if (text === "24/7") return true;
  const day = (at.getDay() + 6) % 7;
  const now = at.getHours() * 60 + at.getMinutes();
  let decided: boolean | null = null;
  let understood = false;
  // Later rules override earlier ones for the days they name, as in the OSM spec.
  for (const raw of text.split(";")) {
    const rule = raw.trim();
    if (!rule || rule.startsWith("PH")) continue;
    const m = rule.match(/^(?:([A-Z][a-z](?:[-,][A-Z][a-z])*)\s+)?(off|closed|\d{1,2}:\d{2}-\d{1,2}:\d{2}(?:\s*,\s*\d{1,2}:\d{2}-\d{1,2}:\d{2})*)$/);
    if (!m) return null;
    understood = true;
    const days = m[1] ? daysOf(m[1]) : [0, 1, 2, 3, 4, 5, 6];
    if (!days) return null;
    const ranges = m[2] === "off" || m[2] === "closed" ? [] : m[2].split(",").map((r) => r.trim().split("-").map(minutes));
    // A range past midnight ("18:00-02:00") also covers the early hours of the next day.
    const today = days.includes(day);
    const yesterday = days.includes((day + 6) % 7);
    if (today) decided = ranges.some(([a, b]) => (b > a ? now >= a && now < b : now >= a));
    if (!decided && yesterday && ranges.some(([a, b]) => b <= a && now < b)) decided = true;
    if (today && !decided) decided = false;
  }
  if (!understood) return null;
  return decided ?? false;
}

// Countries that give road distances in miles.
const MILES = new Set(["US", "GB", "LR", "MM", "PR", "GU", "VI", "AS", "MP"]);
export const usesMiles = (country: string | null) => (country ? MILES.has(country) : null);

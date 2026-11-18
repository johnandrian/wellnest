// Reminder times kept as text ("08:00, 20:00"), as the medication forms store them.

export const splitTimes = (text: string) => text.split(/[,\s]+/).filter(Boolean);

// Two-digit hours, no repeats, earliest first.
export const joinTimes = (times: string[]) => [...new Set(times.map((t) => t.padStart(5, "0")))].sort().join(", ");

// The next time to offer: four hours after the last one, or 8 AM for the first.
export function nextTime(times: string[]) {
  const last = times[times.length - 1];
  if (!last) return "08:00";
  const [h, m] = last.split(":").map(Number);
  return `${String((h + 4) % 24).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

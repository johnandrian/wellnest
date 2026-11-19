// Calendar files (.ics, RFC 5545) for appointments, so they can be added to the phone's or computer's calendar, and
// the start times of a repeating appointment, worked out in local time so a weekly 9:00 stays 9:00 across a clock change.

export type IcsEvent = { uid: string; title: string; startsAt: number; minutes?: number; location?: string | null; notes?: string | null };

const stamp = (ms: number) => new Date(ms).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
const escape = (text: string) => text.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");

// Lines longer than 75 characters continue on the next line after a space.
function fold(line: string) {
  const out: string[] = [];
  for (let i = 0; i < line.length; i += 74) out.push((i ? " " : "") + line.slice(i, i + 74));
  return out.join("\r\n");
}

export function icsFile(events: IcsEvent[], now = Date.now()) {
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Wellnest//Appointments//EN", "CALSCALE:GREGORIAN", "METHOD:PUBLISH"];
  for (const e of events) {
    lines.push(
      "BEGIN:VEVENT",
      `UID:${e.uid}@wellnest`,
      `DTSTAMP:${stamp(now)}`,
      `DTSTART:${stamp(e.startsAt)}`,
      `DTEND:${stamp(e.startsAt + (e.minutes ?? 60) * 60_000)}`,
      `SUMMARY:${escape(e.title)}`,
      ...(e.location ? [`LOCATION:${escape(e.location)}`] : []),
      ...(e.notes ? [`DESCRIPTION:${escape(e.notes)}`] : []),
      "BEGIN:VALARM",
      "ACTION:DISPLAY",
      `DESCRIPTION:${escape(e.title)}`,
      "TRIGGER:-PT1H",
      "END:VALARM",
      "END:VEVENT",
    );
  }
  lines.push("END:VCALENDAR");
  return lines.map(fold).join("\r\n") + "\r\n";
}

export type Repeat = "week" | "twoWeeks" | "month";

// The first start and the ones after it, `count` in all. A monthly one on the 31st falls on the month's last day.
export function repeatTimes(startsAt: number, every: Repeat, count: number) {
  const first = new Date(startsAt);
  const out: number[] = [];
  for (let i = 0; i < count; i++) {
    const d = new Date(first);
    if (every === "month") {
      const day = first.getDate();
      d.setDate(1);
      d.setMonth(first.getMonth() + i);
      const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
      d.setDate(Math.min(day, last));
    } else {
      d.setDate(first.getDate() + i * (every === "week" ? 7 : 14));
    }
    out.push(d.getTime());
  }
  return out;
}

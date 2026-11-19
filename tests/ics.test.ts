// Calendar files and repeating appointment times (src/ics.ts).
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { icsFile, repeatTimes } from "../src/ics";

const zone = process.env.TZ;
beforeEach(() => {
  process.env.TZ = "America/Los_Angeles";
});
afterEach(() => {
  process.env.TZ = zone;
});

describe("calendar files", () => {
  test("one event in UTC with an alarm, text escaped, and long lines folded", () => {
    const start = Date.parse("2026-11-20T17:30:00Z");
    const text = icsFile([{ uid: "v1", title: "Rheumatology, follow-up; bring list", startsAt: start, location: "Bay Clinic", notes: `Dr. Lee\n${"x".repeat(100)}` }], start);
    const lines = text.split("\r\n");
    expect(lines[0]).toBe("BEGIN:VCALENDAR");
    expect(lines).toContain("DTSTART:20261120T173000Z");
    expect(lines).toContain("DTEND:20261120T183000Z");
    expect(lines).toContain("SUMMARY:Rheumatology\\, follow-up\\; bring list");
    expect(lines).toContain("TRIGGER:-PT1H");
    expect(text).toContain("DESCRIPTION:Dr. Lee\\nxxx");
    expect(lines.every((l) => l.length <= 75)).toBe(true);
    expect(lines.some((l) => l.startsWith(" x"))).toBe(true);
    expect(text.endsWith("END:VCALENDAR\r\n")).toBe(true);
  });
});

describe("repeating appointments", () => {
  test("weekly keeps the local time across the clock change", () => {
    // Monday Oct 26, 2026, 9:00 in Los Angeles; clocks go back on Nov 1.
    const first = new Date(2026, 9, 26, 9, 0).getTime();
    const times = repeatTimes(first, "week", 3).map((t) => new Date(t));
    expect(times.map((d) => [d.getMonth() + 1, d.getDate(), d.getHours()])).toEqual([
      [10, 26, 9],
      [11, 2, 9],
      [11, 9, 9],
    ]);
    expect(repeatTimes(first, "twoWeeks", 2).map((t) => new Date(t).getDate())).toEqual([26, 9]);
  });

  test("monthly on the 31st falls on each month's last day", () => {
    const first = new Date(2027, 0, 31, 14, 0).getTime();
    expect(repeatTimes(first, "month", 4).map((t) => new Date(t).toDateString())).toEqual(["Sun Jan 31 2027", "Sun Feb 28 2027", "Wed Mar 31 2027", "Fri Apr 30 2027"]);
  });
});

// Reading OpenStreetMap opening hours for "Open now" in Care nearby, and miles by country (src/openingHours.ts).
import { describe, expect, test } from "vitest";
import { openNow, usesMiles } from "../src/openingHours";

// Wednesday Nov 18, 2026 at a local time.
const wed = (hh: number, mm = 0) => new Date(2026, 10, 18, hh, mm);
const sun = (hh: number) => new Date(2026, 10, 22, hh, 0);

describe("open now", () => {
  test("24/7, weekday ranges, and days that aren't listed", () => {
    expect(openNow("24/7", wed(3))).toBe(true);
    expect(openNow("Mo-Fr 08:00-20:00", wed(9))).toBe(true);
    expect(openNow("Mo-Fr 08:00-20:00", wed(20))).toBe(false);
    expect(openNow("Mo-Fr 08:00-20:00", sun(12))).toBe(false);
    expect(openNow("08:00-18:00", sun(12))).toBe(true);
  });

  test("later rules win, split hours, and hours past midnight", () => {
    expect(openNow("Mo-Su 08:00-20:00; Su off", sun(12))).toBe(false);
    expect(openNow("Mo-Fr 09:00-12:00,14:00-18:00", wed(13))).toBe(false);
    expect(openNow("Mo-Fr 09:00-12:00,14:00-18:00", wed(15))).toBe(true);
    expect(openNow("Tu 18:00-02:00", wed(1))).toBe(true);
    expect(openNow("Tu 18:00-02:00", wed(3))).toBe(false);
    expect(openNow("Mo-Sa 08:00-21:00; PH off", wed(10))).toBe(true);
  });

  test("anything it can't read is unknown, not a guess", () => {
    expect(openNow(undefined, wed(9))).toBeNull();
    expect(openNow("by appointment", wed(9))).toBeNull();
    expect(openNow("Mo-Fr 08:00-20:00; sunrise-sunset", wed(9))).toBeNull();
  });
});

describe("miles", () => {
  test("by country, unknown without one", () => {
    expect(usesMiles("US")).toBe(true);
    expect(usesMiles("GB")).toBe(true);
    expect(usesMiles("GR")).toBe(false);
    expect(usesMiles(null)).toBeNull();
  });
});

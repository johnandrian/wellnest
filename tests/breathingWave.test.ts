import { describe, expect, test } from "vitest";
import { BREATH_MS, dotAlpha, footprint, makeShape, SHAPE_SPAN } from "../src/breathingWave";

describe("landing dot grid", () => {
  test("dots stay faint anywhere on the page, and softer on a narrow screen", () => {
    for (let ms = 0; ms < BREATH_MS; ms += BREATH_MS / 8) {
      for (const [x, y] of [[0, 0], [700, 200], [1100, 400], [300, 3000]]) {
        const a = dotAlpha(x, y, 1100, ms);
        expect(a).toBeGreaterThan(0);
        expect(a).toBeLessThanOrEqual(0.55);
      }
    }
    expect(dotAlpha(300, 200, 390, 0)).toBeLessThan(dotAlpha(300 * (1100 / 390), 200, 1100, 0));
  });

  test("the wave breathes 50% faster than 6 breaths a minute", () => {
    expect(60000 / BREATH_MS).toBeCloseTo(9);
  });

  test("each kind of graph stays within its stated reach", () => {
    let seed = 7;
    const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (const kind of ["trend", "bars", "link"] as const) {
      const span = SHAPE_SPAN[kind];
      for (let n = 0; n < 200; n++) {
        const shape = makeShape(kind, 10, 30, 0, random);
        for (const [c, r] of footprint(shape)) {
          expect(c).toBeGreaterThanOrEqual(10);
          expect(c).toBeLessThanOrEqual(10 + span.cols);
          expect(r).toBeGreaterThanOrEqual(30 - span.up);
          expect(r).toBeLessThanOrEqual(30 + span.down);
        }
      }
    }
  });

  test("a trend steps one column at a time and bars rise from one baseline", () => {
    let seed = 11;
    const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const trend = makeShape("trend", 0, 20, 0, random).points;
    trend.forEach(([c, r], i) => {
      if (!i) return;
      expect(c - trend[i - 1][0]).toBe(1);
      expect(Math.abs(r - trend[i - 1][1])).toBeLessThanOrEqual(1);
    });
    const bars = makeShape("bars", 0, 20, 0, random).points;
    expect(Math.max(...bars.map(([, r]) => r))).toBe(20);
  });

  test("a link's curve starts and ends on its two dots", () => {
    const shape = makeShape("link", 4, 12, 0, () => 0.5);
    const curve = footprint(shape);
    expect(curve[0]).toEqual(shape.points[0]);
    expect(curve[curve.length - 1]).toEqual(shape.points[1]);
  });
});

import { describe, expect, test } from "vitest";
import { BREATH_MS, dotAlpha, makeTrend } from "../src/breathingWave";

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

  test("a trend line steps one column at a time and stays inside its lane", () => {
    let seed = 7;
    const random = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (const [cols, top, bottom] of [[58, 5, 8], [58, 3, 5], [40, 4, 4]]) {
      const { points } = makeTrend(cols, [top, bottom], 0, random);
      expect(points.length).toBeGreaterThanOrEqual(7);
      points.forEach(([c, r], i) => {
        expect(r).toBeGreaterThanOrEqual(top);
        expect(r).toBeLessThanOrEqual(bottom);
        expect(c).toBeLessThan(cols);
        if (i) {
          expect(c - points[i - 1][0]).toBe(1);
          expect(Math.abs(r - points[i - 1][1])).toBeLessThanOrEqual(1);
        }
      });
    }
  });
});

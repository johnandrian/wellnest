import { describe, expect, test } from "vitest";
import { axisDay, formatDistance } from "../src/format";
import { strings } from "../src/i18n";

describe("dates and distances in the app's language and units", () => {
  test("a chart's day follows the app language, not the device", () => {
    expect(axisDay("2026-11-05", strings("en"))).toBe("Nov 5");
    expect(axisDay("2026-11-05", strings("es"))).toBe("5 nov");
  });

  test("miles for pounds, kilometers otherwise", () => {
    expect(formatDistance(1.609344, true)).toBe("1.0 mi");
    expect(formatDistance(2.25, false)).toBe("2.3 km");
    expect(formatDistance(32.2, true)).toBe("20 mi");
  });
});

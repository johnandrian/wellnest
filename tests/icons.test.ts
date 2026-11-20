// One picture per idea (src/iconMap.ts): no two names may draw the same glyph, so no two tools or places look alike.
import { describe, expect, test } from "vitest";
import { ICONS } from "../src/iconMap";

describe("icons", () => {
  test("no glyph is used for two names", () => {
    const seen = new Map<string, string>();
    const repeats: string[] = [];
    for (const [name, [set, glyph]] of Object.entries(ICONS)) {
      const key = `${set}:${glyph}`;
      if (seen.has(key)) repeats.push(`${name} and ${seen.get(key)} both draw ${key}`);
      seen.set(key, name);
    }
    expect(repeats).toEqual([]);
  });
});

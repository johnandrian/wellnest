// The welcome page's store buttons show only once the apps are live (src/landing.ts).
import { describe, expect, test } from "vitest";
import { storeLinks } from "../src/landing";

describe("store links", () => {
  test("nothing until a store's address is set, and only the store's own https address counts", () => {
    expect(storeLinks(undefined, undefined)).toEqual([]);
    expect(storeLinks("https://apps.apple.com/app/id123", undefined)).toEqual([{ store: "apple", url: "https://apps.apple.com/app/id123" }]);
    expect(storeLinks("http://apps.apple.com/app/id123", "https://example.com/wellnest")).toEqual([]);
    expect(storeLinks("", "https://play.google.com/store/apps/details?id=health.wellnest")).toEqual([
      { store: "google", url: "https://play.google.com/store/apps/details?id=health.wellnest" },
    ]);
  });
});

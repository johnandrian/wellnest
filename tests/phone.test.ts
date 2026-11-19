// Phone numbers as people type them, turned into tel: links that dial (convex/lib/phone.ts).
import { describe, expect, test } from "vitest";
import { telUrl } from "../convex/lib/phone";

describe("tel links", () => {
  test("keeps digits and a leading +, and drops the rest", () => {
    expect(telUrl("+1 (555) 010-0100")).toBe("tel:+15550100100");
    expect(telUrl("555.010.0100")).toBe("tel:5550100100");
    expect(telUrl("  +30 210 123 4567 ")).toBe("tel:+302101234567");
    expect(telUrl("555+0100")).toBe("tel:5550100");
  });

  test("an extension is dialed after a pause instead of run into the number", () => {
    expect(telUrl("555-010-0100 ext. 22")).toBe("tel:5550100100,22");
    expect(telUrl("555-010-0100 x22")).toBe("tel:5550100100,22");
    expect(telUrl("555-010-0100 #22")).toBe("tel:5550100100,22");
  });
});

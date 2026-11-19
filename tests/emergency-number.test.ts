// The emergency number by country, not by the app's language (src/emergency.ts).
import { afterEach, describe, expect, test, vi } from "vitest";
import { emergencyNumber } from "../src/emergency";
import { strings } from "../src/i18n";

afterEach(() => {
  vi.restoreAllMocks();
});

const region = (locale: string) =>
  vi.spyOn(Intl, "DateTimeFormat").mockImplementation((() => ({ resolvedOptions: () => ({ locale }) })) as unknown as typeof Intl.DateTimeFormat);

describe("emergency number", () => {
  test("the saved location's country wins over the language", () => {
    expect(emergencyNumber("US", strings("el"))).toBe("911");
    expect(emergencyNumber("GR", strings("en"))).toBe("112");
    expect(emergencyNumber("GB", strings("en"))).toBe("999");
    expect(emergencyNumber("AU", strings("en"))).toBe("000");
    // A country not in the list gets 112, which works from mobile phones in most places.
    expect(emergencyNumber("FR", strings("en"))).toBe("112");
  });

  test("without a saved location, the device's region, then the language", () => {
    region("es-US");
    expect(emergencyNumber(null, strings("es"))).toBe("911");
    region("en-GB");
    expect(emergencyNumber(null, strings("en"))).toBe("999");
    region("en");
    expect(emergencyNumber(null, strings("el"))).toBe(strings("el").emergencyNumber);
  });
});

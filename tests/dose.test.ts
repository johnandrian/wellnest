import { describe, expect, test } from "vitest";
import { formatDose, parseDose } from "../src/dose";
import { strings } from "../src/i18n";

const en = strings("en");
const es = strings("es");

describe("dose: a number and a unit", () => {
  test("written in the user's language, one or many", () => {
    expect(formatDose({ amount: "500", unit: "mg", other: "" }, en)).toBe("500 mg");
    expect(formatDose({ amount: "1", unit: "tablet", other: "" }, en)).toBe("1 tablet");
    expect(formatDose({ amount: "2", unit: "tablet", other: "" }, en)).toBe("2 tablets");
    expect(formatDose({ amount: "2", unit: "puff", other: "" }, es)).toBe("2 inhalaciones");
    expect(formatDose({ amount: "1", unit: "other", other: "sachet" }, en)).toBe("1 sachet");
    expect(formatDose({ amount: "", unit: "mg", other: "" }, en)).toBe("");
    expect(formatDose({ amount: "5", unit: null, other: "" }, en)).toBe("5");
  });

  test("read back from what was saved, including doses typed by hand before", () => {
    expect(parseDose("500 mg", en)).toEqual({ amount: "500", unit: "mg", other: "" });
    expect(parseDose("2 Tablets", en)).toEqual({ amount: "2", unit: "tablet", other: "" });
    expect(parseDose("1/2 tablet", en)).toEqual({ amount: "1/2", unit: "tablet", other: "" });
    expect(parseDose("2.5ml", en)).toEqual({ amount: "2.5", unit: "mL", other: "" });
    expect(parseDose("1 sachet", en)).toEqual({ amount: "1", unit: "other", other: "sachet" });
    expect(parseDose("as needed", en)).toEqual({ amount: "", unit: "other", other: "as needed" });
    expect(parseDose("", en)).toEqual({ amount: "", unit: null, other: "" });
    for (const text of ["500 mg", "2 tablets", "1 sachet", "10 units"]) expect(formatDose(parseDose(text, en), en)).toBe(text);
  });
});

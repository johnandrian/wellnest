// A dose as typed into ./DoseInput.tsx: a number and a unit, stored as one line of text ("500 mg", "2 tablets") in
// the user's language, and read back from that text (a unit typed by hand counts as "other").
import type { Strings } from "./i18n";

export const DOSE_UNITS = ["mg", "mcg", "g", "mL", "tablet", "capsule", "puff", "drop", "unit", "patch", "spray"] as const;
export type Unit = (typeof DOSE_UNITS)[number];
export type Dose = { amount: string; unit: Unit | "other" | null; other: string };

export const doseUnitForms = (s: Strings, u: Unit) => {
  const [one, many] = s.doseUnits[u].split("|");
  return { one, many: many ?? one };
};

export function parseDose(text: string, s: Strings): Dose {
  const m = text.trim().match(/^(\d+(?:[.,/]\d+)?)\s*(.*)$/);
  if (!m) return { amount: "", unit: text.trim() ? "other" : null, other: text.trim() };
  const rest = m[2].trim();
  const lower = rest.toLowerCase();
  const unit = DOSE_UNITS.find((u) => {
    const f = doseUnitForms(s, u);
    return [u.toLowerCase(), f.one.toLowerCase(), f.many.toLowerCase()].includes(lower);
  });
  return { amount: m[1], unit: unit ?? (rest ? "other" : null), other: unit ? "" : rest };
}

export function formatDose(d: Dose, s: Strings): string {
  const amount = d.amount.trim();
  if (!amount) return d.unit === "other" ? d.other.trim() : "";
  if (!d.unit) return amount;
  if (d.unit === "other") return d.other.trim() ? `${amount} ${d.other.trim()}` : amount;
  const f = doseUnitForms(s, d.unit);
  return `${amount} ${amount === "1" ? f.one : f.many}`;
}

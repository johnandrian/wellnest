// Units people see for glucose and weight, from Settings. Readings are always stored in mg/dL and kg; these only
// change what's shown (charts, patterns, summaries, reports, and what the model reads). US units unless changed.
import { Infer, v } from "convex/values";

export const units = v.object({
  glucose: v.union(v.literal("mg/dL"), v.literal("mmol/L")),
  weight: v.union(v.literal("lb"), v.literal("kg")),
});
export type Units = Infer<typeof units>;

export const DEFAULT_UNITS: Units = { glucose: "mg/dL", weight: "lb" };
export const unitsOf = (user: { units?: Units } | null | undefined): Units => ({ ...DEFAULT_UNITS, ...user?.units });

const KG_PER_LB = 0.45359237;
export const MGDL_PER_MMOL = 18.0182;

// Stored value -> the unit shown.
export const showWeight = (kg: number, u: Units) => (u.weight === "lb" ? kg / KG_PER_LB : kg);
export const showGlucose = (mgdl: number, u: Units) => (u.glucose === "mmol/L" ? mgdl / MGDL_PER_MMOL : mgdl);

// A value typed in the unit shown -> stored.
export const glucoseToMgdl = (value: number, unit: Units["glucose"]) => (unit === "mmol/L" ? value * MGDL_PER_MMOL : value);

// Rounded the way each unit is usually written: 142 mg/dL, 7.9 mmol/L, 182.4 lb, 82.7 kg.
export function fmtGlucose(mgdl: number, u: Units, locale = "en-US") {
  const n = showGlucose(mgdl, u);
  return `${n.toLocaleString(locale, { maximumFractionDigits: u.glucose === "mmol/L" ? 1 : 0 })} ${u.glucose}`;
}
export function fmtWeight(kg: number, u: Units, locale = "en-US") {
  return `${showWeight(kg, u).toLocaleString(locale, { maximumFractionDigits: 1 })} ${u.weight}`;
}

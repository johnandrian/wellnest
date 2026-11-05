// Condition trackers: pain / CRPS, asthma, seizures, and glucose, each with its own fields (convex/trackers.ts).
// Validation, the option lists the app shows, and the text the model, visit summaries, and reports read.
import { Infer, v } from "convex/values";
import { DEFAULT_UNITS, fmtGlucose, type Units } from "./units";

export const PAIN_LOCATIONS = [
  "head", "neck", "shoulders", "chest", "upper_back", "lower_back", "abdomen", "hips",
  "left_arm", "right_arm", "left_hand", "right_hand", "left_leg", "right_leg", "left_foot", "right_foot", "whole_body",
] as const;
export const PAIN_TYPES = ["aching", "burning", "stabbing", "throbbing", "shooting", "tingling", "cramping", "pressure"] as const;
export const ASTHMA_SYMPTOMS = ["wheeze", "cough", "chest_tightness", "breathless"] as const;
export const SEIZURE_TYPES = ["focal_aware", "focal_impaired", "tonic_clonic", "absence", "myoclonic", "atonic", "unknown"] as const;
export const GLUCOSE_CONTEXTS = ["fasting", "before_meal", "after_meal", "bedtime", "other"] as const;

export const tracker = v.union(v.literal("pain"), v.literal("asthma"), v.literal("seizure"), v.literal("glucose"));
export type Tracker = Infer<typeof tracker>;

export const painDetails = v.object({
  severity: v.number(), // 0-10
  locations: v.array(v.string()),
  types: v.array(v.string()),
  durationMin: v.optional(v.number()),
  flare: v.optional(v.boolean()),
  swelling: v.optional(v.boolean()),
  colourChange: v.optional(v.boolean()),
  temperatureChange: v.optional(v.boolean()),
  touchSensitive: v.optional(v.boolean()), // allodynia
  triggers: v.optional(v.string()),
  helped: v.optional(v.string()),
});
export const asthmaDetails = v.object({
  peakFlow: v.optional(v.number()), // L/min
  reliever: v.optional(v.number()), // puffs
  preventer: v.optional(v.boolean()),
  symptoms: v.array(v.string()),
  night: v.optional(v.boolean()),
  attack: v.optional(v.boolean()),
  triggers: v.optional(v.string()),
});
export const seizureDetails = v.object({
  type: v.optional(v.string()),
  durationSec: v.optional(v.number()),
  aura: v.optional(v.string()),
  triggers: v.optional(v.string()),
  rescueMed: v.optional(v.boolean()),
  recoveryMin: v.optional(v.number()),
  witness: v.optional(v.string()),
});
// A finger-stick (or any single) glucose reading, always stored in mg/dL; the app converts from mmol/L.
export const glucoseDetails = v.object({
  value: v.number(), // mg/dL
  context: v.optional(v.string()), // one of GLUCOSE_CONTEXTS
});
export type GlucoseDetails = Infer<typeof glucoseDetails>;
export type PainDetails = Infer<typeof painDetails>;
export type AsthmaDetails = Infer<typeof asthmaDetails>;
export type SeizureDetails = Infer<typeof seizureDetails>;

const text = (s: string | undefined, n = 300) => s?.trim().slice(0, n) || undefined;
const num = (x: unknown, lo: number, hi: number) => {
  const n = Number(x);
  return Number.isFinite(n) && n >= lo && n <= hi ? Math.round(n * 10) / 10 : undefined;
};
const oneOf = <T extends string>(list: readonly T[], xs: unknown) =>
  Array.isArray(xs) ? [...new Set(xs.filter((x): x is T => list.includes(x as T)))] : [];

export function cleanPain(p: Partial<PainDetails>): PainDetails | { error: string } {
  const severity = num(p.severity, 0, 10);
  if (severity === undefined) return { error: "Give the pain a 0-10 score." };
  return {
    severity: Math.round(severity),
    locations: oneOf(PAIN_LOCATIONS, p.locations),
    types: oneOf(PAIN_TYPES, p.types),
    durationMin: num(p.durationMin, 0, 60 * 24 * 7),
    flare: p.flare || undefined,
    swelling: p.swelling || undefined,
    colourChange: p.colourChange || undefined,
    temperatureChange: p.temperatureChange || undefined,
    touchSensitive: p.touchSensitive || undefined,
    triggers: text(p.triggers),
    helped: text(p.helped),
  };
}

export function cleanAsthma(a: Partial<AsthmaDetails>): AsthmaDetails | { error: string } {
  const out: AsthmaDetails = {
    peakFlow: num(a.peakFlow, 50, 900),
    reliever: num(a.reliever, 0, 100),
    preventer: a.preventer,
    symptoms: oneOf(ASTHMA_SYMPTOMS, a.symptoms),
    night: a.night || undefined,
    attack: a.attack || undefined,
    triggers: text(a.triggers),
  };
  if (out.peakFlow === undefined && out.reliever === undefined && out.preventer === undefined && !out.symptoms.length && !out.attack) {
    return { error: "Log a peak flow, puffs, symptoms or an attack." };
  }
  return out;
}

export function cleanGlucose(g: Partial<GlucoseDetails>): GlucoseDetails | { error: string } {
  const value = num(g.value, 20, 600);
  if (value === undefined) return { error: "Give a glucose reading between 20 and 600 mg/dL (1.1 to 33.3 mmol/L)." };
  return { value: Math.round(value), context: (GLUCOSE_CONTEXTS as readonly string[]).includes(g.context ?? "") ? g.context : undefined };
}

export function cleanSeizure(s: Partial<SeizureDetails>): SeizureDetails {
  return {
    type: (SEIZURE_TYPES as readonly string[]).includes(s.type ?? "") ? s.type : undefined,
    durationSec: num(s.durationSec, 1, 60 * 60),
    aura: text(s.aura),
    triggers: text(s.triggers),
    rescueMed: s.rescueMed,
    recoveryMin: num(s.recoveryMin, 0, 60 * 48),
    witness: text(s.witness, 1000),
  };
}

export type TrackerEntry = {
  date: string;
  at: number;
  tracker: Tracker;
  pain?: PainDetails;
  asthma?: AsthmaDetails;
  seizure?: SeizureDetails;
  glucose?: GlucoseDetails;
  note?: string;
};

const human = (s: string) => s.replace(/_/g, " ");
const flags = (p: PainDetails) =>
  [p.flare && "flare", p.swelling && "swelling", p.colourChange && "color change", p.temperatureChange && "temperature change", p.touchSensitive && "touch-sensitive"].filter(Boolean);

export function entryLine(e: TrackerEntry, peakFlowBest?: number, units: Units = DEFAULT_UNITS): string {
  if (e.tracker === "glucose" && e.glucose) {
    return `glucose ${fmtGlucose(e.glucose.value, units)}${e.glucose.context ? ` (${human(e.glucose.context)})` : ""}`;
  }
  if (e.tracker === "pain" && e.pain) {
    const p = e.pain;
    return [
      `pain ${p.severity}/10`,
      p.locations.length && p.locations.map(human).join(", "),
      p.types.length && p.types.join(", "),
      p.durationMin !== undefined && `${p.durationMin} min`,
      ...flags(p),
      p.triggers && `triggers: ${p.triggers}`,
      p.helped && `helped: ${p.helped}`,
    ].filter(Boolean).join("; ");
  }
  if (e.tracker === "asthma" && e.asthma) {
    const a = e.asthma;
    const pct = a.peakFlow && peakFlowBest ? ` (${Math.round((a.peakFlow / peakFlowBest) * 100)}% of best)` : "";
    return [
      a.attack && "ASTHMA ATTACK",
      a.peakFlow !== undefined && `peak flow ${a.peakFlow} L/min${pct}`,
      a.reliever !== undefined && `${a.reliever} reliever puffs`,
      a.preventer !== undefined && (a.preventer ? "preventer taken" : "preventer missed"),
      a.symptoms.length && a.symptoms.map(human).join(", "),
      a.night && "at night",
      a.triggers && `triggers: ${a.triggers}`,
    ].filter(Boolean).join("; ");
  }
  if (e.tracker === "seizure" && e.seizure) {
    const s = e.seizure;
    return [
      `seizure${s.type ? ` (${human(s.type)})` : ""}`,
      s.durationSec !== undefined && `${s.durationSec >= 60 ? `${Math.round((s.durationSec / 60) * 10) / 10} min` : `${s.durationSec} s`}`,
      s.aura && `warning signs: ${s.aura}`,
      s.triggers && `possible triggers: ${s.triggers}`,
      s.rescueMed !== undefined && (s.rescueMed ? "rescue medication taken" : "no rescue medication"),
      s.recoveryMin !== undefined && `recovery ${s.recoveryMin} min`,
      s.witness && `witness: ${s.witness}`,
    ].filter(Boolean).join("; ");
  }
  return e.tracker;
}

// Pain scores as journal entries ("pain", highest per day), so the journal's charts and patterns include them.
export function painAsEntries(entries: TrackerEntry[]) {
  return entries.flatMap((e) => (e.pain ? [{ date: e.date, symptom: "pain", severity: e.pain.severity }] : []));
}

// Summary lines per tracker, then the entries: for the model, visit summaries and reports.
export function trackersText(entries: TrackerEntry[], peakFlowBest?: number, units: Units = DEFAULT_UNITS): string {
  if (!entries.length) return "";
  const out: string[] = [];
  const pain = entries.filter((e) => e.pain);
  if (pain.length) {
    const avg = pain.reduce((s, e) => s + e.pain!.severity, 0) / pain.length;
    const flares = pain.filter((e) => e.pain!.flare).length;
    out.push(`Pain: ${pain.length} entries, average ${Math.round(avg * 10) / 10}/10${flares ? `, ${flares} flares` : ""}.`);
  }
  const asthma = entries.filter((e) => e.asthma);
  if (asthma.length) {
    const flows = asthma.flatMap((e) => (e.asthma!.peakFlow ? [e.asthma!.peakFlow] : []));
    const puffs = asthma.reduce((s, e) => s + (e.asthma!.reliever ?? 0), 0);
    const attacks = asthma.filter((e) => e.asthma!.attack).length;
    out.push(
      `Asthma: ${asthma.length} entries${flows.length ? `, peak flow ${Math.min(...flows)}-${Math.max(...flows)} L/min` : ""}` +
        `${peakFlowBest ? ` (personal best ${peakFlowBest})` : ""}, ${puffs} reliever puffs${attacks ? `, ${attacks} attacks` : ""}.`,
    );
  }
  const seizures = entries.filter((e) => e.seizure);
  if (seizures.length) {
    const rescue = seizures.filter((e) => e.seizure!.rescueMed).length;
    out.push(`Seizures: ${seizures.length}${rescue ? `, rescue medication ${rescue} times` : ""}.`);
  }
  const glucose = entries.flatMap((e) => (e.glucose ? [e.glucose.value] : []));
  if (glucose.length) {
    const avg = glucose.reduce((a, b) => a + b, 0) / glucose.length;
    const range = `${fmtGlucose(Math.min(...glucose), units)} to ${fmtGlucose(Math.max(...glucose), units)}`;
    out.push(`Glucose: ${glucose.length} readings, average ${fmtGlucose(avg, units)}, ${range}.`);
  }
  return out.join("\n") + "\n" + entries.map((e) => `${e.date}: ${entryLine(e, peakFlowBest, units)}${e.note ? ` (${e.note})` : ""}`).join("\n");
}

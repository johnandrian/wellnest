// Medication safety helpers (convex/drugs.ts): a lookup key for a medication name, the words that name a drug class
// on US labels, finding where one medication's FDA label mentions another, and reading a label photo's JSON.
// The labels are public data (openFDA); RxNorm turns a brand or misspelled name into its ingredients.

// "Ibuprofen 200 mg tablets" -> "ibuprofen". Shared cache key, so it ignores strength and form.
const FORM_WORDS = /\b(tablets?|tabs?|capsules?|caps?|caplets?|liquid|syrup|suspension|solution|inhaler|spray|cream|ointment|gel|patch(es)?|drops|injection|pen|er|xr|sr|dr|ir|extended|release|oral|chewable|softgels?)\b/g;
export function drugKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/\(.*?\)/g, " ")
    .replace(/\d+(\.\d+)?\s*(mg|mcg|µg|g|ml|iu|units?|%)\b/g, " ")
    .replace(/\d+/g, " ")
    .replace(FORM_WORDS, " ")
    .replace(/[^a-z\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 60);
}

// Words a label uses for a class: "Nonsteroidal Anti-inflammatory Drug [EPC]" -> "nonsteroidal anti-inflammatory", "nsaid".
const CLASS_ALIASES: [RegExp, string[]][] = [
  [/nonsteroidal anti-inflammatory/i, ["nsaid", "nonsteroidal anti-inflammatory"]],
  [/selective serotonin reuptake inhibitor/i, ["ssri", "serotonin reuptake inhibitor"]],
  [/serotonin and norepinephrine reuptake inhibitor/i, ["snri", "serotonin and norepinephrine reuptake"]],
  [/monoamine oxidase inhibitor/i, ["maoi", "mao inhibitor", "monoamine oxidase inhibitor"]],
  [/angiotensin converting enzyme inhibitor/i, ["ace inhibitor", "angiotensin converting enzyme"]],
  [/angiotensin 2 receptor blocker/i, ["angiotensin receptor blocker", "arb"]],
  [/hmg-coa reductase inhibitor/i, ["statin", "hmg-coa reductase inhibitor"]],
  [/vitamin k antagonist|anticoagulant|factor xa inhibitor/i, ["anticoagulant", "blood thinner", "blood thinning"]],
  [/platelet aggregation inhibitor/i, ["antiplatelet", "platelet aggregation"]],
  [/opioid agonist/i, ["opioid"]],
  [/benzodiazepine/i, ["benzodiazepine"]],
  [/corticosteroid/i, ["corticosteroid"]],
  [/beta-adrenergic blocker/i, ["beta blocker", "beta-blocker", "beta-adrenergic blocking"]],
  [/diuretic/i, ["diuretic"]],
  [/sulfonylurea/i, ["sulfonylurea"]],
  [/tricyclic antidepressant/i, ["tricyclic antidepressant"]],
  [/proton pump inhibitor/i, ["proton pump inhibitor", "ppi"]],
  [/antiepileptic|anti-epileptic/i, ["antiepileptic", "anticonvulsant"]],
];
export function classTerms(classes: string[]): string[] {
  const out = new Set<string>();
  for (const c of classes) {
    const plain = c.replace(/\[[A-Z]+\]/g, "").trim();
    for (const [re, words] of CLASS_ALIASES) if (re.test(plain)) words.forEach((w) => out.add(w));
  }
  return [...out];
}

export type DrugInfo = {
  key: string;
  ingredients: string[];
  brands: string[];
  classes: string[];
  // The label's drug interactions, warnings and "ask a doctor or pharmacist if you take" text, in English.
  interactions: string;
};

export type Interaction = { a: string; b: string; term: string; excerpt: string };

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// The names another label could call this medication by: ingredients, brands, its own name and its classes.
function termsFor(name: string, info: DrugInfo): string[] {
  const words = [...info.ingredients, ...info.brands, drugKey(name), ...classTerms(info.classes)].map((w) => w.toLowerCase().trim());
  return [...new Set(words.filter((w) => w.length >= 3))];
}

// The sentence around a match, at most `max` characters.
function sentenceAround(text: string, index: number, max = 300) {
  let start = Math.max(text.lastIndexOf(". ", index) + 2, text.lastIndexOf("\n", index) + 1, 0);
  let end = text.indexOf(". ", index);
  if (end === -1) end = text.length;
  // A long sentence (often a table on prescription labels): the part around the match, from a word boundary.
  const cut = end - start > max && index - start > max / 2;
  if (cut) start = text.indexOf(" ", index - Math.floor(max / 2)) + 1;
  if (end - start > max) end = start + max;
  const s = text.slice(start, end + 1).replace(/\s+/g, " ").trim();
  const body = s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s;
  return cut ? `…${body}` : body;
}

// Every pair of medications where one's label mentions the other (by ingredient, brand or class). One entry per pair.
export function findInteractions(meds: { name: string; info: DrugInfo | null }[]): Interaction[] {
  const out: Interaction[] = [];
  const seen = new Set<string>();
  for (const a of meds) {
    if (!a.info?.interactions) continue;
    for (const b of meds) {
      if (a === b || !b.info) continue;
      // Two names for the same drug (a brand and its generic) aren't an interaction.
      if (a.info.ingredients.some((i) => b.info!.ingredients.includes(i)) || drugKey(a.name) === drugKey(b.name)) continue;
      const pair = [a.name, b.name].sort().join("|");
      if (seen.has(pair)) continue;
      for (const term of termsFor(b.name, b.info)) {
        const m = new RegExp(`\\b${escape(term)}s?\\b`, "i").exec(a.info.interactions);
        if (m) {
          seen.add(pair);
          out.push({ a: a.name, b: b.name, term, excerpt: sentenceAround(a.info.interactions, m.index) });
          break;
        }
      }
    }
  }
  return out;
}

// ---------- Reading a label photo ----------

export const MED_FORMS = ["tablet", "capsule", "liquid", "inhaler", "patch", "injection", "cream", "drops", "other"] as const;

export type LabelScan = {
  name: string;
  genericName?: string;
  dose?: string;
  form?: (typeof MED_FORMS)[number];
  timesPerDay?: number;
  everyHours?: number;
  prescriber?: string;
  instructions?: string;
};

export const LABEL_PROMPT = `You read a photo of a medication label (pharmacy bottle, box or inhaler). Reply with ONLY a JSON object, no prose:
{"name": brand or product name as printed, "genericName": active ingredient(s) if printed, "dose": strength per dose like "200 mg" or "2 puffs",
"form": one of ${MED_FORMS.join(", ")}, "timesPerDay": number if the directions say how many times a day,
"everyHours": number if the directions say every N hours, "prescriber": doctor's name if printed, "instructions": the directions line, shortened}.
Leave out anything you can't read. If there is no medication label in the photo, reply {"error": "no label"}.`;

// The model's reply as a label, or null when it found none. Tolerates a code fence or text around the JSON.
export function parseLabelScan(reply: string): LabelScan | null {
  const json = reply.match(/\{[\s\S]*\}/)?.[0];
  if (!json) return null;
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(json);
  } catch {
    return null;
  }
  const str = (v: unknown, max = 80) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : undefined);
  const num = (v: unknown, lo: number, hi: number) => {
    const n = typeof v === "string" ? Number(v) : v;
    return typeof n === "number" && Number.isFinite(n) && n >= lo && n <= hi ? Math.round(n) : undefined;
  };
  const name = str(raw.name);
  if (raw.error || !name) return null;
  const form = str(raw.form)?.toLowerCase();
  return {
    name,
    genericName: str(raw.genericName),
    dose: str(raw.dose),
    form: MED_FORMS.find((f) => f === form),
    timesPerDay: num(raw.timesPerDay, 1, 8),
    everyHours: num(raw.everyHours, 1, 72),
    prescriber: str(raw.prescriber),
    instructions: str(raw.instructions, 200),
  };
}

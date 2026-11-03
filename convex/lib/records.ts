// Health records (convex/records.ts): what the model is asked to read from a lab report or clinic letter, and
// checking its JSON reply. Values are kept as printed; the explanations are plain language in the user's language.
import { v } from "convex/values";
import { LANGUAGES, Lang } from "./language";

export const RECORD_KINDS = ["lab", "letter", "imaging", "other"] as const;
export type RecordKind = (typeof RECORD_KINDS)[number];
export const FLAGS = ["low", "normal", "high", "abnormal"] as const;
export type Flag = (typeof FLAGS)[number];
export const recordKind = v.union(...RECORD_KINDS.map((k) => v.literal(k)));
export const labFlag = v.union(...FLAGS.map((f) => v.literal(f)));

export type LabResult = {
  test: string; // a standard English name, so the same test lines up across reports ("Hemoglobin A1c")
  value?: number;
  text?: string; // a result that isn't a number ("Negative", "Trace")
  unit?: string;
  low?: number;
  high?: number;
  flag?: Flag;
  explanation: string;
};

export type ReadRecord = {
  kind: RecordKind;
  title: string;
  date?: string; // YYYY-MM-DD, when the sample was taken or the letter written
  source?: string; // lab or clinic
  summary: string;
  results: LabResult[];
};

export const MAX_RESULTS = 80;

export function recordPrompt(lang: Lang) {
  const language = LANGUAGES[lang].english;
  return `You read a health record for its owner: a lab report, discharge or clinic letter, or imaging report. Reply with ONLY a JSON object, no prose:
{"kind": one of ${RECORD_KINDS.join(", ")},
"title": a short title like "Blood test" or "Discharge letter", in ${language},
"date": the collection or letter date as YYYY-MM-DD if printed,
"source": the lab, hospital or clinic name if printed,
"summary": 2 to 4 short sentences in ${language} saying in plain words what this record shows, what is outside the usual range, and what is worth asking the doctor. No diagnosis, no alarm; say when something needs prompt attention only if the report itself says so,
"results": [{"test": the standard English name of the test (e.g. "Hemoglobin A1c", "LDL cholesterol", "TSH"), "value": number if numeric, "text": the result if not a number,
"unit": as printed, "low": low end of the printed reference range, "high": high end, "flag": one of ${FLAGS.join(", ")} (from the report's own flag or range),
"explanation": one plain sentence in ${language} on what this test measures and what this result means}]}.
Copy values exactly as printed; never guess a value. Leave "results" empty for a letter without test values. If this isn't a health record, reply {"error": "not a record"}.`;
}

const str = (v: unknown, max: number) => (typeof v === "string" && v.trim() ? v.trim().replace(/\s+/g, " ").slice(0, max) : undefined);
const num = (v: unknown) => {
  const n = typeof v === "string" ? Number(v.replace(/,/g, "")) : v;
  return typeof n === "number" && Number.isFinite(n) ? n : undefined;
};

// The model's reply as a record, or null when it found none. Tolerates a code fence or text around the JSON.
export function parseRecord(reply: string): ReadRecord | null {
  const json = reply.match(/\{[\s\S]*\}/)?.[0];
  if (!json) return null;
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(json);
  } catch {
    return null;
  }
  if (raw.error) return null;
  const title = str(raw.title, 80);
  const summary = str(raw.summary, 1200);
  if (!title || !summary) return null;
  const date = str(raw.date, 10);
  const results: LabResult[] = [];
  for (const r of Array.isArray(raw.results) ? raw.results.slice(0, MAX_RESULTS) : []) {
    if (!r || typeof r !== "object") continue;
    const o = r as Record<string, unknown>;
    const test = str(o.test, 80);
    const value = num(o.value);
    const text = value === undefined ? str(o.text ?? o.value, 40) : undefined;
    if (!test || (value === undefined && !text)) continue;
    const flag = str(o.flag, 10)?.toLowerCase();
    results.push({
      test,
      ...(value !== undefined && { value }),
      ...(text && { text }),
      ...(str(o.unit, 20) && { unit: str(o.unit, 20) }),
      ...(num(o.low) !== undefined && { low: num(o.low) }),
      ...(num(o.high) !== undefined && { high: num(o.high) }),
      ...(FLAGS.includes(flag as Flag) && { flag: flag as Flag }),
      explanation: str(o.explanation, 300) ?? "",
    });
  }
  const kind = str(raw.kind, 10) as RecordKind | undefined;
  return {
    kind: kind && RECORD_KINDS.includes(kind) ? kind : results.length ? "lab" : "other",
    title,
    ...(date && /^\d{4}-\d{2}-\d{2}$/.test(date) && !Number.isNaN(Date.parse(date)) && { date }),
    ...(str(raw.source, 80) && { source: str(raw.source, 80) }),
    summary,
    results,
  };
}

// "LDL cholesterol" and "ldl  Cholesterol" are one test.
export const testKey = (test: string) => test.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

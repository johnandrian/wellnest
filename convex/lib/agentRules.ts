// The agent's rules: what in a person's own logs is worth proposing an action for (convex/agentScan.ts runs them
// each morning). Pure functions, so they're easy to test. Thresholds are fixed here, never chosen by a model, and
// every proposal lists the logged facts it rests on.
import type { Infer } from "convex/values";
import type { actionDetails } from "./agent";
import type { MedChange, OutcomeKey, WeekStat } from "./insights";
import { shiftDate } from "./insights";
import { outcomeName, outcomeValue } from "./insightsText";
import { fmtGlucose, Units } from "./units";
import type { Lang } from "./language";

export type Proposal = {
  rule: string; // the same rule isn't proposed again within `cooldownDays`
  cooldownDays: number;
  title: string;
  reason: string;
  evidence: { label: string; value: string; date?: string }[];
  details: Infer<typeof actionDetails>;
  urgent: boolean;
};

export type GlucoseReading = { date: string; at: number; value: number; context?: string };

// Fasting above this (mg/dL) counts as high; the usual upper target for fasting glucose in diabetes care.
export const FASTING_HIGH = 130;
export const HIGH_RUN_DAYS = 3;
// Readings this low or high are red flags.
export const GLUCOSE_VERY_LOW = 54;
export const GLUCOSE_VERY_HIGH = 300;
// Pain or a symptom (0-10) at least this bad on average this week, and worse than last week.
export const WORSE_AT_LEAST = 5;

const LOCALE: Record<Lang, string> = { en: "en-US", es: "es-US", el: "el-GR", zh: "zh-CN" };
const day = (date: string, lang: Lang) =>
  new Date(`${date}T12:00:00Z`).toLocaleDateString(LOCALE[lang], { month: "short", day: "numeric", timeZone: "UTC" });

const TEXT = {
  fasting: { en: "Fasting glucose", es: "Glucosa en ayunas", el: "Γλυκόζη νηστείας", zh: "空腹血糖" },
  glucose: { en: "Glucose", es: "Glucosa", el: "Γλυκόζη", zh: "血糖" },
  doctor: { en: "Your doctor", es: "Tu médico", el: "Ο γιατρός σου", zh: "你的医生" },
  medChange: { en: "Medication change", es: "Cambio de medicamento", el: "Αλλαγή φαρμάκου", zh: "用药变化" },
  started: { en: "started", es: "empezó", el: "ξεκίνησε", zh: "开始" },
  doseChanged: { en: "dose changed", es: "cambio de dosis", el: "αλλαγή δόσης", zh: "剂量调整" },
  thisWeek: { en: "This week", es: "Esta semana", el: "Αυτή την εβδομάδα", zh: "本周" },
  lastWeek: { en: "Last week", es: "La semana pasada", el: "Την προηγούμενη εβδομάδα", zh: "上周" },
};

const highTitle: Record<Lang, string> = {
  en: "Message your doctor about high glucose",
  es: "Escribe a tu médico sobre la glucosa alta",
  el: "Στείλε μήνυμα στον γιατρό για την υψηλή γλυκόζη",
  zh: "就血糖偏高给医生发消息",
};
const highReason = (n: number, med: MedChange | undefined, lang: Lang) =>
  ({
    en: `Your fasting glucose has been above ${FASTING_HIGH} mg/dL on ${n} mornings in a row${med ? ` since ${med.name} ${med.kind === "started" ? "was started" : "changed"}` : ""}.`,
    es: `Tu glucosa en ayunas ha estado por encima de ${FASTING_HIGH} mg/dL ${n} mañanas seguidas${med ? ` desde el cambio de ${med.name}` : ""}.`,
    el: `Η γλυκόζη νηστείας σου είναι πάνω από ${FASTING_HIGH} mg/dL ${n} πρωινά στη σειρά${med ? ` από την αλλαγή του ${med.name}` : ""}.`,
    zh: `你的空腹血糖已连续 ${n} 个早上高于 ${FASTING_HIGH} mg/dL${med ? `，从 ${med.name} 调整之后开始` : ""}。`,
  })[lang];
const highSubject: Record<Lang, string> = {
  en: "Higher fasting glucose lately",
  es: "Glucosa en ayunas más alta últimamente",
  el: "Υψηλότερη γλυκόζη νηστείας τελευταία",
  zh: "最近空腹血糖偏高",
};
const highBody = (lo: string, hi: string, n: number, med: MedChange | undefined, medDay: string, lang: Lang) =>
  ({
    en: `Hi, my fasting glucose has been ${lo} to ${hi} for the last ${n} mornings${med ? `, since my ${med.name} ${med.kind === "started" ? "was started" : "dose changed"} on ${medDay}` : ""}. Should I change anything before my next visit?`,
    es: `Hola, mi glucosa en ayunas ha estado entre ${lo} y ${hi} las últimas ${n} mañanas${med ? `, desde el cambio de ${med.name} el ${medDay}` : ""}. ¿Debería cambiar algo antes de mi próxima consulta?`,
    el: `Γεια σας, η γλυκόζη νηστείας μου είναι ${lo} έως ${hi} τα τελευταία ${n} πρωινά${med ? `, από την αλλαγή του ${med.name} στις ${medDay}` : ""}. Πρέπει να αλλάξω κάτι πριν από το επόμενο ραντεβού;`,
    zh: `您好，我最近 ${n} 个早上的空腹血糖在 ${lo} 到 ${hi} 之间${med ? `，从 ${medDay} ${med.name} 调整之后开始` : ""}。在下次就诊前我需要调整什么吗？`,
  })[lang];

const urgentTitle: Record<Lang, string> = {
  en: "Get care today for a glucose reading",
  es: "Busca atención hoy por una lectura de glucosa",
  el: "Ζήτησε φροντίδα σήμερα για μια μέτρηση γλυκόζης",
  zh: "因血糖读数今天就医",
};
const urgentReason = (v: string, low: boolean, lang: Lang) =>
  ({
    en: `You logged a glucose of ${v}, which is ${low ? "very low" : "very high"}.`,
    es: `Registraste una glucosa de ${v}, que está ${low ? "muy baja" : "muy alta"}.`,
    el: `Κατέγραψες γλυκόζη ${v}, που είναι ${low ? "πολύ χαμηλή" : "πολύ υψηλή"}.`,
    zh: `你记录的血糖为 ${v}，${low ? "非常低" : "非常高"}。`,
  })[lang];
const urgentVisitReason = (v: string, low: boolean) => `${low ? "Very low" : "Very high"} glucose reading (${v})`;

const worseTitle: Record<Lang, string> = {
  en: "Find a video visit this week",
  es: "Busca una videoconsulta esta semana",
  el: "Βρες βιντεοκλήση αυτή την εβδομάδα",
  zh: "本周预约一次视频问诊",
};
const worseReason = (name: string, lang: Lang) =>
  ({
    en: `Your ${name} has been worse this week than last week, and you have no visit booked.`,
    es: `Tu ${name} ha estado peor esta semana que la anterior, y no tienes ninguna consulta programada.`,
    el: `Το «${name}» ήταν χειρότερο αυτή την εβδομάδα από την προηγούμενη, και δεν έχεις κλείσει ραντεβού.`,
    zh: `你的${name}本周比上周更差，而且还没有预约就诊。`,
  })[lang];

// The latest run of HIGH_RUN_DAYS consecutive days whose first fasting reading was high, ending today or yesterday.
export function highFastingRule(readings: GlucoseReading[], today: string, changes: MedChange[], lang: Lang, units: Units): Proposal | null {
  const firstFasting = new Map<string, GlucoseReading>();
  for (const r of [...readings].sort((a, b) => a.at - b.at)) if (r.context === "fasting" && !firstFasting.has(r.date)) firstFasting.set(r.date, r);
  const end = firstFasting.has(today) ? today : shiftDate(today, -1);
  const run: GlucoseReading[] = [];
  for (let d = end; run.length < HIGH_RUN_DAYS; d = shiftDate(d, -1)) {
    const r = firstFasting.get(d);
    if (!r || r.value <= FASTING_HIGH) return null;
    run.unshift(r);
  }
  const start = run[0].date;
  // A medication started or changed in the 30 days before the run began.
  const med = changes.filter((c) => c.date <= start && c.date >= shiftDate(start, -30)).sort((a, b) => b.date.localeCompare(a.date))[0];
  const loc = LOCALE[lang];
  const values = run.map((r) => r.value);
  const evidence = run.map((r) => ({ label: TEXT.fasting[lang], value: fmtGlucose(r.value, units, loc), date: day(r.date, lang) }));
  if (med) evidence.push({ label: TEXT.medChange[lang], value: `${med.name} (${(med.kind === "started" ? TEXT.started : TEXT.doseChanged)[lang]})`, date: day(med.date, lang) });
  return {
    rule: "glucose_high_fasting",
    cooldownDays: 14,
    title: highTitle[lang],
    reason: highReason(run.length, med, lang),
    evidence,
    details: {
      kind: "message_doctor",
      to: TEXT.doctor[lang],
      subject: highSubject[lang],
      body: highBody(fmtGlucose(Math.min(...values), units, loc), fmtGlucose(Math.max(...values), units, loc), run.length, med, med ? day(med.date, lang) : "", lang),
    },
    urgent: false,
  };
}

// A very low or very high reading today: an urgent card. The inbox shows the fixed "call your care team or 911" notice.
export function urgentGlucoseRule(readings: GlucoseReading[], today: string, lang: Lang, units: Units): Proposal | null {
  const flagged = readings.filter((r) => r.date === today && (r.value < GLUCOSE_VERY_LOW || r.value > GLUCOSE_VERY_HIGH)).sort((a, b) => b.at - a.at)[0];
  if (!flagged) return null;
  const low = flagged.value < GLUCOSE_VERY_LOW;
  const shown = fmtGlucose(flagged.value, units, LOCALE[lang]);
  return {
    rule: "glucose_urgent",
    cooldownDays: 1,
    title: urgentTitle[lang],
    reason: urgentReason(shown, low, lang),
    evidence: [{ label: TEXT.glucose[lang], value: shown, date: day(flagged.date, lang) }],
    details: { kind: "book_visit", reason: urgentVisitReason(fmtGlucose(flagged.value, units), low), urgency: "today" },
    urgent: true,
  };
}

// Pain or a tracked symptom clearly worse this week than last, and nothing booked: suggest a video visit.
export function worseningRule(stats: WeekStat[], hasVisit: boolean, lang: Lang): Proposal | null {
  if (hasVisit) return null;
  const worse = stats
    .filter((s): s is WeekStat & { lastWeek: number } => (s.outcome === "pain" || s.outcome.startsWith("symptom:")) && s.better === false && s.lastWeek !== undefined && s.thisWeek >= WORSE_AT_LEAST && s.days >= 3)
    .sort((a, b) => b.thisWeek - b.lastWeek - (a.thisWeek - a.lastWeek))[0];
  if (!worse) return null;
  const key: OutcomeKey = worse.outcome;
  const name = outcomeName(key, lang);
  return {
    rule: `worse:${key}`,
    cooldownDays: 14,
    title: worseTitle[lang],
    reason: worseReason(name, lang),
    evidence: [
      { label: `${TEXT.thisWeek[lang]}: ${name}`, value: outcomeValue(key, worse.thisWeek, lang) },
      { label: `${TEXT.lastWeek[lang]}: ${name}`, value: outcomeValue(key, worse.lastWeek, lang) },
    ],
    details: { kind: "book_visit", reason: `${outcomeName(key, "en")} worse this week than last`, urgency: "soon" },
    urgent: false,
  };
}

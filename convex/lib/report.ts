// The health report: one self-contained, print-ready HTML page (inline CSS and SVG charts, no scripts) for a date
// range and a choice of sections. The app turns it into a PDF (expo-print / the browser's print dialog), and share
// links serve it as a read-only page (convex/share.ts). Data is gathered in convex/reports.ts.
import { v } from "convex/values";
import type { HealthDay } from "./health";
import { summarize } from "./health";
import type { DailyLog, Entry } from "./journal";
import { dailySeverity, dailySummary, patterns, summaries } from "./journal";
import type { TrackerEntry } from "./trackers";
import { entryLine, trackersText } from "./trackers";
import { DEFAULT_UNITS, showGlucose, type Units } from "./units";

// Glucose bars: red under 70 or over 250 mg/dL, amber over 180, green in range.
const glucoseBar = (mgdl: number) => (mgdl < 70 || mgdl > 250 ? "#B91C1C" : mgdl > 180 ? "#D97706" : "#81C9AA");
import type { Lang } from "./language";

export const SECTIONS = ["facts", "medications", "journal", "trackers", "exercises", "health", "appointments", "emergency"] as const;
export type Section = (typeof SECTIONS)[number];
export const section = v.union(
  v.literal("facts"),
  v.literal("medications"),
  v.literal("journal"),
  v.literal("trackers"),
  v.literal("exercises"),
  v.literal("health"),
  v.literal("appointments"),
  v.literal("emergency"),
);

export type ReportMed = {
  name: string;
  dose?: string;
  genericName?: string;
  form?: string;
  schedule: string;
  status: string;
  prescriber?: string;
  adherence?: { taken: number; total: number };
  sideEffects: string[];
  changes: string[];
};

export type EmergencyPlanData = {
  sections: { title: string; steps: string[] }[];
  contacts: { name: string; relation?: string; phone: string }[];
  asthma?: { green?: string; yellow?: string; red?: string; preventer?: string; reliever?: string; best?: number };
  notes?: string;
};

export type ReportData = {
  title: string;
  person: string | null;
  from: string;
  to: string;
  generated: string;
  lang: Lang;
  sections: Section[];
  facts: string[];
  meds: ReportMed[];
  entries: Entry[];
  daily: DailyLog[];
  trackers: TrackerEntry[];
  peakFlowBest?: number;
  // Units for glucose and weight; US units when left out.
  units?: Units;
  exercises: string;
  health: HealthDay[];
  appointments: string;
  team: { name: string; role?: string; clinic?: string; phone?: string; email?: string }[];
  emergency: EmergencyPlanData | null;
};

const HEAD: Record<Lang, Record<string, string>> = {
  en: {
    period: "Period", generated: "Generated", facts: "Key facts", medications: "Medications", journal: "Symptoms and daily check-ins",
    trackers: "Condition trackers", exercises: "Exercises and physical therapy", health: "Health data", appointments: "Appointments and care team",
    emergency: "Emergency plan", none: "Nothing recorded for this period.", name: "Name", dose: "Dose", schedule: "Schedule", status: "Status",
    taken: "Taken", sideEffects: "Side effects", changes: "Changes", careTeam: "Care team", role: "Role", phone: "Phone", patterns: "Patterns (associations, not causes)",
    sleep: "Sleep (hours)", contacts: "Emergency contacts", asthmaPlan: "Asthma action plan", disclaimer: "Made by Wellnest from what the person recorded. It isn't a diagnosis or a medical record.",
  },
  es: {
    period: "Periodo", generated: "Generado", facts: "Datos clave", medications: "Medicamentos", journal: "Síntomas y registros diarios",
    trackers: "Seguimiento de condiciones", exercises: "Ejercicio y fisioterapia", health: "Datos de salud", appointments: "Citas y equipo de atención",
    emergency: "Plan de emergencia", none: "Nada registrado en este periodo.", name: "Nombre", dose: "Dosis", schedule: "Horario", status: "Estado",
    taken: "Tomadas", sideEffects: "Efectos secundarios", changes: "Cambios", careTeam: "Equipo de atención", role: "Función", phone: "Teléfono", patterns: "Patrones (asociaciones, no causas)",
    sleep: "Sueño (horas)", contacts: "Contactos de emergencia", asthmaPlan: "Plan de acción para el asma", disclaimer: "Hecho por Wellnest con lo que la persona registró. No es un diagnóstico ni un historial clínico.",
  },
  el: {
    period: "Περίοδος", generated: "Δημιουργήθηκε", facts: "Βασικά στοιχεία", medications: "Φάρμακα", journal: "Συμπτώματα και ημερήσιες καταγραφές",
    trackers: "Παρακολούθηση παθήσεων", exercises: "Άσκηση και φυσικοθεραπεία", health: "Δεδομένα υγείας", appointments: "Ραντεβού και ομάδα φροντίδας",
    emergency: "Σχέδιο έκτακτης ανάγκης", none: "Τίποτα καταγεγραμμένο αυτή την περίοδο.", name: "Όνομα", dose: "Δόση", schedule: "Πρόγραμμα", status: "Κατάσταση",
    taken: "Ελήφθησαν", sideEffects: "Παρενέργειες", changes: "Αλλαγές", careTeam: "Ομάδα φροντίδας", role: "Ρόλος", phone: "Τηλέφωνο", patterns: "Μοτίβα (συσχετίσεις, όχι αιτίες)",
    sleep: "Ύπνος (ώρες)", contacts: "Επαφές έκτακτης ανάγκης", asthmaPlan: "Πλάνο δράσης για το άσθμα", disclaimer: "Δημιουργήθηκε από το Wellnest με όσα κατέγραψε το άτομο. Δεν είναι διάγνωση ούτε ιατρικός φάκελος.",
  },
  zh: {
    period: "期间", generated: "生成于", facts: "关键信息", medications: "药物", journal: "症状和每日签到",
    trackers: "病情记录", exercises: "运动和理疗", health: "健康数据", appointments: "预约和医护团队",
    emergency: "紧急预案", none: "此期间没有记录。", name: "名称", dose: "剂量", schedule: "时间安排", status: "状态",
    taken: "已服用", sideEffects: "副作用", changes: "变更", careTeam: "医护团队", role: "角色", phone: "电话", patterns: "规律（相关性，并非因果）",
    sleep: "睡眠（小时）", contacts: "紧急联系人", asthmaPlan: "哮喘行动计划", disclaimer: "由 Wellnest 根据本人的记录生成。这不是诊断，也不是病历。",
  },
};

export const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const lines = (s: string) => esc(s).replace(/\n/g, "<br>");

export function dateRange(from: string, to: string): string[] {
  const out: string[] = [];
  for (let t = Date.parse(`${from}T00:00:00Z`); t <= Date.parse(`${to}T00:00:00Z`) && out.length < 400; t += 86_400_000) {
    out.push(new Date(t).toISOString().slice(0, 10));
  }
  return out;
}

// A small bar chart: one bar per day, value / max of the height.
// Glucose per day (mg/dL in), drawn in the user's unit and colored by range. `label` gets the unit and a ")" added.
function glucoseBars(days: string[], mgdl: Map<string, number>, units: Units, label: string): string {
  const shown = new Map([...mgdl].map(([day, x]) => [day, showGlucose(x, units)]));
  const max = showGlucose(Math.max(250, ...mgdl.values()), units);
  const colorOf = new Map([...mgdl].map(([day, x]) => [showGlucose(x, units), glucoseBar(x)]));
  return svgBars(days, shown, max, (v) => colorOf.get(v) ?? "#0B5D57", `${label}, ${units.glucose})`);
}

export function svgBars(days: string[], values: Map<string, number>, max: number, color: (v: number) => string, label: string): string {
  const w = 640;
  const h = 70;
  const bw = w / Math.max(1, days.length);
  const bars = days
    .map((d, i) => {
      const val = values.get(d);
      if (val === undefined) return "";
      const bh = Math.max(3, Math.min(1, val / max) * (h - 4));
      return `<rect x="${(i * bw + 0.5).toFixed(1)}" y="${(h - bh).toFixed(1)}" width="${Math.max(1, bw - 1).toFixed(1)}" height="${bh.toFixed(1)}" fill="${color(val)}"/>`;
    })
    .join("");
  return (
    `<figure><svg viewBox="0 0 ${w} ${h + 14}" width="100%" role="img" aria-label="${esc(label)}">` +
    `<rect x="0" y="0" width="${w}" height="${h}" fill="#F5F7FA"/>${bars}` +
    `<text x="0" y="${h + 12}" font-size="10" fill="#6B7280">${days[0].slice(5)}</text>` +
    `<text x="${w}" y="${h + 12}" font-size="10" fill="#6B7280" text-anchor="end">${days[days.length - 1].slice(5)}</text>` +
    `</svg><figcaption>${esc(label)}</figcaption></figure>`
  );
}

const sev = (n: number) => (n >= 7 ? "#B91C1C" : n >= 4 ? "#D97706" : "#81C9AA");

export function buildReport(d: ReportData): string {
  const H = HEAD[d.lang];
  const days = dateRange(d.from, d.to);
  const units = d.units ?? DEFAULT_UNITS;
  const parts: string[] = [];
  const empty = `<p class="muted">${H.none}</p>`;

  for (const s of d.sections) {
    if (s === "facts") {
      if (!d.facts.length) continue;
      parts.push(`<h2>${H.facts}</h2><ul>${d.facts.map((f) => `<li>${esc(f)}</li>`).join("")}</ul>`);
    }
    if (s === "medications") {
      parts.push(`<h2>${H.medications}</h2>`);
      if (!d.meds.length) parts.push(empty);
      else {
        parts.push(
          `<table><tr><th>${H.name}</th><th>${H.dose}</th><th>${H.schedule}</th><th>${H.status}</th><th>${H.taken}</th></tr>` +
            d.meds
              .map(
                (m) =>
                  `<tr><td><b>${esc(m.name)}</b>${m.genericName ? `<br><span class="muted">${esc(m.genericName)}${m.form ? `, ${esc(m.form)}` : ""}</span>` : ""}${m.prescriber ? `<br><span class="muted">${esc(m.prescriber)}</span>` : ""}</td>` +
                  `<td>${esc(m.dose ?? "")}</td><td>${esc(m.schedule)}</td><td>${esc(m.status)}</td>` +
                  `<td>${m.adherence && m.adherence.total ? `${m.adherence.taken}/${m.adherence.total}` : ""}</td></tr>` +
                  (m.sideEffects.length || m.changes.length
                    ? `<tr class="sub"><td colspan="5">${m.changes.length ? `<b>${H.changes}:</b> ${esc(m.changes.join("; "))}<br>` : ""}${m.sideEffects.length ? `<b>${H.sideEffects}:</b> ${esc(m.sideEffects.join("; "))}` : ""}</td></tr>`
                    : ""),
              )
              .join("") +
            `</table>`,
        );
      }
    }
    if (s === "journal") {
      parts.push(`<h2>${H.journal}</h2>`);
      const series = dailySeverity(d.entries);
      if (!series.size && !d.daily.length) parts.push(empty);
      for (const [symptom, values] of [...series.entries()].slice(0, 6)) {
        parts.push(svgBars(days, values, 10, sev, `${symptom.charAt(0).toUpperCase()}${symptom.slice(1)} (0-10)`));
      }
      for (const [key, label] of [["mood", "Mood"], ["energy", "Energy"], ["sleepQuality", "Sleep quality"]] as const) {
        const vals = new Map(d.daily.flatMap((x) => (x[key] ? [[x.date, x[key]!] as [string, number]] : [])));
        if (vals.size) parts.push(svgBars(days, vals, 5, (v) => (v <= 2 ? "#D97706" : "#0B5D57"), `${label} (1-5)`));
      }
      const lines_ = [...summaries(d.entries), ...dailySummary(d.daily)];
      if (lines_.length) parts.push(`<ul>${lines_.map((l) => `<li>${esc(l)}</li>`).join("")}</ul>`);
      const found = patterns(d.entries, d.health);
      if (found.length) parts.push(`<h3>${H.patterns}</h3><ul>${found.map((l) => `<li>${esc(l)}</li>`).join("")}</ul>`);
    }
    if (s === "trackers") {
      if (!d.trackers.length) continue;
      parts.push(`<h2>${H.trackers}</h2>`);
      const pain = new Map<string, number>();
      for (const e of d.trackers) if (e.pain) pain.set(e.date, Math.max(pain.get(e.date) ?? 0, e.pain.severity));
      if (pain.size) parts.push(svgBars(days, pain, 10, sev, "Pain (highest each day, 0-10)"));
      const flow = new Map<string, number>();
      for (const e of d.trackers) if (e.asthma?.peakFlow) flow.set(e.date, Math.min(flow.get(e.date) ?? Infinity, e.asthma.peakFlow));
      if (flow.size) {
        const best = d.peakFlowBest ?? Math.max(...flow.values());
        parts.push(svgBars(days, flow, best, (v) => (v / best >= 0.8 ? "#81C9AA" : v / best >= 0.5 ? "#D97706" : "#B91C1C"), `Peak flow (lowest each day, L/min${d.peakFlowBest ? `, best ${d.peakFlowBest}` : ""})`));
      }
      const readings = new Map<string, number[]>();
      for (const e of d.trackers) if (e.glucose) readings.set(e.date, [...(readings.get(e.date) ?? []), e.glucose.value]);
      if (readings.size) parts.push(glucoseBars(days, new Map([...readings].map(([day, xs]) => [day, xs.reduce((a, b) => a + b, 0) / xs.length])), units, "Glucose (average of readings each day"));
      parts.push(`<p>${lines(trackersText(d.trackers, d.peakFlowBest, units).split("\n").slice(0, 4).join("\n"))}</p>`);
      parts.push(`<ul class="log">${d.trackers.slice(-60).map((e) => `<li>${esc(e.date)}: ${esc(entryLine(e, d.peakFlowBest, units))}${e.note ? ` (${esc(e.note)})` : ""}</li>`).join("")}</ul>`);
    }
    if (s === "exercises") {
      if (!d.exercises) continue;
      parts.push(`<h2>${H.exercises}</h2><p>${lines(d.exercises.replace(/^- /gm, "• "))}</p>`);
    }
    if (s === "health") {
      if (!d.health.length) continue;
      parts.push(`<h2>${H.health}</h2><p>${lines(summarize(d.health, units))}</p>`);
      const sleep = new Map(d.health.flatMap((h) => (h.metrics.sleepHours !== undefined ? [[h.date, h.metrics.sleepHours] as [string, number]] : [])));
      if (sleep.size) parts.push(svgBars(days, sleep, 10, (v) => (v < 6 ? "#4338CA" : "#A5B4FC"), H.sleep));
      const glucose = new Map(d.health.flatMap((h) => (h.metrics.glucoseAvg !== undefined ? [[h.date, h.metrics.glucoseAvg] as [string, number]] : [])));
      if (glucose.size) parts.push(glucoseBars(days, glucose, units, "Glucose (daily average from a sensor or meter"));
    }
    if (s === "appointments") {
      if (!d.appointments && !d.team.length) continue;
      parts.push(`<h2>${H.appointments}</h2>`);
      if (d.appointments) parts.push(`<p>${lines(d.appointments.replace(/^- /gm, "• "))}</p>`);
      if (d.team.length) {
        parts.push(
          `<h3>${H.careTeam}</h3><table><tr><th>${H.name}</th><th>${H.role}</th><th>${H.phone}</th></tr>` +
            d.team.map((m) => `<tr><td>${esc(m.name)}${m.clinic ? `<br><span class="muted">${esc(m.clinic)}</span>` : ""}</td><td>${esc(m.role ?? "")}</td><td>${esc(m.phone ?? "")}</td></tr>`).join("") +
            `</table>`,
        );
      }
    }
    if (s === "emergency") {
      if (!d.emergency) continue;
      parts.push(emergencyHtml(d.emergency, d.lang));
    }
  }

  return page(
    d.title,
    `<header><h1>${esc(d.title)}</h1><p class="muted">${d.person ? `${esc(d.person)} · ` : ""}${H.period}: ${d.from} – ${d.to} · ${H.generated}: ${esc(d.generated)}</p></header>` +
      parts.join("\n") +
      `<footer>${H.disclaimer}</footer>`,
  );
}

export function emergencyHtml(e: EmergencyPlanData, lang: Lang): string {
  const H = HEAD[lang];
  const out = [`<h2>${H.emergency}</h2>`];
  for (const s of e.sections) {
    out.push(`<h3>${esc(s.title)}</h3><ol>${s.steps.map((x) => `<li>${esc(x)}</li>`).join("")}</ol>`);
  }
  if (e.asthma && Object.values(e.asthma).some(Boolean)) {
    const a = e.asthma;
    out.push(
      `<h3>${H.asthmaPlan}</h3><table>` +
        (a.preventer ? `<tr><th>Preventer</th><td>${esc(a.preventer)}</td></tr>` : "") +
        (a.reliever ? `<tr><th>Reliever</th><td>${esc(a.reliever)}</td></tr>` : "") +
        (a.green ? `<tr><th class="green">Well</th><td>${lines(a.green)}</td></tr>` : "") +
        (a.yellow ? `<tr><th class="amber">Getting worse</th><td>${lines(a.yellow)}</td></tr>` : "") +
        (a.red ? `<tr><th class="red">Emergency</th><td>${lines(a.red)}</td></tr>` : "") +
        (a.best ? `<tr><th>Peak flow best</th><td>${a.best} L/min</td></tr>` : "") +
        `</table>`,
    );
  }
  if (e.contacts.length) {
    out.push(
      `<h3>${H.contacts}</h3><ul>${e.contacts.map((c) => `<li><b>${esc(c.name)}</b>${c.relation ? ` (${esc(c.relation)})` : ""}: <a href="tel:${esc(c.phone.replace(/[^\d+]/g, ""))}">${esc(c.phone)}</a></li>`).join("")}</ul>`,
    );
  }
  if (e.notes) out.push(`<p>${lines(e.notes)}</p>`);
  return out.join("");
}

export function page(title: string, body: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex, nofollow"><title>${esc(title)}</title>
<style>
body{font:14px/1.5 -apple-system,Segoe UI,Roboto,sans-serif;color:#111827;max-width:760px;margin:24px auto;padding:0 18px}
h1{font-size:22px;color:#0B5D57;margin:0}h2{font-size:16px;margin:22px 0 8px;border-bottom:1px solid #D1D5DB;padding-bottom:3px;color:#0B5D57}
h3{font-size:14px;margin:12px 0 4px}p{margin:6px 0}ul,ol{margin:4px 0 8px;padding-left:20px}li{margin:2px 0}
.muted{color:#6B7280}table{border-collapse:collapse;width:100%;margin:6px 0}th,td{border:1px solid #E5E7EB;padding:5px 7px;text-align:left;vertical-align:top;font-size:13px}
th{background:#F5F7FA}tr.sub td{background:#FAFAFA;font-size:12px}figure{margin:8px 0}figcaption{font-size:12px;color:#6B7280}
.log{font-size:12px}.green{background:#DCFCE7}.amber{background:#FEF3C7}.red{background:#FEE2E2}a{color:#0B5D57}
footer{margin-top:28px;padding-top:8px;border-top:1px solid #D1D5DB;font-size:11px;color:#6B7280}
@media print{body{margin:0}h2{break-after:avoid}figure,table{break-inside:avoid}}
</style></head><body>${body}</body></html>`;
}

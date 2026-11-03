// Wording for insights (./insights.ts) in the user's language: patterns, medication before/after, today's weather,
// chart titles and the weekly summary. The model reads the English; the app and the summary use the user's language.
import type { Lang } from "./language";
import type { ChartMetric, FactorKey, MedEffect, OutcomeKey, Pattern, WeekStat } from "./insights";
import { aqiBand, pollenBand, type WeatherDay } from "./weather";

const LOCALE: Record<Lang, string> = { en: "en-US", es: "es-ES", el: "el-GR" };
const num = (n: number, lang: Lang) => n.toLocaleString(LOCALE[lang], { maximumFractionDigits: 1 });
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

const OUTCOMES: Record<Lang, Record<Exclude<OutcomeKey, `symptom:${string}`>, string>> = {
  en: { pain: "pain", mood: "mood", energy: "energy", sleepQuality: "sleep quality", peakFlow: "peak flow", reliever: "reliever puffs", seizures: "seizures" },
  es: { pain: "dolor", mood: "ánimo", energy: "energía", sleepQuality: "calidad del sueño", peakFlow: "flujo máximo", reliever: "inhalaciones de rescate", seizures: "crisis" },
  el: { pain: "πόνος", mood: "διάθεση", energy: "ενέργεια", sleepQuality: "ποιότητα ύπνου", peakFlow: "μέγιστη ροή", reliever: "εισπνοές ανακουφιστικού", seizures: "κρίσεις" },
};

export function outcomeName(key: OutcomeKey, lang: Lang): string {
  return key.startsWith("symptom:") ? key.slice(8) : OUTCOMES[lang][key as keyof (typeof OUTCOMES)["en"]];
}

// "4.2/10", "3.1/5", "410 L/min", "2.5 puffs a day", "0.3 a day".
export function outcomeValue(key: OutcomeKey, n: number, lang: Lang): string {
  const perDay = { en: "a day", es: "al día", el: "τη μέρα" }[lang];
  if (key === "pain" || key.startsWith("symptom:")) return `${num(n, lang)}/10`;
  if (key === "mood" || key === "energy" || key === "sleepQuality") return `${num(n, lang)}/5`;
  if (key === "peakFlow") return `${num(n, lang)} L/min`;
  return `${num(n, lang)} ${perDay}`;
}

// The condition in "on days with ___".
const FACTORS: Record<Lang, Record<FactorKey, { below?: string; atLeast?: string; yes?: string }>> = {
  en: {
    sleepHours: { below: "under {t} h of sleep", atLeast: "{t} h of sleep or more" },
    sleepQuality: { below: "sleep quality under {t}/5", atLeast: "sleep quality of {t}/5 or more" },
    steps: { below: "fewer than {t} steps the day before", atLeast: "{t}+ steps the day before" },
    restingHeartRate: { below: "a resting heart rate under {t}", atLeast: "a resting heart rate of {t}+" },
    hrv: { below: "HRV under {t} ms", atLeast: "HRV of {t}+ ms" },
    period: { yes: "a period" },
    tempMax: { below: "highs under {t}°C", atLeast: "highs of {t}°C or more" },
    humidity: { below: "humidity under {t}%", atLeast: "humidity of {t}% or more" },
    pressureDrop: { yes: "a drop in air pressure" },
    rain: { yes: "rain" },
    aqi: { below: "air quality index under {t}", atLeast: "air quality index of {t}+" },
    pollen: { below: "pollen under {t}", atLeast: "pollen of {t}+ grains/m³" },
  },
  es: {
    sleepHours: { below: "menos de {t} h de sueño", atLeast: "{t} h de sueño o más" },
    sleepQuality: { below: "calidad del sueño menor de {t}/5", atLeast: "calidad del sueño de {t}/5 o más" },
    steps: { below: "menos de {t} pasos el día anterior", atLeast: "{t} pasos o más el día anterior" },
    restingHeartRate: { below: "pulso en reposo menor de {t}", atLeast: "pulso en reposo de {t} o más" },
    hrv: { below: "VFC menor de {t} ms", atLeast: "VFC de {t} ms o más" },
    period: { yes: "regla" },
    tempMax: { below: "máximas de menos de {t} °C", atLeast: "máximas de {t} °C o más" },
    humidity: { below: "humedad menor del {t} %", atLeast: "humedad del {t} % o más" },
    pressureDrop: { yes: "una bajada de la presión atmosférica" },
    rain: { yes: "lluvia" },
    aqi: { below: "índice de calidad del aire menor de {t}", atLeast: "índice de calidad del aire de {t} o más" },
    pollen: { below: "polen menor de {t}", atLeast: "polen de {t} granos/m³ o más" },
  },
  el: {
    sleepHours: { below: "λιγότερο από {t} ώρες ύπνο", atLeast: "{t} ώρες ύπνο ή περισσότερο" },
    sleepQuality: { below: "ποιότητα ύπνου κάτω από {t}/5", atLeast: "ποιότητα ύπνου {t}/5 ή περισσότερο" },
    steps: { below: "λιγότερα από {t} βήματα την προηγούμενη μέρα", atLeast: "{t}+ βήματα την προηγούμενη μέρα" },
    restingHeartRate: { below: "παλμούς ηρεμίας κάτω από {t}", atLeast: "παλμούς ηρεμίας {t}+" },
    hrv: { below: "HRV κάτω από {t} ms", atLeast: "HRV {t}+ ms" },
    period: { yes: "περίοδο" },
    tempMax: { below: "μέγιστη θερμοκρασία κάτω από {t}°C", atLeast: "μέγιστη θερμοκρασία {t}°C ή παραπάνω" },
    humidity: { below: "υγρασία κάτω από {t}%", atLeast: "υγρασία {t}% ή παραπάνω" },
    pressureDrop: { yes: "πτώση της ατμοσφαιρικής πίεσης" },
    rain: { yes: "βροχή" },
    aqi: { below: "δείκτη ποιότητας αέρα κάτω από {t}", atLeast: "δείκτη ποιότητας αέρα {t}+" },
    pollen: { below: "γύρη κάτω από {t}", atLeast: "γύρη {t}+ κόκκους/m³" },
  },
};

export function conditionText(p: Pick<Pattern, "factor" | "side" | "threshold">, lang: Lang): string {
  const t = p.threshold === undefined ? "" : p.factor === "steps" ? Math.round(p.threshold).toLocaleString(LOCALE[lang]) : num(p.threshold, lang);
  return (FACTORS[lang][p.factor][p.side] ?? "").replace("{t}", t);
}

export function patternText(p: Pattern, lang: Lang): string {
  const o = outcomeName(p.outcome, lang);
  const a = outcomeValue(p.outcome, p.worse, lang);
  const b = outcomeValue(p.outcome, p.other, lang);
  const c = conditionText(p, lang);
  if (lang === "es") return `${cap(o)}: media de ${a} los días con ${c} (${p.worseDays} días), frente a ${b} el resto (${p.otherDays}).`;
  if (lang === "el") return `${cap(o)}: μέσος όρος ${a} τις μέρες με ${c} (${p.worseDays} μέρες), έναντι ${b} τις υπόλοιπες (${p.otherDays}).`;
  return `${cap(o)} averaged ${a} on days with ${c} (${p.worseDays} days), vs ${b} on other days (${p.otherDays}).`;
}

const shortDate = (date: string, lang: Lang) =>
  new Date(`${date}T12:00:00Z`).toLocaleDateString(LOCALE[lang], { month: "short", day: "numeric", timeZone: "UTC" });

export function medEffectText(e: MedEffect, lang: Lang): string {
  const o = outcomeName(e.outcome, lang);
  const before = outcomeValue(e.outcome, e.before, lang);
  const after = outcomeValue(e.outcome, e.after, lang);
  const d = shortDate(e.date, lang);
  if (lang === "es") {
    const what = e.kind === "started" ? `empezar ${e.name}` : `cambiar la dosis de ${e.name}`;
    return `${cap(o)} desde ${what} (${d}): ${after}, frente a ${before} las 2 semanas anteriores (${e.better ? "mejor" : "peor"}).`;
  }
  if (lang === "el") {
    const what = e.kind === "started" ? `την έναρξη του ${e.name}` : `την αλλαγή δόσης του ${e.name}`;
    return `${cap(o)} μετά ${what} (${d}): ${after}, έναντι ${before} τις 2 εβδομάδες πριν (${e.better ? "καλύτερα" : "χειρότερα"}).`;
  }
  const what = e.kind === "started" ? `starting ${e.name}` : `changing the dose of ${e.name}`;
  return `${cap(o)} since ${what} on ${d}: ${after}, vs ${before} in the 2 weeks before (${e.better ? "better" : "worse"}).`;
}

const AQI_WORDS: Record<Lang, Record<ReturnType<typeof aqiBand>, string>> = {
  en: { good: "good", moderate: "moderate", unhealthy_sensitive: "unhealthy for sensitive groups", unhealthy: "unhealthy" },
  es: { good: "buena", moderate: "moderada", unhealthy_sensitive: "mala para grupos sensibles", unhealthy: "mala" },
  el: { good: "καλή", moderate: "μέτρια", unhealthy_sensitive: "επιβαρυμένη για ευαίσθητες ομάδες", unhealthy: "κακή" },
};
const POLLEN_WORDS: Record<Lang, Record<ReturnType<typeof pollenBand>, string>> = {
  en: { low: "low", moderate: "moderate", high: "high" },
  es: { low: "bajo", moderate: "moderado", high: "alto" },
  el: { low: "χαμηλή", moderate: "μέτρια", high: "υψηλή" },
};

// "18–25°C · humidity 60% · rain 3 mm · air quality 42 (good) · pollen high".
export function weatherLine(w: WeatherDay, lang: Lang): string {
  const L = {
    en: { humidity: "humidity", rain: "rain", air: "air quality", pollen: "pollen" },
    es: { humidity: "humedad", rain: "lluvia", air: "calidad del aire", pollen: "polen" },
    el: { humidity: "υγρασία", rain: "βροχή", air: "ποιότητα αέρα", pollen: "γύρη" },
  }[lang];
  return [
    w.tempMin !== undefined && w.tempMax !== undefined && `${num(w.tempMin, lang)}–${num(w.tempMax, lang)}°C`,
    w.humidity !== undefined && `${L.humidity} ${w.humidity}%`,
    w.precip !== undefined && w.precip >= 1 && `${L.rain} ${num(w.precip, lang)} mm`,
    w.aqi !== undefined && `${L.air} ${w.aqi} (${AQI_WORDS[lang][aqiBand(w.aqi)]})`,
    w.pollen !== undefined && `${L.pollen} ${POLLEN_WORDS[lang][pollenBand(w.pollen)]}`,
  ]
    .filter(Boolean)
    .join(" · ");
}

// ---------- Charts ----------

const CHART_NAMES: Record<Lang, Record<Exclude<ChartMetric, "symptom">, [string, string]>> = {
  en: {
    pain: ["Pain", "/10"], mood: ["Mood", "/5"], energy: ["Energy", "/5"], sleepQuality: ["Sleep quality", "/5"], sleepHours: ["Sleep", "h"],
    steps: ["Steps", ""], restingHeartRate: ["Resting heart rate", "bpm"], hrv: ["HRV", "ms"], weightKg: ["Weight", "kg"],
    peakFlow: ["Peak flow", "L/min"], reliever: ["Reliever puffs", ""], seizures: ["Seizures", ""], tempMax: ["Daily high", "°C"],
    aqi: ["Air quality index", ""], pollen: ["Pollen", "grains/m³"],
  },
  es: {
    pain: ["Dolor", "/10"], mood: ["Ánimo", "/5"], energy: ["Energía", "/5"], sleepQuality: ["Calidad del sueño", "/5"], sleepHours: ["Sueño", "h"],
    steps: ["Pasos", ""], restingHeartRate: ["Pulso en reposo", "lpm"], hrv: ["VFC", "ms"], weightKg: ["Peso", "kg"],
    peakFlow: ["Flujo máximo", "L/min"], reliever: ["Inhalaciones de rescate", ""], seizures: ["Crisis", ""], tempMax: ["Máxima", "°C"],
    aqi: ["Índice de calidad del aire", ""], pollen: ["Polen", "granos/m³"],
  },
  el: {
    pain: ["Πόνος", "/10"], mood: ["Διάθεση", "/5"], energy: ["Ενέργεια", "/5"], sleepQuality: ["Ποιότητα ύπνου", "/5"], sleepHours: ["Ύπνος", "ώρες"],
    steps: ["Βήματα", ""], restingHeartRate: ["Παλμοί ηρεμίας", "bpm"], hrv: ["HRV", "ms"], weightKg: ["Βάρος", "kg"],
    peakFlow: ["Μέγιστη ροή", "L/min"], reliever: ["Εισπνοές ανακουφιστικού", ""], seizures: ["Κρίσεις", ""], tempMax: ["Μέγιστη", "°C"],
    aqi: ["Δείκτης ποιότητας αέρα", ""], pollen: ["Γύρη", "κόκκοι/m³"],
  },
};

export function chartName(metric: ChartMetric, lang: Lang, symptom?: string): { title: string; unit: string } {
  if (metric === "symptom") return { title: cap(symptom ?? ""), unit: "/10" };
  const [title, unit] = CHART_NAMES[lang][metric];
  return { title, unit };
}

// ---------- Weekly summary ----------

export function weeklyText(opts: {
  lang: Lang;
  from: string;
  to: string;
  stats: WeekStat[];
  doses?: { taken: number; total: number };
  pattern?: Pattern;
  medEffect?: MedEffect;
}): string {
  const { lang } = opts;
  const L = {
    en: { title: "Your week", last: "last week", better: "better", worse: "worse", doses: "Medications: {a} of {b} doses taken", pattern: "Worth watching", med: "Medication", footer: "Ask me about any of these, or open Health tools for the charts." },
    es: { title: "Tu semana", last: "la semana pasada", better: "mejor", worse: "peor", doses: "Medicamentos: {a} de {b} dosis tomadas", pattern: "Para vigilar", med: "Medicamento", footer: "Pregúntame por cualquiera de estos puntos, o abre Herramientas de salud para ver los gráficos." },
    el: { title: "Η εβδομάδα σου", last: "την προηγούμενη εβδομάδα", better: "καλύτερα", worse: "χειρότερα", doses: "Φάρμακα: {a} από {b} δόσεις", pattern: "Αξίζει προσοχή", med: "Φάρμακο", footer: "Ρώτησέ με για οτιδήποτε από αυτά ή άνοιξε τα Εργαλεία υγείας για τα γραφήματα." },
  }[lang];
  const lines = [`📅 **${L.title}** (${shortDate(opts.from, lang)} – ${shortDate(opts.to, lang)})`, ""];
  for (const s of opts.stats) {
    const now = outcomeValue(s.outcome, s.thisWeek, lang);
    const was = s.lastWeek === undefined ? "" : ` (${L.last} ${outcomeValue(s.outcome, s.lastWeek, lang)}${s.better === undefined ? "" : `, ${s.better ? L.better : L.worse}`})`;
    lines.push(`• ${cap(outcomeName(s.outcome, lang))}: ${now}${was}`);
  }
  if (opts.doses?.total) lines.push(`• ${L.doses.replace("{a}", String(opts.doses.taken)).replace("{b}", String(opts.doses.total))}`);
  if (opts.medEffect) lines.push("", `💊 ${L.med}: ${medEffectText(opts.medEffect, lang)}`);
  if (opts.pattern) lines.push("", `🔎 ${L.pattern}: ${patternText(opts.pattern, lang)}`);
  lines.push("", L.footer);
  return lines.join("\n");
}

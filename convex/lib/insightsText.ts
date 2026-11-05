// Wording for insights (./insights.ts) in the user's language: patterns, medication before/after, today's weather,
// chart titles and the weekly summary. The model reads the English; the app and the summary use the user's language.
import type { Lang } from "./language";
import type { ChartMetric, FactorKey, ForecastMatch, MedEffect, OutcomeKey, Pattern, WEATHER_FACTORS, WeekStat } from "./insights";
import { aqiBand, pollenBand, type WeatherDay } from "./weather";
import { DEFAULT_UNITS, fmtWeight, type Units } from "./units";

const LOCALE: Record<Lang, string> = { en: "en-US", es: "es-ES", el: "el-GR", zh: "zh-CN" };
const num = (n: number, lang: Lang) => n.toLocaleString(LOCALE[lang], { maximumFractionDigits: 1 });
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

const OUTCOMES: Record<Lang, Record<Exclude<OutcomeKey, `symptom:${string}`>, string>> = {
  en: { pain: "pain", mood: "mood", energy: "energy", sleepQuality: "sleep quality", peakFlow: "peak flow", reliever: "reliever puffs", seizures: "seizures", weight: "weight" },
  es: { pain: "dolor", mood: "ánimo", energy: "energía", sleepQuality: "calidad del sueño", peakFlow: "flujo máximo", reliever: "inhalaciones de rescate", seizures: "crisis", weight: "peso" },
  el: { pain: "πόνος", mood: "διάθεση", energy: "ενέργεια", sleepQuality: "ποιότητα ύπνου", peakFlow: "μέγιστη ροή", reliever: "εισπνοές ανακουφιστικού", seizures: "κρίσεις", weight: "βάρος" },
  zh: { pain: "疼痛", mood: "心情", energy: "精力", sleepQuality: "睡眠质量", peakFlow: "峰流速", reliever: "缓解药吸入次数", seizures: "癫痫发作", weight: "体重" },
};

export function outcomeName(key: OutcomeKey, lang: Lang): string {
  return key.startsWith("symptom:") ? key.slice(8) : OUTCOMES[lang][key as keyof (typeof OUTCOMES)["en"]];
}

// "4.2/10", "3.1/5", "410 L/min", "2.5 puffs a day", "0.3 a day", "182.4 lb".
export function outcomeValue(key: OutcomeKey, n: number, lang: Lang, units: Units = DEFAULT_UNITS): string {
  const perDay = { en: "a day", es: "al día", el: "τη μέρα", zh: "次/天" }[lang];
  if (key === "weight") return fmtWeight(n, units, LOCALE[lang]);
  if (key === "pain" || key.startsWith("symptom:")) return `${num(n, lang)}/10`;
  if (key === "mood" || key === "energy" || key === "sleepQuality") return `${num(n, lang)}/5`;
  if (key === "peakFlow") return `${num(n, lang)} L/min`;
  return lang === "zh" ? `${num(n, lang)}${perDay}` : `${num(n, lang)} ${perDay}`;
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
    weightGain: { yes: "a weight gain of {g} or more over 3 days" },
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
    weightGain: { yes: "un aumento de peso de {g} o más en 3 días" },
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
    weightGain: { yes: "αύξηση βάρους {g} ή περισσότερο μέσα σε 3 μέρες" },
    tempMax: { below: "μέγιστη θερμοκρασία κάτω από {t}°C", atLeast: "μέγιστη θερμοκρασία {t}°C ή παραπάνω" },
    humidity: { below: "υγρασία κάτω από {t}%", atLeast: "υγρασία {t}% ή παραπάνω" },
    pressureDrop: { yes: "πτώση της ατμοσφαιρικής πίεσης" },
    rain: { yes: "βροχή" },
    aqi: { below: "δείκτη ποιότητας αέρα κάτω από {t}", atLeast: "δείκτη ποιότητας αέρα {t}+" },
    pollen: { below: "γύρη κάτω από {t}", atLeast: "γύρη {t}+ κόκκους/m³" },
  },
  zh: {
    sleepHours: { below: "睡眠不足 {t} 小时", atLeast: "睡眠 {t} 小时或以上" },
    sleepQuality: { below: "睡眠质量低于 {t}/5", atLeast: "睡眠质量 {t}/5 或以上" },
    steps: { below: "前一天步数少于 {t}", atLeast: "前一天步数达到 {t} 或以上" },
    restingHeartRate: { below: "静息心率低于 {t}", atLeast: "静息心率 {t} 或以上" },
    hrv: { below: "HRV 低于 {t} 毫秒", atLeast: "HRV {t} 毫秒或以上" },
    period: { yes: "经期" },
    weightGain: { yes: "3 天内体重增加 {g} 或以上" },
    tempMax: { below: "最高气温低于 {t}°C", atLeast: "最高气温 {t}°C 或以上" },
    humidity: { below: "湿度低于 {t}%", atLeast: "湿度 {t}% 或以上" },
    pressureDrop: { yes: "气压下降" },
    rain: { yes: "下雨" },
    aqi: { below: "空气质量指数低于 {t}", atLeast: "空气质量指数 {t} 或以上" },
    pollen: { below: "花粉低于 {t}", atLeast: "花粉 {t} 粒/立方米或以上" },
  },
};

export function conditionText(p: Pick<Pattern, "factor" | "side" | "threshold">, lang: Lang, units: Units = DEFAULT_UNITS): string {
  const t = p.threshold === undefined ? "" : p.factor === "steps" ? Math.round(p.threshold).toLocaleString(LOCALE[lang]) : num(p.threshold, lang);
  // The weight gain step (1 kg) in the user's unit, rounded: "2 lb" or "1 kg".
  const g = units.weight === "lb" ? "2 lb" : "1 kg";
  return (FACTORS[lang][p.factor][p.side] ?? "").replace("{t}", t).replace("{g}", g);
}

export function patternText(p: Pattern, lang: Lang, units: Units = DEFAULT_UNITS): string {
  const o = outcomeName(p.outcome, lang);
  const a = outcomeValue(p.outcome, p.worse, lang, units);
  const b = outcomeValue(p.outcome, p.other, lang, units);
  const c = conditionText(p, lang, units);
  if (lang === "es") return `${cap(o)}: media de ${a} los días con ${c} (${p.worseDays} días), frente a ${b} el resto (${p.otherDays}).`;
  if (lang === "zh") return `${o}：在${c}的日子里平均为 ${a}（${p.worseDays} 天），其他日子为 ${b}（${p.otherDays} 天）。`;
  if (lang === "el") return `${cap(o)}: μέσος όρος ${a} τις μέρες με ${c} (${p.worseDays} μέρες), έναντι ${b} τις υπόλοιπες (${p.otherDays}).`;
  return `${cap(o)} averaged ${a} on days with ${c} (${p.worseDays} days), vs ${b} on other days (${p.otherDays}).`;
}

const shortDate = (date: string, lang: Lang) =>
  new Date(`${date}T12:00:00Z`).toLocaleDateString(LOCALE[lang], { month: "short", day: "numeric", timeZone: "UTC" });

export function medEffectText(e: MedEffect, lang: Lang, units: Units = DEFAULT_UNITS): string {
  const o = outcomeName(e.outcome, lang);
  const before = outcomeValue(e.outcome, e.before, lang, units);
  const after = outcomeValue(e.outcome, e.after, lang, units);
  const d = shortDate(e.date, lang);
  // Weight is never called better or worse.
  const verdict = (better: string, worse: string, open: string, close: string) => (e.better === undefined ? "" : `${open}${e.better ? better : worse}${close}`);
  if (lang === "es") {
    const what = e.kind === "started" ? `empezar ${e.name}` : `cambiar la dosis de ${e.name}`;
    return `${cap(o)} desde ${what} (${d}): ${after}, frente a ${before} las 2 semanas anteriores${verdict("mejor", "peor", " (", ")")}.`;
  }
  if (lang === "zh") {
    const what = e.kind === "started" ? `开始服用 ${e.name}` : `调整 ${e.name} 的剂量`;
    return `${o}：自 ${d} ${what}以来为 ${after}，之前两周为 ${before}${verdict("好转", "变差", "（", "）")}。`;
  }
  if (lang === "el") {
    const what = e.kind === "started" ? `την έναρξη του ${e.name}` : `την αλλαγή δόσης του ${e.name}`;
    return `${cap(o)} μετά ${what} (${d}): ${after}, έναντι ${before} τις 2 εβδομάδες πριν${verdict("καλύτερα", "χειρότερα", " (", ")")}.`;
  }
  const what = e.kind === "started" ? `starting ${e.name}` : `changing the dose of ${e.name}`;
  return `${cap(o)} since ${what} on ${d}: ${after}, vs ${before} in the 2 weeks before${verdict("better", "worse", " (", ")")}.`;
}

const AQI_WORDS: Record<Lang, Record<ReturnType<typeof aqiBand>, string>> = {
  en: { good: "good", moderate: "moderate", unhealthy_sensitive: "unhealthy for sensitive groups", unhealthy: "unhealthy" },
  es: { good: "buena", moderate: "moderada", unhealthy_sensitive: "mala para grupos sensibles", unhealthy: "mala" },
  el: { good: "καλή", moderate: "μέτρια", unhealthy_sensitive: "επιβαρυμένη για ευαίσθητες ομάδες", unhealthy: "κακή" },
  zh: { good: "良好", moderate: "中等", unhealthy_sensitive: "对敏感人群不健康", unhealthy: "不健康" },
};
const POLLEN_WORDS: Record<Lang, Record<ReturnType<typeof pollenBand>, string>> = {
  en: { low: "low", moderate: "moderate", high: "high" },
  es: { low: "bajo", moderate: "moderado", high: "alto" },
  el: { low: "χαμηλή", moderate: "μέτρια", high: "υψηλή" },
  zh: { low: "低", moderate: "中等", high: "高" },
};

// "18–25°C · humidity 60% · rain 3 mm · air quality 42 (good) · pollen high".
export function weatherLine(w: WeatherDay, lang: Lang): string {
  const L = {
    en: { humidity: "humidity", rain: "rain", air: "air quality", pollen: "pollen" },
    es: { humidity: "humedad", rain: "lluvia", air: "calidad del aire", pollen: "polen" },
    el: { humidity: "υγρασία", rain: "βροχή", air: "ποιότητα αέρα", pollen: "γύρη" },
    zh: { humidity: "湿度", rain: "降雨", air: "空气质量", pollen: "花粉" },
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
  zh: {
    pain: ["疼痛", "/10"], mood: ["心情", "/5"], energy: ["精力", "/5"], sleepQuality: ["睡眠质量", "/5"], sleepHours: ["睡眠", "小时"],
    steps: ["步数", ""], restingHeartRate: ["静息心率", "次/分"], hrv: ["HRV", "毫秒"], weightKg: ["体重", "公斤"],
    peakFlow: ["峰流速", "L/min"], reliever: ["缓解药吸入次数", ""], seizures: ["癫痫发作", ""], tempMax: ["最高气温", "°C"],
    aqi: ["空气质量指数", ""], pollen: ["花粉", "粒/立方米"],
  },
};

export function chartName(metric: ChartMetric, lang: Lang, symptom?: string, units: Units = DEFAULT_UNITS): { title: string; unit: string } {
  if (metric === "symptom") return { title: cap(symptom ?? ""), unit: "/10" };
  const [title, unit] = CHART_NAMES[lang][metric];
  if (metric === "weightKg") return { title, unit: units.weight };
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
  units?: Units;
}): string {
  const { lang } = opts;
  const units = opts.units ?? DEFAULT_UNITS;
  const L = {
    en: { title: "Your week", last: "last week", better: "better", worse: "worse", doses: "Medications: {a} of {b} doses taken", pattern: "Worth watching", med: "Medication", footer: "Ask me about any of these, or open Health tools for the charts." },
    es: { title: "Tu semana", last: "la semana pasada", better: "mejor", worse: "peor", doses: "Medicamentos: {a} de {b} dosis tomadas", pattern: "Para vigilar", med: "Medicamento", footer: "Pregúntame por cualquiera de estos puntos, o abre Herramientas de salud para ver los gráficos." },
    el: { title: "Η εβδομάδα σου", last: "την προηγούμενη εβδομάδα", better: "καλύτερα", worse: "χειρότερα", doses: "Φάρμακα: {a} από {b} δόσεις", pattern: "Αξίζει προσοχή", med: "Φάρμακο", footer: "Ρώτησέ με για οτιδήποτε από αυτά ή άνοιξε τα Εργαλεία υγείας για τα γραφήματα." },
    zh: { title: "你的一周", last: "上周", better: "好转", worse: "变差", doses: "药物：已服用 {a}/{b} 剂", pattern: "值得留意", med: "药物", footer: "可以随时问我其中任何一项，或打开健康工具查看图表。" },
  }[lang];
  const lines = [`📅 **${L.title}** (${shortDate(opts.from, lang)} – ${shortDate(opts.to, lang)})`, ""];
  for (const s of opts.stats) lines.push(`• ${weekStatLine(s, lang, units)}`);
  if (opts.doses?.total) lines.push(`• ${L.doses.replace("{a}", String(opts.doses.taken)).replace("{b}", String(opts.doses.total))}`);
  if (opts.medEffect) lines.push("", `💊 ${L.med}: ${medEffectText(opts.medEffect, lang, units)}`);
  if (opts.pattern) lines.push("", `🔎 ${L.pattern}: ${patternText(opts.pattern, lang, units)}`);
  lines.push("", L.footer);
  return lines.join("\n");
}

// "Mood: 4/5 (last week 2/5, better)": one line of the weekly summary, also shown to a care circle.
export function weekStatLine(s: WeekStat, lang: Lang, units: Units = DEFAULT_UNITS): string {
  const L = {
    en: { last: "last week", better: "better", worse: "worse" },
    es: { last: "la semana pasada", better: "mejor", worse: "peor" },
    el: { last: "την προηγούμενη εβδομάδα", better: "καλύτερα", worse: "χειρότερα" },
    zh: { last: "上周", better: "好转", worse: "变差" },
  }[lang];
  const now = outcomeValue(s.outcome, s.thisWeek, lang, units);
  const was = s.lastWeek === undefined ? "" : ` (${L.last} ${outcomeValue(s.outcome, s.lastWeek, lang, units)}${s.better === undefined ? "" : `, ${s.better ? L.better : L.worse}`})`;
  return `${cap(outcomeName(s.outcome, lang))}: ${now}${was}`;
}

// ---------- Flare forecast ----------

const FORECAST: Record<Lang, { title: string; titleFor: string; prefix: string; footer: string; footerFor: string } & Record<ForecastFactor, string>> = {
  en: {
    title: "Heads-up for tomorrow",
    titleFor: "Heads-up for {name} tomorrow",
    prefix: "Forecast",
    footer: "This is a pattern in your own logs, not a prediction. If you can, plan an easier day and keep what helps close by.",
    footerFor: "This is a pattern in {name}'s own logs, not a prediction. A quick check-in might be welcome.",
    tempMax: "a high of {v}°C", humidity: "humidity around {v}%", pressureDrop: "a drop in air pressure", rain: "rain", aqi: "an air quality index of {v}", pollen: "pollen around {v} grains/m³",
  },
  es: {
    title: "Aviso para mañana",
    titleFor: "Aviso para mañana sobre {name}",
    prefix: "Pronóstico",
    footer: "Es un patrón en tus propios registros, no una predicción. Si puedes, planea un día más tranquilo y ten a mano lo que te ayuda.",
    footerFor: "Es un patrón en los registros de {name}, no una predicción. Quizá agradezca que le preguntes cómo está.",
    tempMax: "una máxima de {v} °C", humidity: "humedad de alrededor del {v} %", pressureDrop: "una bajada de la presión atmosférica", rain: "lluvia", aqi: "un índice de calidad del aire de {v}", pollen: "polen de unos {v} granos/m³",
  },
  el: {
    title: "Προειδοποίηση για αύριο",
    titleFor: "Προειδοποίηση για αύριο: {name}",
    prefix: "Πρόγνωση",
    footer: "Είναι ένα μοτίβο στις δικές σου καταγραφές, όχι πρόβλεψη. Αν μπορείς, κανόνισε μια πιο ήρεμη μέρα και κράτα κοντά ό,τι σε βοηθά.",
    footerFor: "Είναι ένα μοτίβο στις καταγραφές ({name}), όχι πρόβλεψη. Ένα μήνυμα για να δεις τι κάνει ίσως βοηθήσει.",
    tempMax: "μέγιστη {v}°C", humidity: "υγρασία γύρω στο {v}%", pressureDrop: "πτώση της ατμοσφαιρικής πίεσης", rain: "βροχή", aqi: "δείκτης ποιότητας αέρα {v}", pollen: "γύρη περίπου {v} κόκκοι/m³",
  },
  zh: {
    title: "明日提醒",
    titleFor: "{name} 的明日提醒",
    prefix: "预报",
    footer: "这是你自己记录中的规律，不是预测。如果可以，明天安排得轻松一些，把对你有帮助的东西放在手边。",
    footerFor: "这是 {name} 自己记录中的规律，不是预测。也许可以问候一下。",
    tempMax: "最高气温 {v}°C", humidity: "湿度约 {v}%", pressureDrop: "气压下降", rain: "有雨", aqi: "空气质量指数 {v}", pollen: "花粉约 {v} 粒/立方米",
  },
};
type ForecastFactor = (typeof WEATHER_FACTORS)[number];

// "Forecast: a drop in air pressure", and the pattern it falls on.
function forecastParts(m: ForecastMatch, lang: Lang, units: Units) {
  const L = FORECAST[lang];
  const what = L[m.pattern.factor as ForecastFactor].replace("{v}", num(Math.round(m.value), lang));
  return { head: `${L.prefix}: ${what}`, body: patternText(m.pattern, lang, units) };
}

// "Forecast: a drop in air pressure. Pain averaged 6/10 on days with a drop in air pressure (8 days), vs 3/10 …"
export function forecastLine(m: ForecastMatch, lang: Lang, units: Units = DEFAULT_UNITS): string {
  const { head, body } = forecastParts(m, lang, units);
  return `${head}${lang === "zh" ? "。" : "."} ${body}`;
}

// The evening message. With `name`, it's the copy a care circle member gets about that person.
export function forecastText(matches: ForecastMatch[], lang: Lang, name?: string, units: Units = DEFAULT_UNITS): { text: string; title: string } {
  const L = FORECAST[lang];
  const title = name ? L.titleFor.replace("{name}", name) : L.title;
  const lines = matches.map((m) => {
    const { head, body } = forecastParts(m, lang, units);
    return `• **${head}${lang === "zh" ? "。" : "."}** ${body}`;
  });
  const footer = name ? L.footerFor.replace("{name}", name) : L.footer;
  return { title, text: [`🌦️ **${title}**`, "", ...lines, "", footer].join("\n") };
}

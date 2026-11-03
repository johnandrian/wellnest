// Proactive check-ins: spot a change in someone's Apple Health data worth asking about, compared with their own
// usual numbers, and word a gentle question. Never a diagnosis. Used by convex/checkins.ts.
import type { HealthDay, HealthMetrics } from "./health";
import type { Lang } from "./language";

export type Signal =
  | { kind: "illness"; hr: number; hrBase: number; temp: number }
  | { kind: "heart_rate"; hr: number; hrBase: number }
  | { kind: "temperature"; temp: number }
  | { kind: "breathing"; rate: number; base: number }
  | { kind: "oxygen"; spo2: number; base: number }
  | { kind: "sleep"; nights: number; avg: number }
  | { kind: "hrv"; hrv: number; base: number }
  | { kind: "activity"; steps: number; base: number };

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : undefined);
const MIN_BASELINE = 5; // days of history needed before anything counts as "unusual"

type Key = Exclude<keyof HealthMetrics, "menstrualFlow">;

// The most recent `n` days' values and the baseline (the days before them, up to two weeks), oldest first input.
function split(days: HealthDay[], key: Key, n: number) {
  const vals = days.flatMap((d) => (d.metrics[key] === undefined ? [] : [{ date: d.date, v: d.metrics[key]! }]));
  return { recent: vals.slice(-n).map((x) => x.v), base: vals.slice(0, -n).slice(-14).map((x) => x.v), last: vals.at(-1) };
}

// The strongest signal in the last few days, or null. `days` are the last ~16 days, oldest first, and must
// include yesterday or today (stale data says nothing about now).
export function detect(days: HealthDay[], today: string): Signal | null {
  const recentDates = new Set([today, shift(today, -1)]);
  if (!days.some((d) => recentDates.has(d.date))) return null;

  const hr = split(days, "restingHeartRate", 2);
  const hrUp = hr.recent.length === 2 && hr.base.length >= MIN_BASELINE ? mean(hr.recent)! - mean(hr.base)! : 0;
  const temp = split(days, "wristTempC", 1);
  const tempUp = temp.last && temp.base.length >= MIN_BASELINE ? temp.last.v - mean(temp.base)! : 0;

  if (hrUp >= 5 && tempUp >= 0.4) return { kind: "illness", hr: round(mean(hr.recent)!), hrBase: round(mean(hr.base)!), temp: round1(tempUp) };
  if (tempUp >= 0.7) return { kind: "temperature", temp: round1(tempUp) };

  const resp = split(days, "respiratoryRate", 1);
  if (resp.last && resp.base.length >= MIN_BASELINE && resp.last.v - mean(resp.base)! >= 3) {
    return { kind: "breathing", rate: round1(resp.last.v), base: round1(mean(resp.base)!) };
  }
  const spo2 = split(days, "oxygenSaturation", 1);
  if (spo2.last && spo2.base.length >= MIN_BASELINE && spo2.last.v < 94 && mean(spo2.base)! >= 95) {
    return { kind: "oxygen", spo2: round(spo2.last.v), base: round(mean(spo2.base)!) };
  }
  if (hrUp >= 7) return { kind: "heart_rate", hr: round(mean(hr.recent)!), hrBase: round(mean(hr.base)!) };

  const sleep = split(days, "sleepHours", 3);
  if (sleep.recent.length === 3 && sleep.recent.every((h) => h < 6)) return { kind: "sleep", nights: 3, avg: round1(mean(sleep.recent)!) };

  const hrv = split(days, "hrvMs", 2);
  if (hrv.recent.length === 2 && hrv.base.length >= MIN_BASELINE && mean(hrv.recent)! <= mean(hrv.base)! * 0.75) {
    return { kind: "hrv", hrv: round(mean(hrv.recent)!), base: round(mean(hrv.base)!) };
  }
  const steps = split(days, "steps", 3);
  if (steps.recent.length === 3 && steps.base.length >= MIN_BASELINE && mean(steps.base)! >= 3000 && mean(steps.recent)! < mean(steps.base)! * 0.4) {
    return { kind: "activity", steps: round(mean(steps.recent)!), base: round(mean(steps.base)!) };
  }
  return null;
}

const round = (n: number) => Math.round(n);
const round1 = (n: number) => Math.round(n * 10) / 10;

export function shift(date: string, days: number) {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

const n = (x: number, lang: Lang) => x.toLocaleString(lang === "el" ? "el-GR" : lang === "es" ? "es-ES" : lang === "zh" ? "zh-CN" : "en-US");

// The check-in message. Each one ends by inviting a reply, which the normal chat (and journal) handles.
export function checkinText(s: Signal, lang: Lang): string {
  const T: Record<Lang, Record<Signal["kind"], (s: any) => string>> = {
    en: {
      illness: (s) => `Your resting heart rate has been ${n(s.hr, lang)} bpm the last two days, up from your usual ${n(s.hrBase, lang)}, and your wrist temperature is ${n(s.temp, lang)}°C above normal. That can happen when your body is fighting something off. How are you feeling?`,
      temperature: (s) => `Your wrist temperature last night was ${n(s.temp, lang)}°C above your usual. How are you feeling today? Any chills, aches or other symptoms?`,
      breathing: (s) => `Your breathing rate during sleep was ${n(s.rate, lang)} per minute, higher than your usual ${n(s.base, lang)}. How are you feeling? Any cough or shortness of breath?`,
      oxygen: (s) => `Your blood oxygen read ${n(s.spo2, lang)}%, lower than your usual ${n(s.base, lang)}%. Watch readings can be off, but how are you feeling? If you're short of breath, please get care right away.`,
      heart_rate: (s) => `Your resting heart rate has been ${n(s.hr, lang)} bpm the last two days, up from your usual ${n(s.hrBase, lang)}. Stress, poor sleep, alcohol or an oncoming bug can all do that. How are you doing?`,
      sleep: (s) => `You've slept under 6 hours three nights in a row (about ${n(s.avg, lang)} hours on average). How are you feeling? I can share a few things that help with sleep if you'd like.`,
      hrv: (s) => `Your heart rate variability has dropped to about ${n(s.hrv, lang)} ms from your usual ${n(s.base, lang)}. That often goes with stress, short sleep or getting sick. How are you feeling?`,
      activity: (s) => `You've been a lot less active the last few days (about ${n(s.steps, lang)} steps a day, versus your usual ${n(s.base, lang)}). Just checking in: how are you feeling?`,
    },
    es: {
      illness: (s) => `Tu frecuencia cardiaca en reposo ha estado en ${n(s.hr, lang)} lpm los últimos dos días, más que tu habitual ${n(s.hrBase, lang)}, y la temperatura de tu muñeca está ${n(s.temp, lang)} °C por encima de lo normal. Puede pasar cuando el cuerpo combate algo. ¿Cómo te sientes?`,
      temperature: (s) => `Anoche la temperatura de tu muñeca estuvo ${n(s.temp, lang)} °C por encima de lo habitual. ¿Cómo te sientes hoy? ¿Escalofríos, dolores u otros síntomas?`,
      breathing: (s) => `Tu frecuencia respiratoria al dormir fue de ${n(s.rate, lang)} por minuto, más alta que tu habitual ${n(s.base, lang)}. ¿Cómo te sientes? ¿Tos o falta de aire?`,
      oxygen: (s) => `Tu oxígeno en sangre marcó ${n(s.spo2, lang)} %, más bajo que tu habitual ${n(s.base, lang)} %. El reloj puede equivocarse, pero ¿cómo te sientes? Si te falta el aire, busca atención de inmediato.`,
      heart_rate: (s) => `Tu frecuencia cardiaca en reposo ha estado en ${n(s.hr, lang)} lpm los últimos dos días, más que tu habitual ${n(s.hrBase, lang)}. El estrés, dormir mal, el alcohol o un resfriado que empieza pueden causarlo. ¿Cómo estás?`,
      sleep: (s) => `Has dormido menos de 6 horas tres noches seguidas (unas ${n(s.avg, lang)} horas de media). ¿Cómo te sientes? Si quieres, te comparto algunas cosas que ayudan a dormir.`,
      hrv: (s) => `Tu variabilidad de la frecuencia cardiaca bajó a unos ${n(s.hrv, lang)} ms desde tu habitual ${n(s.base, lang)}. Suele ir con estrés, poco sueño o enfermarse. ¿Cómo te sientes?`,
      activity: (s) => `Has estado mucho menos activo estos días (unos ${n(s.steps, lang)} pasos al día, frente a tus ${n(s.base, lang)} habituales). Solo quería saber: ¿cómo te sientes?`,
    },
    el: {
      illness: (s) => `Οι παλμοί σου σε ηρεμία είναι ${n(s.hr, lang)} bpm τις τελευταίες δύο μέρες, πάνω από τους συνηθισμένους ${n(s.hrBase, lang)}, και η θερμοκρασία στον καρπό σου είναι ${n(s.temp, lang)}°C πάνω από το κανονικό. Συμβαίνει όταν ο οργανισμός παλεύει με κάτι. Πώς νιώθεις;`,
      temperature: (s) => `Χθες βράδυ η θερμοκρασία στον καρπό σου ήταν ${n(s.temp, lang)}°C πάνω από τη συνηθισμένη. Πώς νιώθεις σήμερα; Ρίγη, πόνοι ή άλλα συμπτώματα;`,
      breathing: (s) => `Η αναπνοή σου στον ύπνο ήταν ${n(s.rate, lang)} ανά λεπτό, πιο γρήγορη από τη συνηθισμένη ${n(s.base, lang)}. Πώς νιώθεις; Βήχας ή δύσπνοια;`,
      oxygen: (s) => `Το οξυγόνο στο αίμα σου έδειξε ${n(s.spo2, lang)}%, χαμηλότερα από το συνηθισμένο ${n(s.base, lang)}%. Οι μετρήσεις του ρολογιού μπορεί να κάνουν λάθος, αλλά πώς νιώθεις; Αν σου λείπει ανάσα, ζήτησε βοήθεια αμέσως.`,
      heart_rate: (s) => `Οι παλμοί σου σε ηρεμία είναι ${n(s.hr, lang)} bpm τις τελευταίες δύο μέρες, πάνω από τους συνηθισμένους ${n(s.hrBase, lang)}. Το άγχος, ο κακός ύπνος, το αλκοόλ ή μια ίωση που ξεκινά μπορούν να το προκαλέσουν. Πώς είσαι;`,
      sleep: (s) => `Κοιμήθηκες λιγότερο από 6 ώρες τρεις νύχτες στη σειρά (περίπου ${n(s.avg, lang)} ώρες κατά μέσο όρο). Πώς νιώθεις; Αν θέλεις, σου λέω μερικά πράγματα που βοηθούν στον ύπνο.`,
      hrv: (s) => `Η μεταβλητότητα των παλμών σου έπεσε περίπου στα ${n(s.hrv, lang)} ms από τα συνηθισμένα ${n(s.base, lang)}. Συχνά συνδέεται με άγχος, λίγο ύπνο ή αρρώστια. Πώς νιώθεις;`,
      activity: (s) => `Ήσουν πολύ λιγότερο δραστήριος/α τις τελευταίες μέρες (περίπου ${n(s.steps, lang)} βήματα τη μέρα, έναντι των συνηθισμένων ${n(s.base, lang)}). Απλώς ρωτάω: πώς νιώθεις;`,
    },
    zh: {
      illness: (s) => `过去两天你的静息心率是 ${n(s.hr, lang)} 次/分，高于你平常的 ${n(s.hrBase, lang)}，手腕温度也比平时高 ${n(s.temp, lang)}°C。身体在对抗病菌时可能会这样。你感觉怎么样？`,
      temperature: (s) => `昨晚你的手腕温度比平时高 ${n(s.temp, lang)}°C。你今天感觉怎么样？有没有发冷、酸痛或其他症状？`,
      breathing: (s) => `你睡眠时的呼吸频率是每分钟 ${n(s.rate, lang)} 次，高于你平常的 ${n(s.base, lang)} 次。你感觉怎么样？有没有咳嗽或气短？`,
      oxygen: (s) => `你的血氧读数为 ${n(s.spo2, lang)}%，低于你平常的 ${n(s.base, lang)}%。手表读数可能有误差，但你感觉怎么样？如果呼吸困难，请立即就医。`,
      heart_rate: (s) => `过去两天你的静息心率是 ${n(s.hr, lang)} 次/分，高于你平常的 ${n(s.hrBase, lang)}。压力、睡眠不好、饮酒或即将感冒都可能导致这种情况。你还好吗？`,
      sleep: (s) => `你已经连续三晚睡眠不足 6 小时（平均约 ${n(s.avg, lang)} 小时）。你感觉怎么样？如果需要，我可以分享一些有助于睡眠的方法。`,
      hrv: (s) => `你的心率变异性已降至约 ${n(s.hrv, lang)} 毫秒，而平常是 ${n(s.base, lang)} 毫秒。这通常与压力、睡眠不足或生病有关。你感觉怎么样？`,
      activity: (s) => `最近几天你的活动量少了很多（每天约 ${n(s.steps, lang)} 步，平常是 ${n(s.base, lang)} 步）。想问问你：感觉怎么样？`,
    },
  };
  return `🩺 ${T[lang][s.kind](s)}`;
}

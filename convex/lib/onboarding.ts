// Account setup (convex/onboarding.ts): the choices it offers, how they're stored, the line the model reads about
// the user, and the welcome message at the end, in the user's language.
import { v } from "convex/values";
import type { Lang } from "./language";

export const FOCUS = ["symptoms", "pain", "asthma", "seizures", "diabetes", "medications", "mood", "wellness", "caregiver"] as const;
export type Focus = (typeof FOCUS)[number];
export const focus = v.union(...FOCUS.map((f) => v.literal(f)));

export const AGE_RANGES = ["under_18", "18_29", "30_44", "45_64", "65_plus"] as const;
export const ageRange = v.union(...AGE_RANGES.map((a) => v.literal(a)));
export const SEXES = ["female", "male", "other", "unspecified"] as const;
export const sex = v.union(...SEXES.map((s) => v.literal(s)));

export const profile = v.object({
  name: v.optional(v.string()),
  ageRange: v.optional(ageRange),
  sex: v.optional(sex),
});

const FOCUS_EN: Record<Focus, string> = {
  symptoms: "tracking symptoms",
  pain: "chronic pain / CRPS",
  asthma: "asthma",
  seizures: "epilepsy / seizures",
  diabetes: "diabetes / blood sugar",
  medications: "managing medications",
  mood: "mood and sleep",
  wellness: "general wellness",
  caregiver: "caring for someone else",
};

// For the model's system prompt; "" when nothing is known.
export function aboutUserText(p: { name?: string; ageRange?: string; sex?: string } | undefined, focusList: string[] | undefined): string {
  const parts = [
    p?.name && `Their name is ${p.name}; use it now and then, not in every reply.`,
    p?.ageRange && `Age range: ${p.ageRange.replace("_plus", "+").replace("under_", "under ").replace("_", "-")}.`,
    p?.sex && p.sex !== "unspecified" && `Sex: ${p.sex}.`,
    focusList?.length && `They use Wellnest mainly for: ${focusList.map((f) => FOCUS_EN[f as Focus] ?? f).join(", ")}.`,
    focusList?.includes("caregiver") && "They may be asking about someone they care for; check who a symptom is about when it's unclear.",
  ].filter(Boolean);
  return parts.length ? `About the user (from their account setup):\n${parts.join(" ")}` : "";
}

// How setup answers are saved as facts ("What Wellnest knows about me").
export const FACT_PREFIX: Record<Lang, { condition: string; allergy: string }> = {
  en: { condition: "Condition", allergy: "Allergy" },
  es: { condition: "Afección", allergy: "Alergia" },
  el: { condition: "Πάθηση", allergy: "Αλλεργία" },
  zh: { condition: "疾病", allergy: "过敏" },
};

// One tip per focus for the welcome message.
const TIPS: Record<Lang, Record<Focus, string>> = {
  en: {
    symptoms: "Tell me how a symptom is (\"my headache's a 6\") and I'll log it in your journal.",
    pain: "Rate your pain in chat or in Health tools → Journal → Pain; I'll look for what makes it worse.",
    asthma: "Log peak flow and reliever puffs; I'll watch air quality and pollen for you.",
    seizures: "Log a seizure with how long it lasted and what came before; set up your emergency plan in Health tools → Care.",
    diabetes: "Tell me a reading (\"fasting 128\") or connect your sensor through your phone's health app; I'll look for what moves your glucose.",
    medications: "Your reminders come with Taken / Skip buttons; tell me about side effects any time.",
    mood: "Answer the daily check-in (mood, energy, sleep) and I'll spot what helps.",
    wellness: "Ask me anything about sleep, food, movement or stress.",
    caregiver: "When you ask about someone else, tell me who it is so I keep things straight.",
  },
  es: {
    symptoms: "Cuéntame cómo va un síntoma (\"mi dolor de cabeza está en 6\") y lo anoto en tu diario.",
    pain: "Puntúa tu dolor en el chat o en Herramientas de salud → Diario → Dolor; buscaré qué lo empeora.",
    asthma: "Anota tu flujo máximo y las inhalaciones de rescate; vigilaré la calidad del aire y el polen.",
    seizures: "Anota cada crisis con su duración y lo que pasó antes; prepara tu plan de emergencia en Herramientas de salud → Atención.",
    diabetes: "Dime una lectura («en ayunas 128») o conecta tu sensor a través de la app de salud del teléfono; buscaré qué mueve tu glucosa.",
    medications: "Tus recordatorios traen botones Tomada / Omitir; cuéntame cualquier efecto secundario.",
    mood: "Responde el control diario (ánimo, energía, sueño) y veré qué te ayuda.",
    wellness: "Pregúntame lo que quieras sobre sueño, comida, ejercicio o estrés.",
    caregiver: "Cuando preguntes por otra persona, dime quién es para no mezclar las cosas.",
  },
  el: {
    symptoms: "Πες μου πώς πάει ένα σύμπτωμα («ο πονοκέφαλος είναι στο 6») και θα το καταγράψω στο ημερολόγιό σου.",
    pain: "Βαθμολόγησε τον πόνο σου στη συνομιλία ή στα Εργαλεία υγείας → Ημερολόγιο → Πόνος· θα ψάξω τι τον χειροτερεύει.",
    asthma: "Κατέγραψε τη μέγιστη ροή και τις εισπνοές ανακουφιστικού· θα παρακολουθώ την ποιότητα του αέρα και τη γύρη.",
    seizures: "Κατέγραψε κάθε κρίση με τη διάρκεια και τι προηγήθηκε· φτιάξε το σχέδιο έκτακτης ανάγκης στα Εργαλεία υγείας → Φροντίδα.",
    diabetes: "Πες μου μια μέτρηση («νηστεία 128») ή σύνδεσε τον αισθητήρα σου μέσω της εφαρμογής υγείας του κινητού· θα ψάξω τι επηρεάζει τη γλυκόζη σου.",
    medications: "Οι υπενθυμίσεις έχουν κουμπιά Το πήρα / Παράλειψη· πες μου για οποιαδήποτε παρενέργεια.",
    mood: "Απάντα στο καθημερινό check-in (διάθεση, ενέργεια, ύπνος) και θα δω τι σε βοηθά.",
    wellness: "Ρώτα με ό,τι θέλεις για ύπνο, διατροφή, κίνηση ή άγχος.",
    caregiver: "Όταν ρωτάς για κάποιον άλλο, πες μου ποιος είναι για να μην τα μπερδεύω.",
  },
  zh: {
    symptoms: "告诉我某个症状的情况（“我的头痛有 6 分”），我会把它记在你的日志里。",
    pain: "在聊天中或在 健康工具 → 日志 → 疼痛 中给疼痛打分；我会找出是什么让它加重。",
    asthma: "记录峰流速和缓解药吸入次数；我会帮你留意空气质量和花粉。",
    seizures: "记录每次发作的时长和发作前的情况；在 健康工具 → 就医 中设置你的紧急预案。",
    diabetes: "告诉我一次读数（“空腹 7.1”），或通过手机的健康应用连接你的血糖仪；我会找出影响你血糖的因素。",
    medications: "你的提醒带有“已服用 / 跳过”按钮；有任何副作用随时告诉我。",
    mood: "回答每日签到（心情、精力、睡眠），我会找出对你有帮助的事情。",
    wellness: "关于睡眠、饮食、运动或压力，随时问我。",
    caregiver: "当你询问其他人的情况时，请告诉我是谁，这样我不会弄混。",
  },
};

export function welcomeText(lang: Lang, name: string | undefined, focusList: Focus[]): string {
  const hi = {
    en: name ? `Welcome, ${name}! You're all set.` : "Welcome! You're all set.",
    es: name ? `¡Hola, ${name}! Ya está todo listo.` : "¡Hola! Ya está todo listo.",
    el: name ? `Καλώς ήρθες, ${name}! Όλα είναι έτοιμα.` : "Καλώς ήρθες! Όλα είναι έτοιμα.",
    zh: name ? `欢迎，${name}！一切都设置好了。` : "欢迎！一切都设置好了。",
  }[lang];
  const close = {
    en: "You can change any of this in Settings. How are you feeling today?",
    es: "Puedes cambiar todo esto en Ajustes. ¿Cómo te sientes hoy?",
    el: "Μπορείς να τα αλλάξεις όλα από τις Ρυθμίσεις. Πώς νιώθεις σήμερα;",
    zh: "你可以随时在设置中修改这些内容。你今天感觉怎么样？",
  }[lang];
  const tips = (focusList.length ? focusList : (["symptoms", "wellness"] as Focus[])).slice(0, 3).map((f) => `• ${TIPS[lang][f]}`);
  return [`👋 ${hi}`, "", ...tips, "", close].join("\n");
}

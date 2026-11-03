// Account setup (convex/onboarding.ts): the choices it offers, how they're stored, the line the model reads about
// the user, and the welcome message at the end, in the user's language.
import { v } from "convex/values";
import type { Lang } from "./language";

export const FOCUS = ["symptoms", "pain", "asthma", "seizures", "medications", "mood", "wellness", "caregiver"] as const;
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
};

// One tip per focus for the welcome message.
const TIPS: Record<Lang, Record<Focus, string>> = {
  en: {
    symptoms: "Tell me how a symptom is (\"my headache's a 6\") and I'll log it in your journal.",
    pain: "Rate your pain in chat or in Health tools → Journal → Pain; I'll look for what makes it worse.",
    asthma: "Log peak flow and reliever puffs; I'll watch air quality and pollen for you.",
    seizures: "Log a seizure with how long it lasted and what came before; set up your emergency plan in Health tools → Care.",
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
    medications: "Οι υπενθυμίσεις έχουν κουμπιά Το πήρα / Παράλειψη· πες μου για οποιαδήποτε παρενέργεια.",
    mood: "Απάντα στο καθημερινό check-in (διάθεση, ενέργεια, ύπνος) και θα δω τι σε βοηθά.",
    wellness: "Ρώτα με ό,τι θέλεις για ύπνο, διατροφή, κίνηση ή άγχος.",
    caregiver: "Όταν ρωτάς για κάποιον άλλο, πες μου ποιος είναι για να μην τα μπερδεύω.",
  },
};

export function welcomeText(lang: Lang, name: string | undefined, focusList: Focus[]): string {
  const hi = {
    en: name ? `Welcome, ${name}! You're all set.` : "Welcome! You're all set.",
    es: name ? `¡Hola, ${name}! Ya está todo listo.` : "¡Hola! Ya está todo listo.",
    el: name ? `Καλώς ήρθες, ${name}! Όλα είναι έτοιμα.` : "Καλώς ήρθες! Όλα είναι έτοιμα.",
  }[lang];
  const close = {
    en: "You can change any of this in Settings. How are you feeling today?",
    es: "Puedes cambiar todo esto en Ajustes. ¿Cómo te sientes hoy?",
    el: "Μπορείς να τα αλλάξεις όλα από τις Ρυθμίσεις. Πώς νιώθεις σήμερα;",
  }[lang];
  const tips = (focusList.length ? focusList : (["symptoms", "wellness"] as Focus[])).slice(0, 3).map((f) => `• ${TIPS[lang][f]}`);
  return [`👋 ${hi}`, "", ...tips, "", close].join("\n");
}

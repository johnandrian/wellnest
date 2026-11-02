// Reply and voice languages. The user picks one in Settings (or /language on Telegram); English when unset.
// Replies, speech (Cartesia STT and Sonic), reminders, visit summaries and a few fixed messages follow it.
import { v } from "convex/values";

export const language = v.union(v.literal("en"), v.literal("es"), v.literal("el"));
export type Lang = "en" | "es" | "el";

export const LANGUAGES: Record<Lang, { english: string; native: string; locale: string }> = {
  en: { english: "English", native: "English", locale: "en-US" },
  es: { english: "Spanish", native: "Español", locale: "es-US" },
  el: { english: "Greek", native: "Ελληνικά", locale: "el-GR" },
};

export const langOf = (user: { language?: Lang } | null | undefined): Lang => user?.language ?? "en";

export function isLang(s: string | undefined): s is Lang {
  return s === "en" || s === "es" || s === "el";
}

// The system prompt line for the core model; nothing for English.
export function languagePrompt(lang: Lang): string | null {
  if (lang === "en") return null;
  const { english, native } = LANGUAGES[lang];
  return (
    `The user's language is ${english} (${native}). Reply in ${english} unless they write to you in another language. ` +
    `Use everyday words; when a medical term matters (a diagnosis, a medicine), give the common ${english} name.`
  );
}

// Sonic voices: one voice speaks every language, unless a language has its own (CARTESIA_VOICE_ID_ES, _EL).
export function voiceFor(lang: Lang, fallback: string): string {
  return (lang !== "en" && process.env[`CARTESIA_VOICE_ID_${lang.toUpperCase()}`]) || fallback;
}

const TEXT = {
  limit: {
    en: (n: number) => `You've reached today's limit of ${n} messages. Please try again tomorrow. If this is an emergency, call 911.`,
    es: (n: number) => `Llegaste al límite de ${n} mensajes de hoy. Inténtalo de nuevo mañana. Si es una emergencia, llama al 911.`,
    el: (n: number) => `Έφτασες το σημερινό όριο των ${n} μηνυμάτων. Δοκίμασε ξανά αύριο. Σε επείγουσα περίπτωση, κάλεσε το 112.`,
  },
  failed: {
    en: () => "Sorry, something went wrong on my end. Please try again in a moment.",
    es: () => "Lo siento, algo falló de mi lado. Inténtalo de nuevo en un momento.",
    el: () => "Συγγνώμη, κάτι πήγε στραβά από τη μεριά μου. Δοκίμασε ξανά σε λίγο.",
  },
  reminder: {
    en: (name: string, dose: string, time: string) => `💊 Time for your **${name}**${dose ? ` (${dose})` : ""}. Due ${time}.`,
    es: (name: string, dose: string, time: string) => `💊 Es hora de tu **${name}**${dose ? ` (${dose})` : ""}. Toca a las ${time}.`,
    el: (name: string, dose: string, time: string) => `💊 Ώρα για το **${name}**${dose ? ` (${dose})` : ""}. Στις ${time}.`,
  },
  visitReady: {
    en: () => "**Your visit summary is ready.** Open it with the clipboard button at the top to read, share or print it.",
    es: () => "**Tu resumen para la consulta está listo.** Ábrelo con el botón del portapapeles arriba para leerlo, compartirlo o imprimirlo.",
    el: () => "**Η σύνοψη για το ραντεβού σου είναι έτοιμη.** Άνοιξέ την με το κουμπί του πρόχειρου επάνω για να τη διαβάσεις, να τη μοιραστείς ή να την εκτυπώσεις.",
  },
  visitSuggested: {
    en: (provider: string, times: string) => `🩺 This is worth a quick video visit with a clinician. ${provider} has: ${times}. Pick a time below; nothing is booked until you confirm.`,
    es: (provider: string, times: string) => `🩺 Vale la pena una videoconsulta breve con un profesional. ${provider} tiene: ${times}. Elige una hora abajo; no se reserva nada hasta que confirmes.`,
    el: (provider: string, times: string) => `🩺 Αξίζει μια σύντομη βιντεοκλήση με γιατρό. Το ${provider} έχει: ${times}. Διάλεξε ώρα παρακάτω· τίποτα δεν κλείνεται μέχρι να επιβεβαιώσεις.`,
  },
  visitNoSlots: {
    en: () => "I couldn't find video visit times right now. If you need care today, the Care tab lists urgent care near you; call 911 in an emergency.",
    es: () => "Ahora no encontré horarios para videoconsulta. Si necesitas atención hoy, la pestaña Atención muestra urgencias cerca; en una emergencia llama al 911.",
    el: () => "Δεν βρήκα ώρες για βιντεοκλήση αυτή τη στιγμή. Αν χρειάζεσαι φροντίδα σήμερα, η καρτέλα Φροντίδα δείχνει επείγοντα κοντά σου· σε επείγουσα περίπτωση κάλεσε το 112.",
  },
  visitSuggestedTitle: { en: () => "Video visit suggested", es: () => "Videoconsulta sugerida", el: () => "Προτεινόμενη βιντεοκλήση" },
  visitSuggestedBody: {
    en: (time: string) => `First available at ${time}. Open Wellnest to pick a time.`,
    es: (time: string) => `La primera a las ${time}. Abre Wellnest para elegir una hora.`,
    el: (time: string) => `Η πρώτη στις ${time}. Άνοιξε το Wellnest για να διαλέξεις ώρα.`,
  },
  visitBookedTitle: { en: () => "Video visit booked", es: () => "Videoconsulta reservada", el: () => "Η βιντεοκλήση κλείστηκε" },
  visitBookedBody: {
    en: (who: string, time: string) => `${who} at ${time}. We'll remind you 15 minutes before.`,
    es: (who: string, time: string) => `${who} a las ${time}. Te avisaremos 15 minutos antes.`,
    el: (who: string, time: string) => `${who} στις ${time}. Θα σου θυμίσουμε 15 λεπτά πριν.`,
  },
  visitSoonTitle: { en: () => "Your video visit starts soon", es: () => "Tu videoconsulta empieza pronto", el: () => "Η βιντεοκλήση σου ξεκινά σύντομα" },
  visitSoonBody: {
    en: () => "In 15 minutes. Open Wellnest and tap Join.",
    es: () => "En 15 minutos. Abre Wellnest y toca Unirse.",
    el: () => "Σε 15 λεπτά. Άνοιξε το Wellnest και πάτα Σύνδεση.",
  },
  visitFailedTitle: { en: () => "Couldn't book the visit", es: () => "No se pudo reservar", el: () => "Δεν έγινε η κράτηση" },
  visitFailedBody: {
    en: () => "That time may have been taken. Ask Wellnest for new times.",
    es: () => "Puede que esa hora ya no esté libre. Pide nuevos horarios a Wellnest.",
    el: () => "Ίσως η ώρα δεν είναι πια διαθέσιμη. Ζήτα νέες ώρες από το Wellnest.",
  },
  visitCancelledTitle: { en: () => "Video visit cancelled", es: () => "Videoconsulta cancelada", el: () => "Η βιντεοκλήση ακυρώθηκε" },
  visitCancelledBody: { en: () => "It's off your schedule.", es: () => "Ya no está en tu agenda.", el: () => "Αφαιρέθηκε από το πρόγραμμά σου." },
  visitCancelFailedTitle: { en: () => "Couldn't cancel yet", es: () => "Aún no se pudo cancelar", el: () => "Δεν ακυρώθηκε ακόμη" },
  visitCancelFailedBody: {
    en: () => "The visit is still booked. Try again, or contact the provider.",
    es: () => "La consulta sigue reservada. Inténtalo de nuevo o contacta al proveedor.",
    el: () => "Η επίσκεψη είναι ακόμη κλεισμένη. Δοκίμασε ξανά ή επικοινώνησε με τον πάροχο.",
  },
  languageSet: {
    en: () => "Okay, I'll reply in English.",
    es: () => "De acuerdo, te responderé en español.",
    el: () => "Εντάξει, θα σου απαντώ στα ελληνικά.",
  },
} as const;

type Texts = typeof TEXT;
export function t<K extends keyof Texts>(lang: Lang, key: K, ...args: Parameters<Texts[K]["en"]>): string {
  return (TEXT[key][lang] as (...a: Parameters<Texts[K]["en"]>) => string)(...args);
}

// "8:00 PM" / "20:00" in the user's language and zone.
export function timeText(at: number, timeZone: string, lang: Lang) {
  try {
    return new Intl.DateTimeFormat(LANGUAGES[lang].locale, { timeZone, hour: "numeric", minute: "2-digit" }).format(new Date(at));
  } catch {
    return new Date(at).toISOString().slice(11, 16) + " UTC";
  }
}

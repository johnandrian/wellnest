// The chat screen's own words in the user's language (convex/lib/language.ts). Panels stay in English for now.
export type Lang = "en" | "es" | "el";

export const LANGUAGE_NAMES: Record<Lang, string> = { en: "English", es: "Español", el: "Ελληνικά" };

const STRINGS = {
  en: {
    starters: [
      "I have a mild headache, what should I do?",
      "My allergies are acting up today",
      "How much water should I drink a day?",
      "I just got my period and the cramps are bad",
    ],
    welcome: "How are you feeling?",
    introVoice: "Tap the mic and just talk, or type below.",
    introText: "Type a question below.",
    disclaimer: "I'm not a doctor; in an emergency call 911.",
    subtitleVoice: "Voice on · talk or type",
    subtitleText: "Text mode",
    notDoctor: "not a doctor",
    placeholderVoice: "Type or tap the mic",
    placeholderText: "Type a message",
    placeholderPhoto: "Add a question about the photo",
    speaking: "Speaking · tap to stop",
    taken: "Taken",
    skip: "Skip",
    listening: "Listening… tap the red button when you're done.",
    transcribing: "Transcribing…",
  },
  es: {
    starters: [
      "Tengo un dolor de cabeza leve, ¿qué hago?",
      "Hoy tengo mucha alergia",
      "¿Cuánta agua debería tomar al día?",
      "Me bajó la regla y tengo cólicos fuertes",
    ],
    welcome: "¿Cómo te sientes?",
    introVoice: "Toca el micrófono y habla, o escribe abajo.",
    introText: "Escribe tu pregunta abajo.",
    disclaimer: "No soy médico; en una emergencia llama al 911.",
    subtitleVoice: "Voz activada · habla o escribe",
    subtitleText: "Modo texto",
    notDoctor: "no soy médico",
    placeholderVoice: "Escribe o toca el micrófono",
    placeholderText: "Escribe un mensaje",
    placeholderPhoto: "Pregunta algo sobre la foto",
    speaking: "Hablando · toca para parar",
    taken: "Tomada",
    skip: "Omitir",
    listening: "Escuchando… toca el botón rojo cuando termines.",
    transcribing: "Transcribiendo…",
  },
  el: {
    starters: [
      "Έχω έναν ελαφρύ πονοκέφαλο, τι να κάνω;",
      "Η αλλεργία μου είναι έντονη σήμερα",
      "Πόσο νερό πρέπει να πίνω την ημέρα;",
      "Μου ήρθε περίοδος και έχω δυνατούς πόνους",
    ],
    welcome: "Πώς νιώθεις;",
    introVoice: "Πάτα το μικρόφωνο και μίλα, ή γράψε από κάτω.",
    introText: "Γράψε την ερώτησή σου από κάτω.",
    disclaimer: "Δεν είμαι γιατρός· σε επείγουσα περίπτωση κάλεσε το 112.",
    subtitleVoice: "Φωνή ενεργή · μίλα ή γράψε",
    subtitleText: "Λειτουργία κειμένου",
    notDoctor: "δεν είμαι γιατρός",
    placeholderVoice: "Γράψε ή πάτα το μικρόφωνο",
    placeholderText: "Γράψε ένα μήνυμα",
    placeholderPhoto: "Ρώτα κάτι για τη φωτογραφία",
    speaking: "Μιλάω · πάτα για διακοπή",
    taken: "Το πήρα",
    skip: "Παράλειψη",
    listening: "Ακούω… πάτα το κόκκινο κουμπί όταν τελειώσεις.",
    transcribing: "Μεταγραφή…",
  },
} satisfies Record<Lang, Record<string, string | string[]>>;

export type Strings = (typeof STRINGS)["en"];

export function strings(lang: string | undefined): Strings {
  return STRINGS[(lang as Lang) in STRINGS ? (lang as Lang) : "en"];
}

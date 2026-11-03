// Reply and voice languages. The user picks one in Settings (or /language on Telegram); English when unset.
// Replies, speech (Cartesia STT and Sonic), reminders, visit summaries and a few fixed messages follow it.
import { v } from "convex/values";

export const language = v.union(v.literal("en"), v.literal("es"), v.literal("el"), v.literal("zh"));
export type Lang = "en" | "es" | "el" | "zh";

export const LANGUAGES: Record<Lang, { english: string; native: string; locale: string }> = {
  en: { english: "English", native: "English", locale: "en-US" },
  es: { english: "Spanish", native: "Español", locale: "es-US" },
  el: { english: "Greek", native: "Ελληνικά", locale: "el-GR" },
  zh: { english: "Simplified Chinese", native: "简体中文", locale: "zh-CN" },
};

export const langOf = (user: { language?: Lang } | null | undefined): Lang => user?.language ?? "en";

export function isLang(s: string | undefined): s is Lang {
  return s === "en" || s === "es" || s === "el" || s === "zh";
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

// Sonic voices: one voice speaks every language, unless a language has its own (CARTESIA_VOICE_ID_ES, _EL, _ZH).
export function voiceFor(lang: Lang, fallback: string): string {
  return (lang !== "en" && process.env[`CARTESIA_VOICE_ID_${lang.toUpperCase()}`]) || fallback;
}

const TEXT = {
  limit: {
    en: (n: number) => `You've reached today's limit of ${n} messages. Please try again tomorrow. If this is an emergency, call 911.`,
    es: (n: number) => `Llegaste al límite de ${n} mensajes de hoy. Inténtalo de nuevo mañana. Si es una emergencia, llama al 911.`,
    el: (n: number) => `Έφτασες το σημερινό όριο των ${n} μηνυμάτων. Δοκίμασε ξανά αύριο. Σε επείγουσα περίπτωση, κάλεσε το 112.`,
    zh: (n: number) => `今天的 ${n} 条消息已用完，请明天再试。如有紧急情况，请拨打 911。`,
  },
  failed: {
    en: () => "Sorry, something went wrong on my end. Please try again in a moment.",
    es: () => "Lo siento, algo falló de mi lado. Inténtalo de nuevo en un momento.",
    el: () => "Συγγνώμη, κάτι πήγε στραβά από τη μεριά μου. Δοκίμασε ξανά σε λίγο.",
    zh: () => "抱歉，我这边出了点问题。请稍后再试。",
  },
  reminder: {
    en: (name: string, dose: string, time: string) => `💊 Time for your **${name}**${dose ? ` (${dose})` : ""}. Due ${time}.`,
    es: (name: string, dose: string, time: string) => `💊 Es hora de tu **${name}**${dose ? ` (${dose})` : ""}. Toca a las ${time}.`,
    el: (name: string, dose: string, time: string) => `💊 Ώρα για το **${name}**${dose ? ` (${dose})` : ""}. Στις ${time}.`,
    zh: (name: string, dose: string, time: string) => `💊 该服用 **${name}**${dose ? `（${dose}）` : ""}了。时间：${time}。`,
  },
  visitReady: {
    en: () => "**Your visit summary is ready.** Open it with the clipboard button at the top to read, share or print it.",
    es: () => "**Tu resumen para la consulta está listo.** Ábrelo con el botón del portapapeles arriba para leerlo, compartirlo o imprimirlo.",
    el: () => "**Η σύνοψη για το ραντεβού σου είναι έτοιμη.** Άνοιξέ την με το κουμπί του πρόχειρου επάνω για να τη διαβάσεις, να τη μοιραστείς ή να την εκτυπώσεις.",
    zh: () => "**你的就诊摘要已准备好。** 点击顶部的剪贴板按钮即可查看、分享或打印。",
  },
  visitSuggested: {
    en: (provider: string, times: string) => `🩺 This is worth a quick video visit with a clinician. ${provider} has: ${times}. Pick a time below; nothing is booked until you confirm.`,
    es: (provider: string, times: string) => `🩺 Vale la pena una videoconsulta breve con un profesional. ${provider} tiene: ${times}. Elige una hora abajo; no se reserva nada hasta que confirmes.`,
    el: (provider: string, times: string) => `🩺 Αξίζει μια σύντομη βιντεοκλήση με γιατρό. Το ${provider} έχει: ${times}. Διάλεξε ώρα παρακάτω· τίποτα δεν κλείνεται μέχρι να επιβεβαιώσεις.`,
    zh: (provider: string, times: string) => `🩺 建议你和医生进行一次简短的视频问诊。${provider} 可预约的时间：${times}。请在下方选择时间；在你确认之前不会预约任何内容。`,
  },
  visitNoSlots: {
    en: () => "I couldn't find video visit times right now. If you need care today, the Care tab lists urgent care near you; call 911 in an emergency.",
    es: () => "Ahora no encontré horarios para videoconsulta. Si necesitas atención hoy, la pestaña Atención muestra urgencias cerca; en una emergencia llama al 911.",
    el: () => "Δεν βρήκα ώρες για βιντεοκλήση αυτή τη στιγμή. Αν χρειάζεσαι φροντίδα σήμερα, η καρτέλα Φροντίδα δείχνει επείγοντα κοντά σου· σε επείγουσα περίπτωση κάλεσε το 112.",
    zh: () => "目前找不到可用的视频问诊时间。如果你今天需要就医，“就医”页面会列出附近的急诊诊所；紧急情况请拨打 911。",
  },
  visitSuggestedTitle: { en: () => "Video visit suggested", es: () => "Videoconsulta sugerida", el: () => "Προτεινόμενη βιντεοκλήση", zh: () => "建议视频问诊" },
  visitSuggestedBody: {
    en: (time: string) => `First available at ${time}. Open Wellnest to pick a time.`,
    es: (time: string) => `La primera a las ${time}. Abre Wellnest para elegir una hora.`,
    el: (time: string) => `Η πρώτη στις ${time}. Άνοιξε το Wellnest για να διαλέξεις ώρα.`,
    zh: (time: string) => `最早可约 ${time}。打开 Wellnest 选择时间。`,
  },
  visitBookedTitle: { en: () => "Video visit booked", es: () => "Videoconsulta reservada", el: () => "Η βιντεοκλήση κλείστηκε", zh: () => "视频问诊已预约" },
  visitBookedBody: {
    en: (who: string, time: string) => `${who} at ${time}. We'll remind you 15 minutes before.`,
    es: (who: string, time: string) => `${who} a las ${time}. Te avisaremos 15 minutos antes.`,
    el: (who: string, time: string) => `${who} στις ${time}. Θα σου θυμίσουμε 15 λεπτά πριν.`,
    zh: (who: string, time: string) => `${who}，${time}。我们会在开始前 15 分钟提醒你。`,
  },
  visitSoonTitle: { en: () => "Your video visit starts soon", es: () => "Tu videoconsulta empieza pronto", el: () => "Η βιντεοκλήση σου ξεκινά σύντομα", zh: () => "你的视频问诊即将开始" },
  visitSoonBody: {
    en: () => "In 15 minutes. Open Wellnest and tap Join.",
    es: () => "En 15 minutos. Abre Wellnest y toca Unirse.",
    el: () => "Σε 15 λεπτά. Άνοιξε το Wellnest και πάτα Σύνδεση.",
    zh: () => "还有 15 分钟。打开 Wellnest 并点击“加入”。",
  },
  visitFailedTitle: { en: () => "Couldn't book the visit", es: () => "No se pudo reservar", el: () => "Δεν έγινε η κράτηση", zh: () => "无法预约" },
  visitFailedBody: {
    en: () => "That time may have been taken. Ask Wellnest for new times.",
    es: () => "Puede que esa hora ya no esté libre. Pide nuevos horarios a Wellnest.",
    el: () => "Ίσως η ώρα δεν είναι πια διαθέσιμη. Ζήτα νέες ώρες από το Wellnest.",
    zh: () => "该时间可能已被预约。请让 Wellnest 重新查找时间。",
  },
  visitCancelledTitle: { en: () => "Video visit cancelled", es: () => "Videoconsulta cancelada", el: () => "Η βιντεοκλήση ακυρώθηκε", zh: () => "视频问诊已取消" },
  visitCancelledBody: { en: () => "It's off your schedule.", es: () => "Ya no está en tu agenda.", el: () => "Αφαιρέθηκε από το πρόγραμμά σου.", zh: () => "已从你的日程中移除。" },
  visitCancelFailedTitle: { en: () => "Couldn't cancel yet", es: () => "Aún no se pudo cancelar", el: () => "Δεν ακυρώθηκε ακόμη", zh: () => "暂时无法取消" },
  visitCancelFailedBody: {
    en: () => "The visit is still booked. Try again, or contact the provider.",
    es: () => "La consulta sigue reservada. Inténtalo de nuevo o contacta al proveedor.",
    el: () => "Η επίσκεψη είναι ακόμη κλεισμένη. Δοκίμασε ξανά ή επικοινώνησε με τον πάροχο.",
    zh: () => "问诊仍处于预约状态。请重试，或联系服务提供方。",
  },
  lowSupply: {
    en: (name: string, days: number) => `💊 You're running low on **${name}**: about ${days} day${days === 1 ? "" : "s"} left. Time to order a refill.`,
    es: (name: string, days: number) => `💊 Te queda poco **${name}**: unos ${days} día${days === 1 ? "" : "s"}. Es hora de pedir más.`,
    el: (name: string, days: number) => `💊 Σου τελειώνει το **${name}**: περίπου ${days} ${days === 1 ? "μέρα" : "μέρες"} ακόμη. Ώρα για ανανέωση.`,
    zh: (name: string, days: number) => `💊 你的 **${name}** 快用完了：大约还剩 ${days} 天。是时候续药了。`,
  },
  visitReminderTitle: {
    en: (title: string) => `Appointment soon: ${title}`,
    es: (title: string) => `Cita pronto: ${title}`,
    el: (title: string) => `Ραντεβού σύντομα: ${title}`,
    zh: (title: string) => `即将就诊：${title}`,
  },
  visitReminderBody: {
    en: (time: string, where: string) => `At ${time}${where ? ` · ${where}` : ""}. Your questions are in the Visits tab.`,
    es: (time: string, where: string) => `A las ${time}${where ? ` · ${where}` : ""}. Tus preguntas están en la pestaña Citas.`,
    el: (time: string, where: string) => `Στις ${time}${where ? ` · ${where}` : ""}. Οι ερωτήσεις σου είναι στην καρτέλα Ραντεβού.`,
    zh: (time: string, where: string) => `${time}${where ? ` · ${where}` : ""}。你的问题在“就诊”页面中。`,
  },
  languageSet: {
    en: () => "Okay, I'll reply in English.",
    es: () => "De acuerdo, te responderé en español.",
    el: () => "Εντάξει, θα σου απαντώ στα ελληνικά.",
    zh: () => "好的，我会用中文回复你。",
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

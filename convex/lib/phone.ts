// A phone number as people type it ("+1 (555) 010-0100 ext. 2", "555.010.0100") turned into a tel: link that dials:
// digits only, a + kept only at the start, and an extension sent after a pause (","). Used by the app's Call buttons,
// the carer view, the chat's place links, and reports.
export function telUrl(phone: string): string {
  const [main, ext] = phone.trim().split(/\s*(?:ext\.?|extension|x|#)\s*/i);
  const digits = (main ?? "").replace(/[^\d+]/g, "").replace(/(?!^)\+/g, "");
  const extDigits = (ext ?? "").replace(/\D/g, "");
  return `tel:${digits}${extDigits ? `,${extDigits}` : ""}`;
}

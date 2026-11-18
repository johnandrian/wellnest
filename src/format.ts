// Dates, times, and distances in the app's language (s.locale), not the phone's, so a Spanish account on an English
// phone reads Spanish dates everywhere. Calendar days ("2026-11-05") are read at noon so no time zone moves them.
import type { Strings } from "./i18n";

type Opts = Intl.DateTimeFormatOptions;

const asDate = (at: number | string) => (typeof at === "string" ? new Date(`${at}T12:00:00`) : new Date(at));

export const formatDate = (at: number | string, s: Strings, opts: Opts = { month: "short", day: "numeric" }) => asDate(at).toLocaleDateString(s.locale, opts);
export const formatTime = (at: number, s: Strings) => new Date(at).toLocaleTimeString(s.locale, { hour: "numeric", minute: "2-digit" });
export const formatDateTime = (at: number, s: Strings, opts: Opts = { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) =>
  new Date(at).toLocaleString(s.locale, opts);

// A chart's first and last day: "Nov 5" in English, "5 nov" in Spanish.
export const axisDay = (date: string, s: Strings) => formatDate(date, s);

// Miles for people who chose pounds, kilometers otherwise: one decimal under 10, whole numbers above.
export function formatDistance(km: number, imperial: boolean) {
  const n = imperial ? km / 1.609344 : km;
  return `${n < 10 ? n.toFixed(1) : Math.round(n)} ${imperial ? "mi" : "km"}`;
}

// The emergency number to call, from the user's country rather than the app's language: a Spanish speaker in the US
// still needs 911. The country is where their saved location is (convex/lib/places.ts), else the phone's or browser's
// region setting, else a guess from the language. 112 works from any mobile phone in Europe and in many other places.
import { useQuery } from "convex/react";
import { api } from "../convex/_generated/api";
import type { Strings } from "./i18n";

const NUMBERS: Record<string, string> = {
  US: "911", CA: "911", MX: "911", PR: "911", GU: "911", VI: "911", AS: "911", MP: "911",
  AR: "911", CR: "911", PA: "911", PY: "911", UY: "911", SV: "911", HN: "911", DO: "911", PH: "911", CO: "123", PE: "105", CL: "131", VE: "911", EC: "911", GT: "110", BO: "110", BR: "192",
  GB: "999", IE: "112", AU: "000", NZ: "111", ZA: "112", IN: "112", PK: "1122", BD: "999", NG: "112", KE: "999",
  CN: "120", HK: "999", MO: "999", TW: "119", JP: "119", KR: "119", SG: "995", MY: "999", TH: "1669", VN: "115", ID: "112",
  IL: "101", AE: "998", SA: "997", EG: "123", TR: "112", RU: "112", UA: "112",
};

// The region from a locale tag such as "es-US" or "zh-Hant-TW".
function regionOf(tag: string | undefined) {
  const m = tag?.match(/[-_]([A-Za-z]{2})(?:$|[-_])/);
  return m ? m[1].toUpperCase() : null;
}

export function deviceRegion() {
  try {
    return regionOf(Intl.DateTimeFormat().resolvedOptions().locale);
  } catch {
    return null;
  }
}

export function emergencyNumber(country: string | null, s: Strings) {
  const code = country ?? deviceRegion();
  if (code) return NUMBERS[code] ?? "112";
  return s.emergencyNumber;
}

export function useEmergencyNumber(s: Strings) {
  const me = useQuery(api.chat.me);
  return emergencyNumber(me?.country ?? null, s);
}

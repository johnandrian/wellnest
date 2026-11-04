// Nearby care from OpenStreetMap: Nominatim turns a saved location into coordinates, Overpass finds ERs, urgent
// care, pharmacies and doctors around them. Free, no key; both ask for a descriptive User-Agent and light use.
import { v } from "convex/values";

export const careKind = v.union(v.literal("er"), v.literal("urgent_care"), v.literal("pharmacy"), v.literal("doctor"));
export type CareKind = "er" | "urgent_care" | "pharmacy" | "doctor";

const UA = "Wellnest/1.0 (health assistant; https://github.com/johnandrian/wellnest)";
const MAX_RESULTS = 8;

export type Place = {
  name: string;
  lat: number;
  lon: number;
  km: number;
  phone?: string;
  address?: string;
  hours?: string;
  open24?: boolean;
  website?: string;
};

// What each kind matches in OpenStreetMap tags, and how far to look (ERs are rarer, so wider).
const QUERIES: Record<CareKind, { radius: number; filters: string[] }> = {
  er: { radius: 30_000, filters: ['["amenity"="hospital"]["emergency"!="no"]', '["healthcare"="hospital"]["emergency"!="no"]'] },
  urgent_care: {
    radius: 15_000,
    filters: ['["healthcare"="urgent_care"]', '["amenity"="clinic"]["urgent_care"="yes"]', '["healthcare:speciality"~"urgent"]'],
  },
  pharmacy: { radius: 8_000, filters: ['["amenity"="pharmacy"]'] },
  doctor: { radius: 10_000, filters: ['["amenity"~"^(clinic|doctors)$"]'] },
};

// "37.77,-122.42" (a shared Telegram location) needs no geocoding.
export function parseCoords(s: string): { lat: number; lon: number } | null {
  const m = s.trim().match(/^(-?\d{1,2}(?:\.\d+)?)\s*,\s*(-?\d{1,3}(?:\.\d+)?)$/);
  if (!m) return null;
  const lat = Number(m[1]);
  const lon = Number(m[2]);
  return Math.abs(lat) <= 90 && Math.abs(lon) <= 180 ? { lat, lon } : null;
}

type Address = Partial<Record<"city" | "town" | "village" | "hamlet" | "suburb" | "municipality" | "county" | "state" | "country", string>>;

// A short name for where the point is, "Berkeley, California", from Nominatim's address parts.
export function placeName(address: Address | undefined): string | undefined {
  if (!address) return undefined;
  const local = address.city ?? address.town ?? address.village ?? address.hamlet ?? address.suburb ?? address.municipality ?? address.county;
  const region = address.state ?? address.country;
  const parts = [local, region].filter((x, i, all): x is string => !!x && all.indexOf(x) === i);
  return parts.length ? parts.join(", ").slice(0, 80) : undefined;
}

// `place`: a short name for it, when Nominatim knows one (not for typed coordinates).
export async function geocode(query: string): Promise<{ lat: number; lon: number; label: string; place?: string } | null> {
  const coords = parseCoords(query);
  if (coords) return { ...coords, label: query };
  const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=1&limit=1&q=${encodeURIComponent(query)}`;
  const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" } });
  if (!res.ok) throw new Error(`Nominatim ${res.status}`);
  const [hit] = (await res.json()) as { lat: string; lon: string; display_name: string; address?: Address }[];
  return hit ? { lat: Number(hit.lat), lon: Number(hit.lon), label: hit.display_name, place: placeName(hit.address) } : null;
}

export function overpassQuery(kind: CareKind, lat: number, lon: number) {
  const { radius, filters } = QUERIES[kind];
  const parts = filters.map((f) => `nwr${f}(around:${radius},${lat},${lon});`).join("");
  return `[out:json][timeout:20];(${parts});out center tags 60;`;
}

export function distanceKm(a: { lat: number; lon: number }, b: { lat: number; lon: number }) {
  const r = (d: number) => (d * Math.PI) / 180;
  const h = Math.sin(r(b.lat - a.lat) / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(r(b.lon - a.lon) / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(h));
}

type Element = { type: string; id: number; lat?: number; lon?: number; center?: { lat: number; lon: number }; tags?: Record<string, string> };

// Named places, nearest first, without duplicates (OSM often has a hospital as both a node and a building).
export function toPlaces(elements: Element[], from: { lat: number; lon: number }): Place[] {
  const seen = new Set<string>();
  const out: Place[] = [];
  for (const e of elements) {
    const pos = e.center ?? (e.lat !== undefined && e.lon !== undefined ? { lat: e.lat, lon: e.lon } : null);
    const t = e.tags ?? {};
    const name = t.name ?? t["name:en"];
    if (!pos || !name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const street = [t["addr:housenumber"], t["addr:street"]].filter(Boolean).join(" ");
    const address = [street, t["addr:city"]].filter(Boolean).join(", ") || undefined;
    const hours = t.opening_hours;
    out.push({
      name,
      lat: pos.lat,
      lon: pos.lon,
      km: Math.round(distanceKm(from, pos) * 10) / 10,
      phone: (t.phone ?? t["contact:phone"])?.split(";")[0].trim(),
      address,
      hours,
      open24: hours?.trim() === "24/7",
      website: t.website ?? t["contact:website"],
    });
  }
  return out.sort((a, b) => a.km - b.km).slice(0, MAX_RESULTS);
}

export async function nearby(kind: CareKind, lat: number, lon: number): Promise<Place[]> {
  const res = await fetch("https://overpass-api.de/api/interpreter", {
    method: "POST",
    headers: { "User-Agent": UA, "Content-Type": "application/x-www-form-urlencoded" },
    body: `data=${encodeURIComponent(overpassQuery(kind, lat, lon))}`,
  });
  if (!res.ok) throw new Error(`Overpass ${res.status}`);
  return toPlaces(((await res.json()).elements ?? []) as Element[], { lat, lon });
}

export const directionsUrl = (p: { lat: number; lon: number }) =>
  `https://www.google.com/maps/dir/?api=1&destination=${p.lat},${p.lon}`;
export const telUrl = (phone: string) => `tel:${phone.replace(/[^\d+]/g, "")}`;

const LABELS: Record<CareKind, string> = { er: "emergency rooms", urgent_care: "urgent care", pharmacy: "pharmacies", doctor: "clinics and doctors" };

// For the model (find_care): Markdown it can pass on, with call and directions links.
export function placesText(kind: CareKind, places: Place[], near: string): string {
  if (!places.length) return `No ${LABELS[kind]} found in OpenStreetMap near ${near}. Suggest searching the web or calling 911 in an emergency.`;
  return (
    `Nearest ${LABELS[kind]} to ${near} (OpenStreetMap; hours may be out of date, so suggest calling first):\n` +
    places
      .map((p) =>
        [
          `- **${p.name}**, ${p.km} km${p.address ? `, ${p.address}` : ""}`,
          p.open24 ? "open 24/7" : p.hours ? `hours: ${p.hours}` : "",
          p.phone ? `[Call ${p.phone}](${telUrl(p.phone)})` : "",
          `[Directions](${directionsUrl(p)})`,
        ]
          .filter(Boolean)
          .join(" · "),
      )
      .join("\n")
  );
}

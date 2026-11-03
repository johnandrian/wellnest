// Local weather, air quality and pollen per day from Open-Meteo (free, no key), for trigger patterns
// (./insights.ts). Hourly readings are rolled up into one row per local day: the high and low, average humidity
// and pressure, total rain, and the day's worst air quality and pollen. Pollen is only reported in Europe.
const FORECAST_URL = "https://api.open-meteo.com/v1/forecast";
const AIR_URL = "https://air-quality-api.open-meteo.com/v1/air-quality";
export const PAST_DAYS = 14; // each fetch also fills in the last two weeks, so a missed day heals itself
const POLLENS = ["alder_pollen", "birch_pollen", "grass_pollen", "mugwort_pollen", "olive_pollen", "ragweed_pollen"] as const;

export type WeatherDay = {
  date: string;
  tempMax?: number; // °C
  tempMin?: number;
  humidity?: number; // %, daily mean
  pressure?: number; // hPa at sea level, daily mean
  precip?: number; // mm
  aqi?: number; // US AQI, daily max
  pollen?: number; // grains/m³, the highest of the reported pollens, daily max
};

type Hourly = { time?: string[] } & Record<string, (number | null)[] | string[] | undefined>;

const r1 = (n: number) => Math.round(n * 10) / 10;

// Hourly arrays -> one value per local date with `fold` (mean, max or sum); hours with no reading are skipped.
function byDay(hourly: Hourly | undefined, keys: readonly string[], fold: (xs: number[]) => number): Map<string, number> {
  const out = new Map<string, number>();
  const time = hourly?.time;
  if (!time) return out;
  const groups = new Map<string, number[]>();
  time.forEach((t, i) => {
    const vals = keys.map((k) => (hourly![k] as (number | null)[] | undefined)?.[i]).filter((x): x is number => typeof x === "number");
    if (!vals.length) return;
    const date = t.slice(0, 10);
    groups.set(date, [...(groups.get(date) ?? []), Math.max(...vals)]);
  });
  for (const [date, xs] of groups) out.set(date, r1(fold(xs)));
  return out;
}
const meanOf = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const maxOf = (xs: number[]) => Math.max(...xs);
const sumOf = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

// The two Open-Meteo answers -> days, oldest first. Either may be missing.
export function toDays(weather: { hourly?: Hourly } | null, air: { hourly?: Hourly } | null): WeatherDay[] {
  const cols = {
    tempMax: byDay(weather?.hourly, ["temperature_2m"], maxOf),
    tempMin: byDay(weather?.hourly, ["temperature_2m"], (xs) => Math.min(...xs)),
    humidity: byDay(weather?.hourly, ["relative_humidity_2m"], meanOf),
    pressure: byDay(weather?.hourly, ["pressure_msl"], meanOf),
    precip: byDay(weather?.hourly, ["precipitation"], sumOf),
    aqi: byDay(air?.hourly, ["us_aqi"], maxOf),
    pollen: byDay(air?.hourly, POLLENS, maxOf),
  };
  const dates = [...new Set(Object.values(cols).flatMap((m) => [...m.keys()]))].sort();
  return dates.map((date) => {
    const day: WeatherDay = { date };
    for (const [k, m] of Object.entries(cols)) if (m.has(date)) day[k as Exclude<keyof WeatherDay, "date">] = Math.round(m.get(date)!);
    if (cols.precip.has(date)) day.precip = cols.precip.get(date);
    return day;
  });
}

// The last two weeks and the next two days at a place, in its own time zone.
export async function fetchWeather(lat: number, lon: number): Promise<WeatherDay[]> {
  const common = `latitude=${lat.toFixed(3)}&longitude=${lon.toFixed(3)}&past_days=${PAST_DAYS}&forecast_days=2&timezone=auto`;
  const get = async (url: string) => {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Open-Meteo ${res.status}`);
    return res.json();
  };
  const [weather, air] = await Promise.all([
    get(`${FORECAST_URL}?${common}&hourly=temperature_2m,relative_humidity_2m,pressure_msl,precipitation`),
    // Air quality is a separate service; the weather alone is still worth keeping if it fails.
    get(`${AIR_URL}?${common}&hourly=us_aqi,${POLLENS.join(",")}`).catch(() => null),
  ]);
  return toDays(weather, air);
}

// Air quality and pollen bands for wording ("moderate", "high").
export function aqiBand(aqi: number): "good" | "moderate" | "unhealthy_sensitive" | "unhealthy" {
  return aqi <= 50 ? "good" : aqi <= 100 ? "moderate" : aqi <= 150 ? "unhealthy_sensitive" : "unhealthy";
}
export function pollenBand(p: number): "low" | "moderate" | "high" {
  return p < 20 ? "low" : p < 100 ? "moderate" : "high";
}

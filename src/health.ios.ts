// iPhone: reads daily summaries from HealthKit. Only these per-day numbers are synced (convex/health.ts);
// raw samples stay on the phone. Needs a development build: HealthKit isn't available in Expo Go.
import {
  isHealthDataAvailable,
  queryCategorySamples,
  queryStatisticsCollectionForQuantity,
  requestAuthorization,
} from "@kingstinct/react-native-healthkit";
import type { HealthDay, HealthMetrics } from "../convex/lib/health";

export const healthSupported = isHealthDataAvailable();

const QUANTITIES = [
  { id: "HKQuantityTypeIdentifierStepCount", key: "steps", stat: "cumulativeSum", unit: "count" },
  { id: "HKQuantityTypeIdentifierActiveEnergyBurned", key: "activeEnergyKcal", stat: "cumulativeSum", unit: "kcal" },
  { id: "HKQuantityTypeIdentifierRestingHeartRate", key: "restingHeartRate", stat: "discreteAverage", unit: "count/min" },
  { id: "HKQuantityTypeIdentifierHeartRateVariabilitySDNN", key: "hrvMs", stat: "discreteAverage", unit: "ms" },
  { id: "HKQuantityTypeIdentifierRespiratoryRate", key: "respiratoryRate", stat: "discreteAverage", unit: "count/min" },
  { id: "HKQuantityTypeIdentifierOxygenSaturation", key: "oxygenSaturation", stat: "discreteAverage", unit: "%" },
  { id: "HKQuantityTypeIdentifierAppleSleepingWristTemperature", key: "wristTempC", stat: "discreteAverage", unit: "degC" },
  { id: "HKQuantityTypeIdentifierBodyMass", key: "weightKg", stat: "discreteAverage", unit: "kg" },
] as const;

const SLEEP = "HKCategoryTypeIdentifierSleepAnalysis";
const FLOW = "HKCategoryTypeIdentifierMenstrualFlow";

// CategoryValueSleepAnalysis: 1 asleep (unspecified), 3 core, 4 deep, 5 REM. 0 in bed and 2 awake don't count.
const ASLEEP = new Set([1, 3, 4, 5]);
// CategoryValueMenstrualFlow, by strength so the heaviest log of a day wins.
const FLOWS = { 5: "none", 1: "unspecified", 2: "light", 3: "medium", 4: "heavy" } as const;
const FLOW_RANK = ["none", "unspecified", "light", "medium", "heavy"];

export async function connectAppleHealth(): Promise<void> {
  if (!healthSupported) throw new Error("Health data isn't available on this device.");
  // iOS shows its own sheet once; it never says which types were allowed (reads of denied types just come back empty).
  await requestAuthorization({ toRead: [...QUANTITIES.map((q) => q.id), SLEEP, FLOW] });
}

// The phone's local calendar date.
function localDate(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// One summary per local day for the last `days` days (today included), oldest first. Days with no data are left out.
export async function readDays(days: number): Promise<HealthDay[]> {
  const end = new Date();
  const start = new Date(end);
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - (days - 1));
  const byDate = new Map<string, HealthMetrics>();
  const put = (date: string, patch: HealthMetrics) => byDate.set(date, { ...byDate.get(date), ...patch });

  await Promise.all(
    QUANTITIES.map(async ({ id, key, stat, unit }) => {
      try {
        const buckets = await queryStatisticsCollectionForQuantity(id, [stat], start, { day: 1 }, {
          unit,
          filter: { date: { startDate: start, endDate: end } },
        });
        for (const b of buckets) {
          const q = stat === "cumulativeSum" ? b.sumQuantity : b.averageQuantity;
          if (!b.startDate || q?.quantity === undefined) continue;
          // HealthKit's percent unit is a fraction (0.97).
          const value = key === "oxygenSaturation" && q.quantity <= 1 ? q.quantity * 100 : q.quantity;
          if (stat === "cumulativeSum" && value === 0) continue;
          put(localDate(b.startDate), { [key]: value });
        }
      } catch (e) {
        console.warn(`HealthKit ${id} failed`, e);
      }
    }),
  );

  // Sleep counts toward the day the night ends on. Watch and phone can both log the same night, so overlaps are merged.
  try {
    const samples = await queryCategorySamples(SLEEP, {
      limit: 0,
      filter: { date: { startDate: new Date(start.getTime() - 12 * 3_600_000), endDate: end } },
    });
    const nights = new Map<string, [number, number][]>();
    for (const s of samples) {
      if (!ASLEEP.has(Number(s.value))) continue;
      const date = localDate(s.endDate);
      nights.set(date, [...(nights.get(date) ?? []), [s.startDate.getTime(), s.endDate.getTime()]]);
    }
    for (const [date, spans] of nights) {
      if (date < localDate(start)) continue;
      put(date, { sleepHours: mergedMs(spans) / 3_600_000 });
    }
  } catch (e) {
    console.warn("HealthKit sleep failed", e);
  }

  // Cycle tracking: Flo, Clue and the Health app write flow logs here.
  try {
    const samples = await queryCategorySamples(FLOW, { limit: 0, filter: { date: { startDate: start, endDate: end } } });
    for (const s of samples) {
      const flow = FLOWS[Number(s.value) as keyof typeof FLOWS];
      if (!flow) continue;
      const date = localDate(s.startDate);
      const current = byDate.get(date)?.menstrualFlow;
      if (!current || FLOW_RANK.indexOf(flow) > FLOW_RANK.indexOf(current)) put(date, { menstrualFlow: flow });
    }
  } catch (e) {
    console.warn("HealthKit menstrual flow failed", e);
  }

  return [...byDate.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, metrics]) => ({ date, metrics }));
}

function mergedMs(spans: [number, number][]) {
  let total = 0;
  let [curStart, curEnd] = [-Infinity, -Infinity];
  for (const [s, e] of [...spans].sort((a, b) => a[0] - b[0])) {
    if (s > curEnd) {
      if (curEnd > curStart) total += curEnd - curStart;
      [curStart, curEnd] = [s, e];
    } else {
      curEnd = Math.max(curEnd, e);
    }
  }
  if (curEnd > curStart) total += curEnd - curStart;
  return total;
}

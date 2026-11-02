// Android: reads daily summaries from Health Connect (Samsung Health, Fitbit, Garmin, Oura, Google Fit and cycle
// apps all write to it), in the same shape as Apple Health on iPhone (./health.ios.ts). Only per-day numbers are
// synced (convex/health.ts). Needs a development build; Health Connect isn't available in Expo Go.
import { getSdkStatus, initialize, readRecords, requestPermission, SdkAvailabilityStatus } from "react-native-health-connect";
import type { RecordType, RecordResult } from "react-native-health-connect";
import type { HealthDay, HealthMetrics } from "../convex/lib/health";

export const healthSource = "health_connect" as const;
export const healthName = "Health Connect";
// Checked properly in connectAppleHealth; Health Connect ships with Android 14+ and is an app before that.
export const healthSupported = true;

const TYPES = [
  "Steps",
  "ActiveCaloriesBurned",
  "RestingHeartRate",
  "HeartRateVariabilityRmssd",
  "SleepSession",
  "RespiratoryRate",
  "OxygenSaturation",
  "Weight",
  "MenstruationFlow",
] as const satisfies readonly RecordType[];

// Health Connect's MenstruationFlow: 0 unknown, 1 light, 2 medium, 3 heavy.
const FLOWS = { 0: "unspecified", 1: "light", 2: "medium", 3: "heavy" } as const;
const FLOW_RANK = ["none", "unspecified", "light", "medium", "heavy"];

let ready: Promise<boolean> | null = null;
async function init() {
  const status = await getSdkStatus();
  if (status !== SdkAvailabilityStatus.SDK_AVAILABLE) {
    throw new Error(
      status === SdkAvailabilityStatus.SDK_UNAVAILABLE_PROVIDER_UPDATE_REQUIRED
        ? "Please update the Health Connect app, then try again."
        : "Health Connect isn't available on this phone. Install it from the Play Store, then try again.",
    );
  }
  ready ??= initialize();
  if (!(await ready)) throw new Error("Couldn't start Health Connect.");
}

export async function connectHealth(): Promise<void> {
  await init();
  await requestPermission(TYPES.map((recordType) => ({ accessType: "read" as const, recordType })));
}

function localDate(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

async function readAll<T extends RecordType>(type: T, start: Date, end: Date): Promise<RecordResult<T>[]> {
  const out: RecordResult<T>[] = [];
  let pageToken: string | undefined;
  for (let page = 0; page < 20; page++) {
    const res = await readRecords(type, {
      timeRangeFilter: { operator: "between", startTime: start.toISOString(), endTime: end.toISOString() },
      pageSize: 1000,
      ...(pageToken && { pageToken }),
    });
    out.push(...res.records);
    if (!res.pageToken) break;
    pageToken = res.pageToken;
  }
  return out;
}

// One summary per local day for the last `days` days (today included), oldest first. Days with no data are left out.
export async function readDays(days: number): Promise<HealthDay[]> {
  await init();
  const end = new Date();
  const start = new Date(end);
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - (days - 1));
  const sums = new Map<string, Partial<Record<"steps" | "activeEnergyKcal" | "sleepMs", number>>>();
  const lists = new Map<string, Partial<Record<"restingHeartRate" | "hrvMs" | "respiratoryRate" | "oxygenSaturation" | "weightKg", number[]>>>();
  const flows = new Map<string, HealthMetrics["menstrualFlow"]>();
  const add = (date: string, key: "steps" | "activeEnergyKcal" | "sleepMs", v: number) => {
    const day = sums.get(date) ?? {};
    day[key] = (day[key] ?? 0) + v;
    sums.set(date, day);
  };
  const push = (date: string, key: "restingHeartRate" | "hrvMs" | "respiratoryRate" | "oxygenSaturation" | "weightKg", v: number) => {
    const day = lists.get(date) ?? {};
    (day[key] ??= []).push(v);
    lists.set(date, day);
  };
  const safely = async (what: string, fn: () => Promise<void>) => {
    try {
      await fn();
    } catch (e) {
      console.warn(`Health Connect ${what} failed`, e); // usually: the user didn't allow this type
    }
  };

  await Promise.all([
    safely("steps", async () => {
      for (const r of await readAll("Steps", start, end)) add(localDate(new Date(r.startTime)), "steps", r.count);
    }),
    safely("active calories", async () => {
      for (const r of await readAll("ActiveCaloriesBurned", start, end)) add(localDate(new Date(r.startTime)), "activeEnergyKcal", r.energy.inKilocalories);
    }),
    safely("resting heart rate", async () => {
      for (const r of await readAll("RestingHeartRate", start, end)) push(localDate(new Date(r.time)), "restingHeartRate", r.beatsPerMinute);
    }),
    safely("HRV", async () => {
      for (const r of await readAll("HeartRateVariabilityRmssd", start, end)) push(localDate(new Date(r.time)), "hrvMs", r.heartRateVariabilityMillis);
    }),
    safely("breathing rate", async () => {
      for (const r of await readAll("RespiratoryRate", start, end)) push(localDate(new Date(r.time)), "respiratoryRate", r.rate);
    }),
    safely("SpO2", async () => {
      for (const r of await readAll("OxygenSaturation", start, end)) push(localDate(new Date(r.time)), "oxygenSaturation", r.percentage);
    }),
    safely("weight", async () => {
      for (const r of await readAll("Weight", start, end)) push(localDate(new Date(r.time)), "weightKg", r.weight.inKilograms);
    }),
    // Sleep counts toward the day the night ends on. Awake stages (1) and out of bed (3) don't count.
    safely("sleep", async () => {
      const from = new Date(start.getTime() - 12 * 3_600_000);
      for (const r of await readAll("SleepSession", from, end)) {
        const date = localDate(new Date(r.endTime));
        if (date < localDate(start)) continue;
        const awake = (r.stages ?? [])
          .filter((s) => s.stage === 1 || s.stage === 3)
          .reduce((ms, s) => ms + (Date.parse(s.endTime) - Date.parse(s.startTime)), 0);
        add(date, "sleepMs", Date.parse(r.endTime) - Date.parse(r.startTime) - awake);
      }
    }),
    safely("menstrual flow", async () => {
      for (const r of await readAll("MenstruationFlow", start, end)) {
        const flow = FLOWS[(r.flow ?? 0) as keyof typeof FLOWS];
        const date = localDate(new Date(r.time));
        const current = flows.get(date);
        if (!current || FLOW_RANK.indexOf(flow) > FLOW_RANK.indexOf(current)) flows.set(date, flow);
      }
    }),
  ]);

  const avg = (xs?: number[]) => (xs?.length ? xs.reduce((a, b) => a + b, 0) / xs.length : undefined);
  const dates = new Set([...sums.keys(), ...lists.keys(), ...flows.keys()]);
  return [...dates]
    .sort()
    .map((date) => {
      const s = sums.get(date) ?? {};
      const l = lists.get(date) ?? {};
      const metrics: HealthMetrics = {
        steps: s.steps || undefined,
        activeEnergyKcal: s.activeEnergyKcal || undefined,
        sleepHours: s.sleepMs ? s.sleepMs / 3_600_000 : undefined,
        restingHeartRate: avg(l.restingHeartRate),
        hrvMs: avg(l.hrvMs),
        respiratoryRate: avg(l.respiratoryRate),
        oxygenSaturation: avg(l.oxygenSaturation),
        weightKg: l.weightKg?.at(-1),
        menstrualFlow: flows.get(date),
      };
      for (const k of Object.keys(metrics) as (keyof HealthMetrics)[]) if (metrics[k] === undefined) delete metrics[k];
      return { date, metrics };
    })
    .filter((d) => Object.keys(d.metrics).length > 0);
}

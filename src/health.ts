// Phone health data lives on the phone: Apple Health on iPhone (./health.ios.ts), Health Connect on Android
// (./health.android.ts). The web app gets this stand-in; it still shows what the phone synced.
import type { HealthDay } from "../convex/lib/health";

export const healthSource = "apple_health" as const;
export const healthName = "Apple Health / Health Connect";
export const healthSupported = false;

export async function connectHealth(): Promise<void> {
  throw new Error("Connect your health data from the Wellnest phone app.");
}

export async function readDays(_days: number): Promise<HealthDay[]> {
  return [];
}

// Apple Health lives only on the iPhone (./health.ios.ts). Web and Android get this stand-in.
import type { HealthDay } from "../convex/lib/health";

export const healthSupported = false;

export async function connectAppleHealth(): Promise<void> {
  throw new Error("Apple Health is only available in the iPhone app.");
}

export async function readDays(_days: number): Promise<HealthDay[]> {
  return [];
}

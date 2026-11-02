import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "../convex/_generated/api";
import { checkinText, detect, shift } from "../convex/lib/checkins";
import type { HealthDay, HealthMetrics } from "../convex/lib/health";
import { createAppUser, messagesOf, setEnv, setup } from "./helpers";

// 17:05 UTC = 09:05 in Los Angeles (PST) on 2026-11-02.
const NINE_LA = Date.parse("2026-11-02T17:05:00Z");
const TODAY = "2026-11-02";
const H = 3_600_000;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NINE_LA);
  setEnv();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

// 14 ordinary days ending yesterday, then `recent` for the last days (ending today).
function history(base: HealthMetrics, recent: HealthMetrics[], end = TODAY): HealthDay[] {
  const all = [...Array(14).fill(base), ...recent];
  return all.map((metrics, i) => ({ date: shift(end, i - all.length + 1), metrics }));
}
const BASE = { restingHeartRate: 57, wristTempC: 36.2, sleepHours: 7.5, hrvMs: 50, steps: 8000, respiratoryRate: 14, oxygenSaturation: 97 };

describe("detect", () => {
  test("heart rate and temperature up together reads as possibly getting sick", () => {
    const days = history(BASE, [{ ...BASE, restingHeartRate: 64 }, { ...BASE, restingHeartRate: 65, wristTempC: 36.8 }]);
    expect(detect(days, TODAY)).toEqual({ kind: "illness", hr: 65, hrBase: 57, temp: 0.6 });
  });

  test("each other signal, by priority", () => {
    expect(detect(history(BASE, [{ ...BASE, wristTempC: 37 }]), TODAY)).toEqual({ kind: "temperature", temp: 0.8 });
    expect(detect(history(BASE, [{ ...BASE, respiratoryRate: 18 }]), TODAY)).toMatchObject({ kind: "breathing", rate: 18 });
    expect(detect(history(BASE, [{ ...BASE, oxygenSaturation: 92 }]), TODAY)).toMatchObject({ kind: "oxygen", spo2: 92 });
    expect(detect(history(BASE, [{ ...BASE, restingHeartRate: 65 }, { ...BASE, restingHeartRate: 65 }]), TODAY)).toMatchObject({ kind: "heart_rate", hr: 65 });
    expect(detect(history(BASE, [{ ...BASE, sleepHours: 5 }, { ...BASE, sleepHours: 5.5 }, { ...BASE, sleepHours: 4.9 }]), TODAY)).toMatchObject({ kind: "sleep", nights: 3 });
    expect(detect(history(BASE, [{ ...BASE, hrvMs: 34 }, { ...BASE, hrvMs: 36 }]), TODAY)).toMatchObject({ kind: "hrv", hrv: 35 });
    expect(detect(history(BASE, [{ ...BASE, steps: 2000 }, { ...BASE, steps: 2500 }, { ...BASE, steps: 1500 }]), TODAY)).toMatchObject({ kind: "activity", steps: 2000 });
  });

  test("ordinary days, too little history, or stale data: nothing", () => {
    expect(detect(history(BASE, [BASE, BASE]), TODAY)).toBeNull();
    expect(detect(history(BASE, [{ ...BASE, wristTempC: 37.5 }]).slice(-3), TODAY)).toBeNull();
    expect(detect(history(BASE, [{ ...BASE, wristTempC: 37.5 }], "2026-10-25"), TODAY)).toBeNull();
  });

  test("messages are in the user's language and invite a reply", () => {
    const s = { kind: "sleep" as const, nights: 3, avg: 5.2 };
    expect(checkinText(s, "en")).toBe("🩺 You've slept under 6 hours three nights in a row (about 5.2 hours on average). How are you feeling? I can share a few things that help with sleep if you'd like.");
    expect(checkinText(s, "es")).toContain("unas 5,2 horas");
    expect(checkinText(s, "el")).toContain("περίπου 5,2 ώρες");
  });
});

describe("check-in cron", () => {
  async function userWithSignal(t: ReturnType<typeof setup>) {
    const u = await createAppUser(t);
    await u.as.mutation(api.chat.setTimeZone, { timeZone: "America/Los_Angeles", utcOffsetMin: -480 });
    const days = history(BASE, [{ ...BASE, wristTempC: 37 }]);
    await u.as.mutation(api.health.sync, { days });
    return u;
  }
  const checkinsOf = async (t: ReturnType<typeof setup>, userId: any) => (await messagesOf(t, userId)).filter((m) => m.kind === "checkin");
  const scan = async (t: ReturnType<typeof setup>) => {
    await t.mutation(internal.checkins.scan, {});
    await t.finishAllScheduledFunctions(() => vi.advanceTimersByTime(1));
  };

  test("at 9 AM local, a change posts one check-in in the chat; once a day, and the same kind not again for 3 days", async () => {
    const t = setup();
    const { userId } = await userWithSignal(t);
    await scan(t);
    const [msg] = await checkinsOf(t, userId);
    expect(msg).toMatchObject({ role: "assistant", channel: "app", text: expect.stringContaining("wrist temperature last night was 0.8°C above") });

    await scan(t); // same hour again
    vi.setSystemTime(NINE_LA + 24 * H); // tomorrow 9 AM: same kind, within 3 days
    await scan(t);
    expect(await checkinsOf(t, userId)).toHaveLength(1);
  });

  test("not at other hours, not when turned off, not without Apple Health", async () => {
    const t = setup();
    const { userId, as } = await userWithSignal(t);
    const other = await createAppUser(t, "b@example.com");
    vi.setSystemTime(NINE_LA + 2 * H);
    await scan(t);
    expect(await checkinsOf(t, userId)).toHaveLength(0);

    vi.setSystemTime(NINE_LA);
    await as.mutation(api.checkins.setEnabled, { enabled: false });
    expect((await as.query(api.chat.me))!.checkins).toBe(false);
    await scan(t);
    expect(await checkinsOf(t, userId)).toHaveLength(0);
    expect(await checkinsOf(t, other.userId)).toHaveLength(0);
  });

  test("walks every user in batches", async () => {
    const t = setup();
    await t.run(async (ctx) => {
      for (let i = 0; i < 230; i++) await ctx.db.insert("users", { email: `u${i}@example.com` });
    });
    const { userId } = await userWithSignal(t); // created last, in the third batch
    await scan(t);
    expect(await checkinsOf(t, userId)).toHaveLength(1);
  });
});

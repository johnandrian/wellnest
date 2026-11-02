import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api } from "../convex/_generated/api";
import { isPushToken, plain } from "../convex/lib/push";
import { createAppUser, messagesOf, mockApis, pushSends, setEnv, setup } from "./helpers";

const NOW = Date.parse("2026-11-02T18:00:00Z");
const H = 3_600_000;
const TOKEN_A = "ExponentPushToken[aaaaaaaaaaaaaaaaaaaaaa]";
const TOKEN_B = "ExponentPushToken[bbbbbbbbbbbbbbbbbbbbbb]";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  setEnv();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

// Runs what's due without running recurring reminders forever (see reminders.test.ts).
const settle = (t: ReturnType<typeof setup>) => t.finishAllScheduledFunctions(() => vi.advanceTimersByTime(1));
const tokensOf = (t: ReturnType<typeof setup>) => t.run((ctx) => ctx.db.query("pushTokens").collect());

async function withReminder(t: ReturnType<typeof setup>) {
  const u = await createAppUser(t);
  await u.as.mutation(api.chat.setTimeZone, { timeZone: "America/Los_Angeles", utcOffsetMin: -480 });
  await u.as.mutation(api.reminders.add, { name: "Ibuprofen", dose: "400 mg", schedule: { kind: "interval", everyHours: 6, firstAt: NOW + 6 * H } });
  return u;
}

describe("push tokens", () => {
  test("register needs sign-in and a real Expo token; a phone that switches accounts moves", async () => {
    const t = setup();
    await expect(t.mutation(api.push.register, { token: TOKEN_A, platform: "ios" })).rejects.toThrow(/Not signed in/);
    const a = await createAppUser(t, "a@example.com");
    const b = await createAppUser(t, "b@example.com");
    await expect(a.as.mutation(api.push.register, { token: "nope", platform: "ios" })).rejects.toThrow(/Expo push token/);
    await a.as.mutation(api.push.register, { token: TOKEN_A, platform: "ios" });
    await a.as.mutation(api.push.register, { token: TOKEN_A, platform: "ios" });
    expect((await tokensOf(t)).map((r) => r.userId)).toEqual([a.userId]);
    await b.as.mutation(api.push.register, { token: TOKEN_A, platform: "ios" });
    expect((await tokensOf(t)).map((r) => r.userId)).toEqual([b.userId]);
  });

  test("unregister only removes the caller's own token", async () => {
    const t = setup();
    const a = await createAppUser(t, "a@example.com");
    const b = await createAppUser(t, "b@example.com");
    await a.as.mutation(api.push.register, { token: TOKEN_A, platform: "android" });
    await b.as.mutation(api.push.unregister, { token: TOKEN_A });
    expect(await tokensOf(t)).toHaveLength(1);
    await a.as.mutation(api.push.unregister, { token: TOKEN_A });
    expect(await tokensOf(t)).toHaveLength(0);
  });
});

describe("reminder notifications", () => {
  test("a due dose pushes to every device with Taken / Skip and the message id", async () => {
    const t = setup();
    const { calls } = mockApis();
    const { userId, as } = await withReminder(t);
    await as.mutation(api.push.register, { token: TOKEN_A, platform: "ios" });
    await as.mutation(api.push.register, { token: TOKEN_B, platform: "android" });
    vi.advanceTimersByTime(6 * H);
    await settle(t);
    const sent = pushSends(calls);
    const [reminder] = (await messagesOf(t, userId)).filter((m) => m.kind === "reminder");
    expect(sent.map((m: any) => m.to)).toEqual([TOKEN_A, TOKEN_B]);
    expect(sent[0]).toMatchObject({
      title: "💊 Ibuprofen",
      body: "Time for your Ibuprofen (400 mg). Due 4:00 PM.",
      categoryId: "reminder",
      channelId: "reminders",
      sound: "default",
      data: { kind: "reminders", messageId: reminder._id },
    });
  });

  test("no devices or turned off in Settings: nothing is sent", async () => {
    const t = setup();
    const { calls } = mockApis();
    const { as } = await withReminder(t);
    vi.advanceTimersByTime(6 * H);
    await settle(t);
    expect(pushSends(calls)).toHaveLength(0);

    await as.mutation(api.push.register, { token: TOKEN_A, platform: "ios" });
    await as.mutation(api.push.setPreference, { kind: "reminders", enabled: false });
    expect((await as.query(api.chat.me))!.notifications).toEqual({ reminders: false, appointments: true });
    vi.advanceTimersByTime(6 * H);
    await settle(t);
    expect(pushSends(calls)).toHaveLength(0);
  });

  test("tokens Expo says are gone are forgotten", async () => {
    const t = setup();
    mockApis({ pushDead: [TOKEN_B] });
    const { as } = await withReminder(t);
    await as.mutation(api.push.register, { token: TOKEN_A, platform: "ios" });
    await as.mutation(api.push.register, { token: TOKEN_B, platform: "ios" });
    vi.advanceTimersByTime(6 * H);
    await settle(t);
    expect((await tokensOf(t)).map((r) => r.token)).toEqual([TOKEN_A]);
  });

  test("delete everything removes the account's devices", async () => {
    const t = setup();
    mockApis();
    const { as } = await createAppUser(t);
    await as.mutation(api.push.register, { token: TOKEN_A, platform: "ios" });
    await as.mutation(api.me.deleteData, { category: "everything" });
    await settle(t);
    expect(await tokensOf(t)).toHaveLength(0);
  });
});

describe("push helpers", () => {
  test("token format and plain text", () => {
    expect(isPushToken(TOKEN_A)).toBe(true);
    expect(isPushToken("ExpoPushToken[xxxxxxxxxxxxxxxxxxxx]")).toBe(true);
    expect(isPushToken("ExponentPushToken[]")).toBe(false);
    expect(plain("Time for **Zinc**, see [CDC](https://cdc.gov)")).toBe("Time for Zinc, see CDC");
  });
});

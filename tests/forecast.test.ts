import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "../convex/_generated/api";
import { Id } from "../convex/_generated/dataModel";
import { dateList, findPatterns, forecastMatches, Inputs, shiftDate, WEATHER_FACTORS } from "../convex/lib/insights";
import { forecastText } from "../convex/lib/insightsText";
import { createAppUser, messagesOf, mockApis, pushSends, setEnv, setup } from "./helpers";

// 7:15 PM in UTC, the users' time zone here.
const NOW = Date.parse("2026-11-02T19:15:00Z");
const TODAY = "2026-11-02";
const TOMORROW = "2026-11-03";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  setEnv();
  vi.stubEnv("APP_URL", "https://talktothebeak.health");
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

const settle = (t: ReturnType<typeof setup>) => t.finishAllScheduledFunctions(() => vi.advanceTimersByTime(1));
const days = dateList(shiftDate(TODAY, -29), TODAY);
// Every third day the air pressure drops 5 hPa, and mood is low on exactly those days.
const isDrop = (i: number) => i % 3 === 0;
const weather = (tomorrowPressure: number) => [
  ...days.map((date, i) => ({ date, pressure: isDrop(i) ? 1010 : 1015 })),
  { date: TOMORROW, pressure: tomorrowPressure },
];

async function seed(t: ReturnType<typeof setup>, userId: Id<"users">, tomorrowPressure = 1008) {
  await t.run(async (ctx) => {
    await ctx.db.patch(userId, { timeZone: "UTC", location: "Berkeley, CA", profile: { name: "Ana" } });
    for (const [i, date] of days.entries()) await ctx.db.insert("dailyLogs", { userId, date, mood: isDrop(i) ? 2 : 4, source: "card" });
    for (const w of weather(tomorrowPressure)) await ctx.db.insert("weatherDays", { userId, ...w });
  });
}

describe("flare forecast: matching", () => {
  const input = (tomorrowPressure: number): Inputs => ({
    entries: [],
    trackers: [],
    health: [],
    daily: days.map((date, i) => ({ date, mood: isDrop(i) ? 2 : 4 })),
    weather: weather(tomorrowPressure),
  });

  test("tomorrow's pressure drop falls on a pattern; steady pressure doesn't", () => {
    const patterns = findPatterns(input(1008), days, 50, WEATHER_FACTORS);
    expect(patterns.map((p) => [p.outcome, p.factor, p.side])).toEqual([["mood", "pressureDrop", "yes"]]);
    expect(forecastMatches(patterns, input(1008).weather, TOMORROW)).toEqual([{ pattern: patterns[0], value: 1 }]);
    expect(forecastMatches(patterns, input(1016).weather, TOMORROW)).toEqual([]);
    // No forecast row for the day: nothing to match.
    expect(forecastMatches(patterns, input(1008).weather, shiftDate(TOMORROW, 1))).toEqual([]);
  });

  test("the message names the forecast and the pattern, for the user or for someone caring for them", () => {
    const [m] = forecastMatches(findPatterns(input(1008), days, 50, WEATHER_FACTORS), input(1008).weather, TOMORROW);
    const own = forecastText([m], "en");
    expect(own.title).toBe("Heads-up for tomorrow");
    expect(own.text).toBe(
      [
        "🌦️ **Heads-up for tomorrow**",
        "",
        "• **Forecast: a drop in air pressure.** Mood averaged 2/5 on days with a drop in air pressure (9 days), vs 4/5 on other days (20).",
        "",
        "This is a pattern in your own logs, not a prediction. If you can, plan an easier day and keep what helps close by.",
      ].join("\n"),
    );
    expect(forecastText([m], "en", "Ana").title).toBe("Heads-up for Ana tomorrow");
    expect(forecastText([m], "es", "Ana").text).toContain("**Pronóstico: una bajada de la presión atmosférica.**");
  });
});

describe("flare forecast: the evening message", () => {
  test("7 PM local with a match: one heads-up in the chat with a push, once a day", async () => {
    const t = setup();
    const { calls } = mockApis();
    const { userId, as } = await createAppUser(t);
    await as.mutation(api.push.register, { token: "ExponentPushToken[aaaaaaaaaaaaaaaaaaaaaa]", platform: "ios" });
    await seed(t, userId);
    await t.mutation(internal.forecast.scan, {});
    await settle(t);
    const sent = (await messagesOf(t, userId)).filter((m) => m.kind === "forecast");
    expect(sent.map((m) => m.text)).toEqual([expect.stringContaining("a drop in air pressure")]);
    expect(pushSends(calls)).toEqual([
      expect.objectContaining({ title: "Heads-up for tomorrow", body: expect.stringMatching(/^• Forecast: a drop in air pressure\. Mood averaged 2\/5/), channelId: "forecast" }),
    ]);
    await t.mutation(internal.forecast.scan, {});
    await settle(t);
    expect((await messagesOf(t, userId)).filter((m) => m.kind === "forecast")).toHaveLength(1);
  });

  test("nothing when tomorrow doesn't match, when switched off, or at another hour", async () => {
    const t = setup();
    mockApis();
    const steady = await createAppUser(t);
    const off = await createAppUser(t, "b@example.com");
    const elsewhere = await createAppUser(t, "c@example.com");
    await seed(t, steady.userId, 1016);
    await seed(t, off.userId);
    await off.as.mutation(api.forecast.setEnabled, { enabled: false });
    await seed(t, elsewhere.userId);
    await t.run((ctx) => ctx.db.patch(elsewhere.userId, { timeZone: "America/New_York" })); // 2:15 PM there
    await t.mutation(internal.forecast.scan, {});
    await settle(t);
    for (const u of [steady, off, elsewhere]) expect((await messagesOf(t, u.userId)).filter((m) => m.kind === "forecast")).toEqual([]);
  });

  test("care circle members who chose it get their own copy; others don't", async () => {
    const t = setup();
    mockApis();
    const ana = await createAppUser(t);
    const sam = await createAppUser(t, "sam@example.com");
    const lee = await createAppUser(t, "lee@example.com");
    await seed(t, ana.userId);
    for (const [who, forecast] of [[sam, true], [lee, false]] as const) {
      const { url } = await ana.as.mutation(api.circle.invite, { alerts: { missedDoses: true, forecast } });
      await who.as.mutation(api.circle.join, { token: new URL(url).searchParams.get("join")! });
    }
    await t.mutation(internal.forecast.scan, {});
    await settle(t);
    expect((await messagesOf(t, sam.userId)).filter((m) => m.kind === "circle").map((m) => m.text)).toEqual([
      expect.stringMatching(/^🌦️ \*\*Heads-up for Ana tomorrow\*\*[\s\S]*a pattern in Ana's own logs/),
    ]);
    expect((await messagesOf(t, lee.userId)).filter((m) => m.kind === "circle")).toEqual([]);
  });

  test("the model hears about tomorrow's match", async () => {
    const t = setup();
    mockApis();
    const { userId } = await createAppUser(t);
    await seed(t, userId);
    const text = await t.query(internal.insights.forModel, { userId });
    expect(text).toContain("Flare forecast (tomorrow's weather matches their own patterns; a heads-up, not a prediction):\n- Forecast: a drop in air pressure.");
  });
});

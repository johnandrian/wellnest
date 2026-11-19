// Food and caffeine in the daily check-in (convex/daily.ts) and in patterns (convex/lib/insights.ts).
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api } from "../convex/_generated/api";
import { dateList, findPatterns, shiftDate } from "../convex/lib/insights";
import { patternText } from "../convex/lib/insightsText";
import { cleanCaffeine, cleanFoods, dailySummary } from "../convex/lib/journal";
import { createAppUser, drain, mockApis, setEnv, setup } from "./helpers";

const NOW = Date.parse("2026-11-02T21:00:00Z"); // 13:00 in Los Angeles

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

describe("food and caffeine", () => {
  test("cleaning and the model's summary", () => {
    expect(cleanFoods(["alcohol", "cake", "dairy", "alcohol"])).toEqual(["alcohol", "dairy"]);
    expect(cleanFoods([])).toEqual([]);
    expect(cleanFoods(undefined)).toBeUndefined();
    expect(cleanCaffeine(2.6)).toBe(3);
    expect(cleanCaffeine(0)).toBe(0);
    expect(cleanCaffeine(99)).toBeUndefined();
    expect(dailySummary([{ date: "2026-11-01", caffeine: 2, foods: ["alcohol"] }, { date: "2026-11-02", caffeine: 4, foods: [] }])).toEqual([
      "Caffeine: average 3 drinks a day over 2 days.",
      "Food noted on 2 days: alcohol 1.",
    ]);
  });

  test("saved with the check-in from the card and from chat, without touching the faces", async () => {
    const t = setup();
    const call = { content: null, tool_calls: [{ id: "d", type: "function", function: { name: "log_how_i_feel", arguments: JSON.stringify({ caffeine_drinks: 3, foods: ["fried", "alcohol", "nope"] }) } }] };
    mockApis({ core: [call, { content: "Logged." }] });
    const { as } = await createAppUser(t);
    await as.mutation(api.daily.log, { mood: 4, date: "2026-11-02" });
    await as.mutation(api.daily.log, { foods: [], date: "2026-11-02" });
    expect(await as.query(api.daily.today, { date: "2026-11-02" })).toMatchObject({ mood: 4, foods: [], caffeine: null });
    await as.mutation(api.chat.send, { text: "had 3 coffees, pizza and a couple of beers" });
    await drain(t);
    expect(await as.query(api.daily.today, { date: "2026-11-02" })).toMatchObject({ mood: 4, foods: ["alcohol", "fried"], caffeine: 3 });
  });

  test("patterns find alcohol the day before", () => {
    const dates = dateList("2026-10-01", "2026-10-24");
    // Drinks on every third day; headaches are worse the day after.
    const daily = dates.map((date, i) => ({ date, foods: i % 3 === 0 ? ["alcohol"] : [], caffeine: i % 2 ? 4 : 1 }));
    const entries = dates.map((date, i) => ({ date, symptom: "headache", severity: (i - 1) % 3 === 0 ? 7 : 2 }));
    const found = findPatterns({ entries, daily, trackers: [], health: [], weather: [] }, dates, 10);
    const alcohol = found.find((p) => p.factor === "alcohol")!;
    expect(alcohol).toMatchObject({ outcome: "symptom:headache", side: "yes", worse: 7, other: 2 });
    expect(patternText(alcohol, "en")).toMatch(/^Headache averaged 7\/10 on days with alcohol the day before \(\d+ days\), vs 2\/10 on other days/);
    // Pain the day after a drink, not the day of it.
    expect(daily.find((d) => d.date === shiftDate("2026-10-01", 1))).toMatchObject({ foods: [] });
  });
});

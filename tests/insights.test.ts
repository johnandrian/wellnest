import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "../convex/_generated/api";
import { Id } from "../convex/_generated/dataModel";
import { chartSeries, dateList, findPatterns, Inputs, medEffects, shiftDate, weekStats } from "../convex/lib/insights";
import { medEffectText, patternText, weatherLine, weeklyText } from "../convex/lib/insightsText";
import { toDays } from "../convex/lib/weather";
import { parseQuestions } from "../convex/questions";
import { cortexCalls, createAppUser, drain, messagesOf, mockApis, pushSends, setEnv, setup, weatherCalls } from "./helpers";

// Sunday 1 November 2026, 18:10 UTC.
const NOW = Date.parse("2026-11-01T18:10:00Z");
const TODAY = "2026-11-01";

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

const empty = (): Inputs => ({ entries: [], trackers: [], daily: [], health: [], weather: [] });
// The last `n` dates ending today, oldest first.
const lastDays = (n: number, end = TODAY) => dateList(shiftDate(end, -(n - 1)), end);
const pain = (date: string, severity: number) => ({ date, at: Date.parse(`${date}T12:00:00Z`), tracker: "pain" as const, pain: { severity, locations: [], types: [] } });

// 20 days: short sleep (5 h) on even days with pain 7, a full night (8 h) on odd days with pain 3, give or take one.
function sleepAndPain(): Inputs {
  const days = lastDays(20);
  return {
    ...empty(),
    trackers: days.map((d, i) => pain(d, (i % 2 ? 3 : 7) + (i % 4 === 0 ? 1 : 0))),
    health: days.map((d, i) => ({ date: d, metrics: { sleepHours: i % 2 ? 8 : 5 } })),
  };
}

describe("patterns", () => {
  test("short sleep goes with more pain; the wording gives both averages and the day counts", () => {
    const input = sleepAndPain();
    const [p] = findPatterns(input, lastDays(20));
    expect(p).toMatchObject({ outcome: "pain", factor: "sleepHours", side: "below", threshold: 6.5, worse: 7.5, other: 3, worseDays: 10, otherDays: 10 });
    expect(patternText(p, "en")).toBe("Pain averaged 7.5/10 on days with under 6.5 h of sleep (10 days), vs 3/10 on other days (10).");
    expect(patternText(p, "es")).toBe("Dolor: media de 7,5/10 los días con menos de 6,5 h de sueño (10 días), frente a 3/10 el resto (10).");
    expect(patternText(p, "zh")).toBe("疼痛：在睡眠不足 6.5 小时的日子里平均为 7.5/10（10 天），其他日子为 3/10（10 天）。");
  });

  test("nothing with too few days, or when the gap is small", () => {
    const input = sleepAndPain();
    expect(findPatterns({ ...input, trackers: input.trackers.slice(-9) }, lastDays(20))).toEqual([]);
    const flat = { ...input, trackers: input.trackers.map((e, i) => pain(e.date, i % 2 ? 4 : 4.4)) };
    expect(findPatterns(flat, lastDays(20))).toEqual([]);
  });

  test("weather: a pressure drop goes with more reliever puffs; mood counts low as worse", () => {
    const days = lastDays(20);
    // Pressure falls 5 hPa every third day.
    const weather = days.map((d, i) => ({ date: d, pressure: 1015 - (i % 3 === 0 ? 5 : 0) }));
    const trackers = days.map((d, i) => ({
      date: d, at: Date.parse(`${d}T09:00:00Z`), tracker: "asthma" as const, asthma: { reliever: i % 3 === 0 ? 6 : 1, symptoms: [] },
    }));
    const daily = days.map((d, i) => ({ date: d, mood: i % 3 === 0 ? 2 : 4 }));
    const found = findPatterns({ ...empty(), weather, trackers, daily }, days);
    expect(found.map((p) => [p.outcome, p.factor, p.side])).toEqual(expect.arrayContaining([["reliever", "pressureDrop", "yes"], ["mood", "pressureDrop", "yes"]]));
    const reliever = found.find((p) => p.outcome === "reliever")!;
    expect(patternText(reliever, "en")).toBe("Reliever puffs averaged 6 a day on days with a drop in air pressure (6 days), vs 1 a day on other days (13).");
  });

  test("seizure-free days count as zero from the first logged seizure", () => {
    const days = lastDays(20);
    const trackers = days.flatMap((d, i) => (i % 2 === 0 ? [{ date: d, at: 0, tracker: "seizure" as const, seizure: {} }] : []));
    const health = days.map((d, i) => ({ date: d, metrics: { sleepHours: i % 2 === 0 ? 5 : 8 } }));
    const [p] = findPatterns({ ...empty(), trackers, health }, days);
    expect(p).toMatchObject({ outcome: "seizures", factor: "sleepHours", worse: 1, other: 0 });
  });
});

describe("medications before and after", () => {
  test("two weeks before vs the days after a start, better or worse by the measure's direction", () => {
    const start = shiftDate(TODAY, -6);
    const days = lastDays(20);
    const input = { ...empty(), trackers: days.map((d) => pain(d, d < start ? 7 : 3)), daily: days.map((d) => ({ date: d, energy: d < start ? 4 : 2 })) };
    const effects = medEffects(input, [{ name: "Amitriptyline", kind: "started", date: start }], days, TODAY);
    expect(effects.map((e) => [e.outcome, e.before, e.after, e.better])).toEqual([["pain", 7, 3, true], ["energy", 4, 2, false]]);
    expect(medEffectText(effects[0], "en")).toBe("Pain since starting Amitriptyline on Oct 26: 3/10, vs 7/10 in the 2 weeks before (better).");
    // Fewer than four days after: too early to say.
    expect(medEffects(input, [{ name: "X", kind: "dose_changed", date: shiftDate(TODAY, -2) }], days, TODAY)).toEqual([]);
  });
});

describe("weather", () => {
  test("hourly readings become days: high and low, mean humidity and pressure, total rain, worst air and pollen", () => {
    const time = ["2026-10-31T00:00", "2026-10-31T12:00", "2026-11-01T00:00", "2026-11-01T12:00"];
    const days = toDays(
      { hourly: { time, temperature_2m: [10, 18.4, 12, 20], relative_humidity_2m: [80, 60, 70, null], pressure_msl: [1010, 1012, 1004, 1006], precipitation: [0, 0.4, 2.5, 1] } },
      { hourly: { time, us_aqi: [30, 55, 20, 25], grass_pollen: [null, null, 5, 40], birch_pollen: [null, null, 60, 1] } },
    );
    expect(days).toEqual([
      { date: "2026-10-31", tempMax: 18, tempMin: 10, humidity: 70, pressure: 1011, precip: 0.4, aqi: 55 },
      { date: "2026-11-01", tempMax: 20, tempMin: 12, humidity: 70, pressure: 1005, precip: 3.5, aqi: 25, pollen: 60 },
    ]);
    expect(weatherLine(days[1], "en")).toBe("12–20°C · humidity 70% · rain 3.5 mm · air quality 25 (good) · pollen moderate");
  });

  test("saving a location geocodes it once and stores the days; a refresh replaces them", async () => {
    const t = setup();
    const { calls } = mockApis({
      weatherHourly: { time: ["2026-10-31T09:00", "2026-11-01T09:00"], temperature_2m: [15, 17], relative_humidity_2m: [50, 90], pressure_msl: [1012, 1003], precipitation: [0, 4] },
      airHourly: { time: ["2026-10-31T09:00", "2026-11-01T09:00"], us_aqi: [40, 120] },
    });
    const { userId, as } = await createAppUser(t);
    await as.mutation(api.chat.setLocation, { location: "Berkeley, CA" });
    await drain(t);
    await t.action(internal.weather.refresh, { userId });
    const rows = await t.run((ctx) => ctx.db.query("weatherDays").collect());
    expect(rows.map(({ date, humidity, aqi, precip }) => ({ date, humidity, aqi, precip }))).toEqual([
      { date: "2026-10-31", humidity: 50, aqi: 40, precip: 0 },
      { date: "2026-11-01", humidity: 90, aqi: 120, precip: 4 },
    ]);
    expect(weatherCalls(calls)[0].url).toContain("latitude=37.872&longitude=-122.273");
    expect(calls.filter((c) => c.url.includes("nominatim"))).toHaveLength(1);
    expect((await t.run((ctx) => ctx.db.get(userId)))!.locationPoint?.for).toBe("Berkeley, CA");
  });

  test("a weather outage is logged, not thrown, and no location means no fetch", async () => {
    const t = setup();
    const { calls } = mockApis({ weatherHourly: new Error("down") });
    const { userId } = await createAppUser(t);
    await t.action(internal.weather.refresh, { userId });
    expect(weatherCalls(calls)).toHaveLength(0);
    await t.run((ctx) => ctx.db.patch(userId, { location: "Berkeley, CA" }));
    await t.action(internal.weather.refresh, { userId });
    expect(weatherCalls(calls)).toHaveLength(1);
    expect(await t.run((ctx) => ctx.db.query("weatherDays").collect())).toEqual([]);
  });
});

async function seedPainAndHumidity(t: ReturnType<typeof setup>, userId: Id<"users">) {
  await t.run(async (ctx) => {
    for (const [i, date] of lastDays(20).entries()) {
      await ctx.db.insert("trackerEntries", { userId, ...pain(date, i % 2 ? 2 : 6), source: "manual" });
      await ctx.db.insert("weatherDays", { userId, date, humidity: i % 2 ? 40 : 85, tempMax: 20, tempMin: 11, aqi: 30 });
    }
  });
}

describe("insights in the app and for the model", () => {
  test("the Journal card: patterns and today's weather in the user's language, for this user only", async () => {
    const t = setup();
    const { userId, as } = await createAppUser(t);
    const other = await createAppUser(t, "b@example.com");
    await seedPainAndHumidity(t, userId);
    await t.run((ctx) => ctx.db.patch(userId, { language: "es", location: "Berkeley" }));
    const view = (await as.query(api.insights.view, { today: TODAY }))!;
    expect(view.patterns).toEqual(["Dolor: media de 6/10 los días con humedad del 65 % o más (10 días), frente a 2/10 el resto (10)."]);
    expect(view.weather).toBe("11–20°C · humedad 40% · calidad del aire 30 (buena)");
    expect(view.hasLocation).toBe(true);
    expect(await other.as.query(api.insights.view, { today: TODAY })).toEqual({ patterns: [], medEffects: [], weather: null, tomorrow: [], hasLocation: false });
  });

  test("find_patterns gives the model the patterns in English with a caution", async () => {
    const t = setup();
    const toolCall = { content: null, tool_calls: [{ id: "p1", type: "function", function: { name: "find_patterns", arguments: "{}" } }] };
    const { calls } = mockApis({ core: [toolCall, { content: "Humid days line up with your pain." }] });
    const { userId, as } = await createAppUser(t);
    await seedPainAndHumidity(t, userId);
    await as.mutation(api.chat.send, { text: "what makes my pain worse?" });
    await drain(t);
    const result = cortexCalls(calls)[1].body.messages.at(-1);
    expect(result.role).toBe("tool");
    expect(result.content).toContain("associations in their own logs, not proof of cause");
    expect(result.content).toContain("Pain averaged 6/10 on days with humidity of 65% or more (10 days), vs 2/10 on other days (10).");
  });

  test("show_chart puts a chart under the reply and tells the model the numbers; bad metrics are refused", async () => {
    const t = setup();
    const call = (args: object, id: string) => ({ content: null, tool_calls: [{ id, type: "function", function: { name: "show_chart", arguments: JSON.stringify(args) } }] });
    const { calls } = mockApis({ core: [call({ metric: "pain", days: 14 }, "c1"), call({ metric: "blood" }, "c2"), { content: "Your pain has eased." }] });
    const { userId, as } = await createAppUser(t);
    await seedPainAndHumidity(t, userId);
    await as.mutation(api.chat.send, { text: "show my pain for the last two weeks" });
    await drain(t);
    const reply = (await messagesOf(t, userId)).at(-1)!;
    expect(reply.text).toBe("Your pain has eased.");
    expect(reply.charts).toHaveLength(1);
    expect(reply.charts![0]).toMatchObject({ metric: "pain", title: "Pain", unit: "/10", max: 10, worse: "high", from: shiftDate(TODAY, -13), to: TODAY });
    expect(reply.charts![0].points).toHaveLength(14);
    const [first, second] = cortexCalls(calls).slice(1).map((c) => c.body.messages.at(-1).content);
    expect(first).toMatch(/^Chart shown to the user: Pain \(\/10\), 2026-10-19 to 2026-11-01, 14 days with data\. Average 4,/);
    expect(second).toMatch(/^Tool error: metric must be one of/);
    // The chart reaches the app with the message.
    expect((await as.query(api.chat.list)).at(-1)!.charts).toHaveLength(1);
  });

  test("chart series: days without data are left out; scales and directions per measure", () => {
    const input = { ...empty(), health: [{ date: "2026-10-30", metrics: { steps: 4000 } }, { date: "2026-11-01", metrics: { steps: 9000 } }] };
    expect(chartSeries(input, "steps", lastDays(3))).toEqual({ points: [{ date: "2026-10-30", value: 4000 }, { date: "2026-11-01", value: 9000 }], max: 9000, worse: "none" });
    expect(chartSeries({ ...empty(), daily: [{ date: TODAY, mood: 2 }] }, "mood", lastDays(3))).toMatchObject({ max: 5, worse: "low" });
  });
});

describe("questions for an appointment", () => {
  async function upcomingVisit(as: Awaited<ReturnType<typeof createAppUser>>["as"]) {
    await as.mutation(api.visits.add, { title: "Neurology follow-up", kind: "in_person", startsAt: NOW + 3 * 86_400_000, prep: "Bring the MRI" });
    return (await as.query(api.visits.list, { now: NOW }))!.upcoming[0]._id as Id<"visits">;
  }

  test("suggested from what changed, in the user's language, saved on the visit; one can be removed", async () => {
    const t = setup();
    const { calls } = mockApis({ core: [{ content: 'Here you go:\n```json\n["Mis dolores subieron a 6 los días húmedos. ¿Por qué?", "¿Debo cambiar la dosis?"]\n```' }] });
    const { userId, as } = await createAppUser(t);
    await seedPainAndHumidity(t, userId);
    await t.run((ctx) => ctx.db.patch(userId, { language: "es" }));
    const id = await upcomingVisit(as);
    expect(await as.action(api.questions.suggest, { id })).toHaveLength(2);
    const [system, user] = cortexCalls(calls)[0].body.messages;
    expect(system.content).toContain("Write them in Spanish.");
    expect(user.content).toContain("Appointment: Neurology follow-up (in person)");
    expect(user.content).toContain("Their own notes and questions for this visit (don't repeat these): Bring the MRI");
    expect(user.content).toContain("Pattern: Pain averaged 6/10 on days with humidity of 65% or more");
    await as.mutation(api.questions.remove, { id, index: 0 });
    expect((await as.query(api.visits.list, { now: NOW }))!.upcoming[0].questions).toEqual(["¿Debo cambiar la dosis?"]);
  });

  test("someone else's visit is refused; an unreadable answer is an error", async () => {
    const t = setup();
    mockApis({ core: [{ content: "Sorry, I can't." }] });
    const { as } = await createAppUser(t);
    const other = await createAppUser(t, "b@example.com");
    const id = await upcomingVisit(as);
    await expect(other.as.action(api.questions.suggest, { id })).rejects.toThrow(/isn't coming up/);
    await expect(as.action(api.questions.suggest, { id })).rejects.toThrow(/Couldn't write questions/);
    await expect(other.as.mutation(api.questions.remove, { id, index: 0 })).rejects.toThrow(/Not found/);
  });

  test("the 2-hour reminder writes them when there are none yet", async () => {
    const t = setup();
    mockApis({ core: [{ content: '["What does the new scan show?"]' }] });
    const { as } = await createAppUser(t);
    const id = await upcomingVisit(as);
    const visit = (await t.run((ctx) => ctx.db.get(id)))!;
    await t.mutation(internal.visits.remind, { id, startsAt: visit.startsAt });
    await t.finishAllScheduledFunctions(() => vi.advanceTimersByTime(1));
    expect((await t.run((ctx) => ctx.db.get(id)))!.questions).toEqual(["What does the new scan show?"]);
  });

  test("parsing tolerates fences and drops junk", () => {
    expect(parseQuestions('```json\n["a", 3, " b "]\n```')).toEqual(["a", "b"]);
    expect(parseQuestions("no list")).toEqual([]);
    expect(parseQuestions(null)).toEqual([]);
  });
});

describe("weekly summary", () => {
  async function seedWeek(t: ReturnType<typeof setup>, userId: Id<"users">) {
    await t.run(async (ctx) => {
      for (const date of lastDays(14)) {
        const thisWeek = date > shiftDate(TODAY, -7);
        await ctx.db.insert("dailyLogs", { userId, date, mood: thisWeek ? 4 : 2, energy: 3, source: "card" });
      }
      const medicationId = await ctx.db.insert("medications", {
        userId, name: "Metformin", schedule: { kind: "daily", times: ["08:00"] }, timeZone: "UTC", utcOffsetMin: 0, active: true,
      });
      for (const [i, status] of (["taken", "taken", undefined] as const).entries()) {
        await ctx.db.insert("messages", {
          userId, role: "assistant", channel: "app", kind: "reminder", text: "Time for Metformin",
          reminder: { medicationId, dueAt: NOW - (i + 1) * 86_400_000, ...(status && { status }) },
        });
      }
    });
  }

  test("Sunday 6 PM local: a recap in the chat with a push, once a week", async () => {
    const t = setup();
    const { calls } = mockApis();
    const { userId, as } = await createAppUser(t);
    await t.run((ctx) => ctx.db.patch(userId, { timeZone: "UTC" }));
    await as.mutation(api.push.register, { token: "ExponentPushToken[aaaaaaaaaaaaaaaaaaaaaa]", platform: "ios" });
    await seedWeek(t, userId);
    await t.mutation(internal.weekly.scan, {});
    await t.finishAllScheduledFunctions(() => vi.advanceTimersByTime(1));
    const summary = (await messagesOf(t, userId)).filter((m) => m.kind === "summary");
    expect(summary).toHaveLength(1);
    expect(summary[0].text).toBe(
      ["📅 **Your week** (Oct 26 – Nov 1)", "", "• Mood: 4/5 (last week 2/5, better)", "• Energy: 3/5 (last week 3/5)", "• Medications: 2 of 3 doses taken", "", "Ask me about any of these, or open Health tools for the charts."].join("\n"),
    );
    expect(pushSends(calls)).toEqual([expect.objectContaining({ title: "Your week (Oct 26 – Nov 1)", body: "• Mood: 4/5 (last week 2/5, better)\n• Energy: 3/5 (last week 3/5)\n• Medications: 2 of 3 doses taken\nAsk me about any of these, or open Health tools for the charts.", channelId: "weekly" })]);
    // The same hour again (or the next one) doesn't send a second.
    await t.mutation(internal.weekly.scan, {});
    await t.finishAllScheduledFunctions(() => vi.advanceTimersByTime(1));
    expect((await messagesOf(t, userId)).filter((m) => m.kind === "summary")).toHaveLength(1);
  });

  test("not at other hours, not when switched off, not with nothing logged", async () => {
    const t = setup();
    mockApis();
    const a = await createAppUser(t);
    const b = await createAppUser(t, "b@example.com");
    const c = await createAppUser(t, "c@example.com");
    await t.run(async (ctx) => {
      await ctx.db.patch(a.userId, { timeZone: "America/New_York" }); // 13:10 there
      await ctx.db.patch(b.userId, { timeZone: "UTC" });
      await ctx.db.patch(c.userId, { timeZone: "UTC" });
    });
    await seedWeek(t, a.userId);
    await seedWeek(t, b.userId);
    await b.as.mutation(api.weekly.setEnabled, { enabled: false });
    await t.mutation(internal.weekly.scan, {});
    await t.finishAllScheduledFunctions(() => vi.advanceTimersByTime(1));
    for (const u of [a, b, c]) expect((await messagesOf(t, u.userId)).filter((m) => m.kind === "summary")).toEqual([]);
    expect((await b.as.query(api.chat.me))!.weeklySummary).toBe(false);
  });

  test("week stats and the Greek wording", () => {
    const input = { ...empty(), trackers: lastDays(14).map((d) => pain(d, d > shiftDate(TODAY, -7) ? 6 : 4)) };
    const stats = weekStats(input, lastDays(14), TODAY);
    expect(stats).toEqual([{ outcome: "pain", thisWeek: 6, lastWeek: 4, days: 7, better: false }]);
    expect(weeklyText({ lang: "el", from: shiftDate(TODAY, -6), to: TODAY, stats }).split("\n")[2]).toBe("• Πόνος: 6/10 (την προηγούμενη εβδομάδα 4/10, χειρότερα)");
  });
});

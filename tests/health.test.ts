import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api } from "../convex/_generated/api";
import { Id } from "../convex/_generated/dataModel";
import { cleanMetrics, cycleSummary, formatDays, HealthDay, periodStarts, summarize } from "../convex/lib/health";
import { cortexCalls, createAppUser, creaoStarts, drain, mockApis, setEnv, setup } from "./helpers";

const NOW = Date.parse("2026-11-02T18:00:00Z");

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

// `n` days ending 2026-11-02, oldest first.
function dates(n: number) {
  return Array.from({ length: n }, (_, i) => new Date(NOW - (n - 1 - i) * 86_400_000).toISOString().slice(0, 10));
}

const daysOf = (t: ReturnType<typeof setup>, userId: Id<"users">) =>
  t.run((ctx) => ctx.db.query("healthDays").withIndex("by_user_and_date", (q) => q.eq("userId", userId)).collect());

const toolCall = (name: string, args: object, id = "h1") => ({
  content: null,
  tool_calls: [{ id, type: "function", function: { name, arguments: JSON.stringify(args) } }],
});

const toolResult = (calls: any[], id = "h1") =>
  cortexCalls(calls)
    .flatMap((c) => c.body.messages)
    .find((m: any) => m.role === "tool" && m.tool_call_id === id)?.content as string | undefined;

const coreTools = (calls: any[]) => (cortexCalls(calls)[0].body.tools ?? []).map((t: any) => t.function.name);

describe("health sync", () => {
  test("needs sign-in", async () => {
    const t = setup();
    await expect(t.mutation(api.health.sync, { days: [] })).rejects.toThrow(/Not signed in/);
    expect(await t.query(api.health.status)).toBeNull();
  });

  test("stores cleaned daily summaries, upserts by date, and marks Apple Health connected", async () => {
    const t = setup();
    const { userId, as } = await createAppUser(t);
    expect(await as.query(api.health.status)).toEqual({ connected: false });

    const res = await as.mutation(api.health.sync, {
      days: [
        { date: "2026-10-31", metrics: { steps: 8412.6, restingHeartRate: 58.04, sleepHours: 7.25 } },
        { date: "2026-11-01", metrics: { restingHeartRate: 999, oxygenSaturation: 97 } }, // 999 bpm is dropped
        { date: "2026-11-01x", metrics: { steps: 10 } }, // not a date
        { date: "2026-12-25", metrics: { steps: 10 } }, // the future
        { date: "2026-11-02", metrics: { restingHeartRate: -3 } }, // nothing usable left
      ],
    });
    expect(res).toEqual({ saved: 2 });
    let rows = await daysOf(t, userId);
    expect(rows.map((r) => [r.date, r.metrics])).toEqual([
      ["2026-10-31", { steps: 8413, restingHeartRate: 58, sleepHours: 7.3 }],
      ["2026-11-01", { oxygenSaturation: 97 }],
    ]);

    // A later sync replaces that day's summary instead of adding a second row.
    vi.advanceTimersByTime(60_000);
    await as.mutation(api.health.sync, { days: [{ date: "2026-11-01", metrics: { oxygenSaturation: 98, menstrualFlow: "light" } }] });
    rows = await daysOf(t, userId);
    expect(rows).toHaveLength(2);
    expect(rows[1].metrics).toEqual({ oxygenSaturation: 98, menstrualFlow: "light" });

    expect(await as.query(api.health.status)).toEqual({
      connected: true,
      syncedAt: expect.any(Number),
      shareWithAnalysis: false,
      latestDate: "2026-11-01",
    });
    const user = await t.run((ctx) => ctx.db.get(userId));
    expect(user?.health?.connectedAt).toBeLessThan(NOW + 60_000); // kept from the first sync
  });

  test("refuses more than 90 days at once", async () => {
    const t = setup();
    const { as } = await createAppUser(t);
    const days = dates(91).map((date) => ({ date, metrics: { steps: 1000 } }));
    await expect(as.mutation(api.health.sync, { days })).rejects.toThrow(/At most 90 days/);
  });

  test("each user only sees their own status", async () => {
    const t = setup();
    const a = await createAppUser(t, "a@example.com");
    const b = await createAppUser(t, "b@example.com");
    await a.as.mutation(api.health.sync, { days: [{ date: "2026-11-01", metrics: { steps: 5 } }] });
    expect(await b.as.query(api.health.status)).toEqual({ connected: false });
    expect(await daysOf(t, b.userId)).toHaveLength(0);
  });

  test("sharing with analyses needs a connection; disconnect deletes every synced day", async () => {
    const t = setup();
    const { userId, as } = await createAppUser(t);
    await expect(as.mutation(api.health.setShareWithAnalysis, { enabled: true })).rejects.toThrow(/isn't connected/);

    const days = dates(90).map((date) => ({ date, metrics: { steps: 1000 } }));
    await as.mutation(api.health.sync, { days });
    await as.mutation(api.health.setShareWithAnalysis, { enabled: true });
    expect((await as.query(api.health.status))?.connected && (await as.query(api.health.status))).toMatchObject({ shareWithAnalysis: true });

    await as.mutation(api.health.disconnect);
    await drain(t);
    expect(await daysOf(t, userId)).toHaveLength(0);
    expect(await as.query(api.health.status)).toEqual({ connected: false });
  });
});

describe("get_health_data tool", () => {
  test("isn't offered until Apple Health is connected", async () => {
    const t = setup();
    const { calls } = mockApis();
    const { as } = await createAppUser(t);
    await as.mutation(api.chat.send, { text: "why am I so tired" });
    await drain(t);
    expect(coreTools(calls)).not.toContain("get_health_data");
    expect(cortexCalls(calls)[0].body.messages[0].content).not.toContain("Apple Health");
  });

  test("gives the model the user's recent days with averages and the last 3 days compared", async () => {
    const t = setup();
    const { calls } = mockApis({
      core: [toolCall("get_health_data", { days: 7 }), { content: "Your resting heart rate is up and sleep is down." }],
    });
    const { as } = await createAppUser(t);
    await as.mutation(api.health.sync, {
      days: dates(10).map((date, i) => ({
        date,
        metrics: { restingHeartRate: i < 7 ? 56 : 66, sleepHours: i < 7 ? 7.5 : 5.2, steps: 9000 },
      })),
    });
    await as.mutation(api.chat.send, { text: "why am I so tired lately" });
    await drain(t);

    expect(coreTools(calls)).toContain("get_health_data");
    expect(cortexCalls(calls)[0].body.messages[0].content).toContain("The user connected Apple Health");
    const result = toolResult(calls)!;
    expect(result).toContain("Apple Health, 2026-10-27 to 2026-11-02");
    expect(result).toContain("Resting heart rate: average 60 bpm; last 3 days 66 vs 56 before");
    expect(result).toContain("2026-11-02: steps 9,000 · resting HR 66 bpm · sleep 5.2 h");
    expect(result).not.toContain("2026-10-26"); // outside the 7 days asked for
  });

  test("says so when there's nothing synced for the period", async () => {
    const t = setup();
    const { calls } = mockApis({ core: [toolCall("get_health_data", {}), { content: "ok" }] });
    const { as } = await createAppUser(t);
    await as.mutation(api.health.sync, { days: [{ date: "2026-09-01", metrics: { steps: 100 } }] });
    await as.mutation(api.chat.send, { text: "how did I sleep" });
    await drain(t);
    expect(toolResult(calls)).toMatch(/No Apple Health data for that period/);
  });
});

describe("Apple Health in CREAO analyses", () => {
  beforeEach(() => {
    vi.stubEnv("CREAO_API_KEY", "capi_test");
    vi.stubEnv("CREAO_WEBHOOK_SECRET", "hook_secret");
    vi.stubEnv("CONVEX_SITE_URL", "https://happy-otter-123.convex.site");
  });

  async function analyze(share: boolean) {
    const t = setup();
    const { calls } = mockApis({
      jev: { wants_analysis: 0.9, consent: 0.95 },
      core: [toolCall("analyze_symptoms", { symptoms: "Tired for two weeks" }), { content: "Started." }],
    });
    const { as } = await createAppUser(t);
    await as.mutation(api.health.sync, {
      days: dates(40).map((date, i) => ({
        date,
        metrics: { restingHeartRate: 60, ...(i === 5 || i === 33 ? { menstrualFlow: "medium" as const } : {}) },
      })),
    });
    if (share) await as.mutation(api.health.setShareWithAnalysis, { enabled: true });
    await as.mutation(api.chat.send, { text: "What could be making me so tired? Please run a detailed analysis" });
    await drain(t);
    return { calls, inputs: creaoStarts(calls)[0]?.body.inputs };
  }

  test("adds biosensor and cycle data when the user agreed to share", async () => {
    const { calls, inputs } = await analyze(true);
    expect(inputs.symptoms).toBe("Tired for two weeks");
    expect(inputs.biosensor_data).toContain("From Apple Health (14 days)");
    expect(inputs.cycle_data).toContain("Period starts logged: 2026-09-29, 2026-10-27.");
    expect(inputs.last_period_start).toBe("2026-10-27");
    expect(cortexCalls(calls)[0].body.messages[0].content).toContain("agreed to include their Apple Health summaries");
  });

  test("sends nothing from Apple Health without that OK", async () => {
    const { inputs } = await analyze(false);
    expect(inputs).toEqual({ symptoms: "Tired for two weeks" });
  });
});

describe("health formatting", () => {
  const day = (date: string, metrics: HealthDay["metrics"]): HealthDay => ({ date, metrics });

  test("cleanMetrics drops implausible and non-finite values", () => {
    expect(cleanMetrics({ steps: NaN, hrvMs: 0, wristTempC: 36.44, weightKg: 70.06 })).toEqual({ wristTempC: 36.4, weightKg: 70.1 });
    expect(cleanMetrics({ steps: Infinity })).toBeNull();
  });

  test("wrist temperature reads as the change from the range's average", () => {
    const text = formatDays([day("2026-11-01", { wristTempC: 36 }), day("2026-11-02", { wristTempC: 37 })]);
    expect(text).toBe("2026-11-01: wrist temp −0.5°C vs average\n2026-11-02: wrist temp +0.5°C vs average");
  });

  test("periods: consecutive or one-day-gap bleeding days are one period", () => {
    const days = [
      day("2026-09-01", { menstrualFlow: "heavy" }),
      day("2026-09-02", { menstrualFlow: "medium" }),
      day("2026-09-04", { menstrualFlow: "light" }),
      day("2026-09-10", { menstrualFlow: "none" }),
      day("2026-09-29", { menstrualFlow: "unspecified" }),
    ];
    expect(periodStarts(days)).toEqual(["2026-09-01", "2026-09-29"]);
    expect(cycleSummary(days, "2026-10-03")).toEqual({
      lastPeriodStart: "2026-09-29",
      text: "Period starts logged: 2026-09-01, 2026-09-29. Today is cycle day 5. Average cycle length 28 days (28).",
    });
    expect(cycleSummary([day("2026-09-10", { steps: 5 })], "2026-10-03")).toBeNull();
  });

  test("summaries skip the comparison with too little history", () => {
    expect(summarize([day("2026-11-01", { sleepHours: 7 }), day("2026-11-02", { sleepHours: 6 })])).toBe("Sleep: average 6.5 h");
  });
});

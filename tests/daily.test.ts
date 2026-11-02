import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api } from "../convex/_generated/api";
import { dailyPatterns, dailySummary, journalText } from "../convex/lib/journal";
import { cortexCalls, createAppUser, drain, mockApis, setEnv, setup } from "./helpers";

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

const rows = (t: ReturnType<typeof setup>) => t.run((ctx) => ctx.db.query("dailyLogs").collect());
const date = (i: number) => `2026-10-${String(i + 1).padStart(2, "0")}`;

describe("daily check-in", () => {
  test("answers merge into today's row; out-of-range values are ignored; the card hides once skipped", async () => {
    const t = setup();
    await expect(t.mutation(api.daily.log, { mood: 3 })).rejects.toThrow(/Not signed in/);
    const { as } = await createAppUser(t);
    await as.mutation(api.daily.log, { mood: 4 });
    await as.mutation(api.daily.log, { energy: 2, sleepQuality: 9 });
    expect(await as.query(api.daily.today, { date: "2026-11-02" })).toEqual({ mood: 4, energy: 2, sleepQuality: null, skipped: false });
    expect(await rows(t)).toHaveLength(1);

    vi.setSystemTime(NOW + 24 * 3_600_000);
    await as.mutation(api.daily.skip, {});
    expect(await as.query(api.daily.today, { date: "2026-11-03" })).toMatchObject({ skipped: true });
  });

  test("the model logs how the user feels, and get_symptom_journal reads it back", async () => {
    const t = setup();
    const { calls } = mockApis({
      core: [
        { content: null, tool_calls: [{ id: "d1", type: "function", function: { name: "log_how_i_feel", arguments: '{"energy":1,"note":"wiped out"}' } }] },
        { content: "Logged." },
        { content: null, tool_calls: [{ id: "d2", type: "function", function: { name: "get_symptom_journal", arguments: "{}" } }] },
        { content: "ok" },
      ],
    });
    const { as } = await createAppUser(t);
    await as.mutation(api.chat.send, { text: "I'm completely wiped out today" });
    await drain(t);
    const result = (id: string) => cortexCalls(calls).flatMap((c) => c.body.messages).find((m: any) => m.tool_call_id === id)?.content;
    expect(result("d1")).toBe("Logged today's check-in (2026-11-02). The user sees it in the Journal tab.");
    expect((await rows(t))[0]).toMatchObject({ energy: 1, note: "wiped out", source: "chat" });
    await as.mutation(api.chat.send, { text: "how have I been?" });
    await drain(t);
    expect(result("d2")).toContain("Daily check-ins (1-5):\nEnergy: average 1/5 over 1 days");
    expect(result("d2")).toContain("2026-11-02: energy 1, wiped out");
  });

  test("the journal view includes check-ins; deleting the journal removes them", async () => {
    const t = setup();
    mockApis();
    const { as } = await createAppUser(t);
    await as.mutation(api.daily.log, { mood: 2, energy: 3, sleepQuality: 4 });
    const view = (await as.query(api.journal.view, { since: "2026-10-01" }))!;
    expect(view.daily).toEqual([{ date: "2026-11-02", mood: 2, energy: 3, sleepQuality: 4 }]);
    expect(view.summaries).toContain("Mood: average 2/5 over 1 days, last 3 days 2/5.");
    await as.mutation(api.me.deleteData, { category: "journal" });
    await drain(t);
    expect(await rows(t)).toHaveLength(0);
  });
});

describe("daily helpers", () => {
  test("energy patterns against short sleep", () => {
    const daily = Array.from({ length: 8 }, (_, i) => ({ date: date(i), energy: i % 2 ? 4 : 2 }));
    const health = Array.from({ length: 8 }, (_, i) => ({ date: date(i), metrics: { sleepHours: i % 2 ? 8 : 5 } }));
    expect(dailyPatterns(daily, health)).toEqual(["Energy averaged 2/5 on days with under 6 h of sleep (4 days) vs 4/5 otherwise (4 days)."]);
    expect(dailySummary(daily)).toEqual(["Energy: average 3/5 over 8 days, last 3 days 3.3/5."]);
    expect(journalText([], health, daily)).toContain("Patterns with health data");
  });
});

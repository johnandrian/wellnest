import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api } from "../convex/_generated/api";
import { Entry, normalizeSymptom, patterns, summaries } from "../convex/lib/journal";
import type { HealthDay } from "../convex/lib/health";
import { cortexCalls, createAppUser, drain, mockApis, setEnv, setup } from "./helpers";

// 2026-11-02 21:00 UTC is 13:00 in Los Angeles; 2026-11-03 05:00 UTC is still Nov 2 there.
const NOW = Date.parse("2026-11-02T21:00:00Z");

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

const toolCall = (name: string, args: object) => ({
  content: null,
  tool_calls: [{ id: "j1", type: "function", function: { name, arguments: JSON.stringify(args) } }],
});
const toolResult = (calls: any[]) =>
  cortexCalls(calls).flatMap((c) => c.body.messages).find((m: any) => m.role === "tool" && m.tool_call_id === "j1")?.content as string;
const entriesOf = (t: ReturnType<typeof setup>) => t.run((ctx) => ctx.db.query("symptomEntries").collect());

const date = (i: number) => `2026-10-${String(i + 1).padStart(2, "0")}`;

describe("journal helpers", () => {
  test("symptom names are normalized so entries group", () => {
    expect(normalizeSymptom("  Headaches! ")).toBe("headache");
    expect(normalizeSymptom("Cramps")).toBe("cramp");
    expect(normalizeSymptom("dizziness")).toBe("dizziness");
    expect(normalizeSymptom("Πονοκέφαλος")).toBe("πονοκέφαλος");
  });

  test("patterns compare severity on days with short sleep vs not, needing 3 days each side and a 1.5-point gap", () => {
    const entries: Entry[] = [];
    const health: HealthDay[] = [];
    for (let i = 0; i < 8; i++) {
      const short = i % 2 === 0;
      entries.push({ date: date(i), symptom: "headache", severity: short ? 7 : 3 });
      health.push({ date: date(i), metrics: { sleepHours: short ? 5 : 8, steps: 9000 } });
    }
    expect(patterns(entries, health)).toEqual([
      "Headache averaged 7/10 on days with under 6 h of sleep (4 days) vs 3/10 otherwise (4 days).",
    ]);
    // Too few days on one side: nothing.
    expect(patterns(entries.slice(0, 4), health)).toEqual([]);
  });

  test("summaries show averages, the latest and a trend", () => {
    const entries: Entry[] = [1, 2, 2, 5, 6, 7].map((sev, i) => ({ date: date(i), symptom: "fatigue", severity: sev }));
    entries.push({ date: date(9), symptom: "nausea" });
    expect(summaries(entries)).toEqual([
      "Fatigue: logged on 6 days, average 3.8/10, latest 7/10, getting worse (+4.3).",
      "Nausea: logged on 1 day.",
    ]);
  });
});

describe("journal entries", () => {
  test("need sign-in; dates default to the user's local today; the same symptom that day is updated", async () => {
    const t = setup();
    await expect(t.mutation(api.journal.add, { symptom: "headache" })).rejects.toThrow(/Not signed in/);
    const { as } = await createAppUser(t);
    await as.mutation(api.chat.setTimeZone, { timeZone: "America/Los_Angeles", utcOffsetMin: -480 });
    vi.setSystemTime(Date.parse("2026-11-03T05:00:00Z")); // still Nov 2 in LA
    await as.mutation(api.journal.add, { symptom: "Headaches", severity: 4 });
    await as.mutation(api.journal.add, { symptom: "headache", severity: 12, note: "after screens" });
    expect((await entriesOf(t)).map((e) => [e.date, e.symptom, e.severity, e.note, e.source])).toEqual([
      ["2026-11-02", "headache", 10, "after screens", "manual"],
    ]);
    await expect(as.mutation(api.journal.add, { symptom: "  " })).rejects.toThrow(/Say which symptom/);
  });

  test("future dates fall back to today; only the owner can remove", async () => {
    const t = setup();
    const a = await createAppUser(t, "a@example.com");
    const b = await createAppUser(t, "b@example.com");
    await a.as.mutation(api.journal.add, { symptom: "cough", date: "2027-01-01" });
    const [entry] = await entriesOf(t);
    expect(entry.date).toBe("2026-11-02");
    await expect(b.as.mutation(api.journal.remove, { id: entry._id })).rejects.toThrow(/Not found/);
    await a.as.mutation(api.journal.remove, { id: entry._id });
    expect(await entriesOf(t)).toHaveLength(0);
  });

  test("view gives chart points, sleep, period days, patterns and recent entries for this user only", async () => {
    const t = setup();
    const { userId, as } = await createAppUser(t);
    const other = await createAppUser(t, "b@example.com");
    await t.run(async (ctx) => {
      for (let i = 0; i < 8; i++) {
        const short = i % 2 === 0;
        await ctx.db.insert("symptomEntries", { userId, date: date(i + 20), symptom: "headache", severity: short ? 8 : 2, source: "chat" });
        await ctx.db.insert("healthDays", { userId, date: date(i + 20), source: "apple_health", metrics: { sleepHours: short ? 5 : 8, ...(i === 1 ? { menstrualFlow: "light" as const } : {}) } });
      }
      await ctx.db.insert("symptomEntries", { userId: other.userId, date: date(25), symptom: "other", source: "chat" });
    });
    const view = (await as.query(api.journal.view, { since: "2026-10-01" }))!;
    expect(view.symptoms).toMatchObject([{ name: "headache", count: 8 }]);
    expect(view.symptoms[0].points).toHaveLength(8);
    expect(view.sleep).toHaveLength(8);
    expect(view.periodDays).toEqual(["2026-10-22"]);
    expect(view.patterns[0]).toMatch(/^Headache averaged 8\/10 on days with under 6 h of sleep/);
    expect(view.recent[0]).toMatchObject({ date: "2026-10-28", symptom: "headache", severity: 2 });
    expect(await t.query(api.journal.view, { since: "2026-10-01" })).toBeNull();
  });
});

describe("journal in chat", () => {
  test("log_symptom is offered and logs from chat; get_symptom_journal reads it back", async () => {
    const t = setup();
    const { calls } = mockApis({
      core: [toolCall("log_symptom", { symptom: "Cramps", severity: 7, note: "worse in the morning" }), { content: "Logged." }],
    });
    const { as } = await createAppUser(t);
    await as.mutation(api.chat.send, { text: "my cramps are a 7 today" });
    await drain(t);
    expect(cortexCalls(calls)[0].body.tools.map((x: any) => x.function.name)).toEqual(expect.arrayContaining(["log_symptom", "get_symptom_journal"]));
    expect(toolResult(calls)).toBe("Logged in the symptom journal: cramp 7/10 on 2026-11-02. The user can see trends in the Journal tab.");
    expect((await entriesOf(t))[0]).toMatchObject({ symptom: "cramp", severity: 7, source: "chat" });

    const second = setup();
    const m = mockApis({ core: [toolCall("get_symptom_journal", { days: 7 }), { content: "ok" }] });
    const u = await createAppUser(second);
    await u.as.mutation(api.journal.add, { symptom: "nausea", severity: 3 });
    await u.as.mutation(api.chat.send, { text: "how has my nausea been?" });
    await drain(second);
    expect(toolResult(m.calls)).toContain("Nausea: logged on 1 day, average 3/10, latest 3/10.");
    expect(toolResult(m.calls)).toContain("2026-11-02: nausea 3/10");
  });

  test("visit summaries include the journal, and deleting the journal empties it", async () => {
    const t = setup();
    const { calls } = mockApis({ core: [{ content: "# Visit summary" }] });
    const { as } = await createAppUser(t);
    await as.mutation(api.journal.add, { symptom: "headache", severity: 6, note: "after work" });
    await as.mutation(api.visit.create, {});
    await drain(t);
    expect(cortexCalls(calls).at(-1)!.body.messages[1].content).toContain("Symptom journal:\nSummary:\nHeadache: logged on 1 day");
    expect((await as.query(api.me.overview))!.counts.journal.n).toBe(1);
    await as.mutation(api.me.deleteData, { category: "journal" });
    await drain(t);
    expect(await entriesOf(t)).toHaveLength(0);
  });
});

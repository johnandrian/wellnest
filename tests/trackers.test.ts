import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api } from "../convex/_generated/api";
import { cleanAsthma, cleanPain, cleanSeizure, entryLine, trackersText } from "../convex/lib/trackers";
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

const rows = (t: ReturnType<typeof setup>) => t.run((ctx) => ctx.db.query("trackerEntries").collect());

describe("tracker helpers", () => {
  test("cleaning keeps known options and plausible numbers", () => {
    expect(cleanPain({ severity: 7.4, locations: ["left_hand", "moon", "left_hand"], types: ["burning"], touchSensitive: true, durationMin: -3 })).toEqual({
      severity: 7, locations: ["left_hand"], types: ["burning"], durationMin: undefined, flare: undefined, swelling: undefined,
      colourChange: undefined, temperatureChange: undefined, touchSensitive: true, triggers: undefined, helped: undefined,
    });
    expect(cleanPain({ locations: [] })).toEqual({ error: "Give the pain a 0-10 score." });
    expect(cleanAsthma({ symptoms: [] })).toEqual({ error: "Log a peak flow, puffs, symptoms or an attack." });
    expect(cleanAsthma({ peakFlow: 2000, reliever: 4, symptoms: ["wheeze"] })).toMatchObject({ peakFlow: undefined, reliever: 4, symptoms: ["wheeze"] });
    expect(cleanSeizure({ type: "made_up", durationSec: 120 })).toMatchObject({ type: undefined, durationSec: 120 });
  });

  test("entry lines and summaries for the model", () => {
    const at = NOW;
    const asthma = { date: "2026-11-02", at, tracker: "asthma" as const, asthma: { peakFlow: 300, reliever: 4, symptoms: ["wheeze"], attack: true } };
    expect(entryLine(asthma, 500)).toBe("ASTHMA ATTACK; peak flow 300 L/min (60% of best); 4 reliever puffs; wheeze");
    const seizure = { date: "2026-11-02", at, tracker: "seizure" as const, seizure: { type: "tonic_clonic", durationSec: 90, rescueMed: true } };
    expect(entryLine(seizure)).toBe("seizure (tonic clonic); 1.5 min; rescue medication taken");
    expect(trackersText([asthma, seizure], 500)).toContain("Asthma: 1 entries, peak flow 300-300 L/min (personal best 500), 4 reliever puffs, 1 attacks.\nSeizures: 1, rescue medication 1 times.");
  });
});

describe("trackers", () => {
  test("several entries a day, by type, with a personal best; only the owner sees or removes them", async () => {
    const t = setup();
    await expect(t.mutation(api.trackers.add, { tracker: "seizure" })).rejects.toThrow(/Not signed in/);
    const { as } = await createAppUser(t);
    const other = await createAppUser(t, "b@example.com");
    await as.mutation(api.trackers.setPeakFlowBest, { value: 500 });
    await expect(as.mutation(api.trackers.setPeakFlowBest, { value: 5 })).rejects.toThrow(/between 50 and 900/);
    await as.mutation(api.trackers.add, { tracker: "pain", pain: { severity: 6, locations: ["lower_back"], types: ["aching"], flare: true } });
    vi.advanceTimersByTime(60_000);
    await as.mutation(api.trackers.add, { tracker: "pain", pain: { severity: 8, locations: ["lower_back"], types: [] } });
    await as.mutation(api.trackers.add, { tracker: "asthma", asthma: { peakFlow: 380, symptoms: ["cough"] } });
    await as.mutation(api.trackers.add, { tracker: "seizure", seizure: { durationSec: 45, witness: "stared, didn't respond" } });
    await expect(as.mutation(api.trackers.add, { tracker: "pain", pain: { severity: 99, locations: [], types: [] } })).rejects.toThrow(/0-10/);

    const view = (await as.query(api.trackers.view, { since: "2026-10-01" }))!;
    expect(view.peakFlowBest).toBe(500);
    expect(view.pain.map((p) => p.severity)).toEqual([8, 6]);
    expect(view.asthma[0]).toMatchObject({ peakFlow: 380, symptoms: ["cough"], date: "2026-11-02" });
    expect(view.seizure[0]).toMatchObject({ durationSec: 45 });
    expect((await other.as.query(api.trackers.view, { since: "2026-10-01" }))!.pain).toEqual([]);
    await expect(other.as.mutation(api.trackers.remove, { id: view.pain[0]._id })).rejects.toThrow(/Not found/);
    await as.mutation(api.trackers.remove, { id: view.pain[0]._id });
    expect(await rows(t)).toHaveLength(3);
  });

  test("pain feeds the journal's charts; deleting the journal removes tracker entries", async () => {
    const t = setup();
    mockApis();
    const { as } = await createAppUser(t);
    await as.mutation(api.trackers.add, { tracker: "pain", pain: { severity: 7, locations: [], types: [] } });
    const journal = (await as.query(api.journal.view, { since: "2026-10-01" }))!;
    expect(journal.symptoms).toMatchObject([{ name: "pain", count: 1, points: [{ date: "2026-11-02", severity: 7 }] }]);
    await as.mutation(api.me.deleteData, { category: "journal" });
    await drain(t);
    expect(await rows(t)).toHaveLength(0);
  });
});

describe("trackers in chat", () => {
  const call = (id: string, name: string, args: object) => ({ content: null, tool_calls: [{ id, type: "function", function: { name, arguments: JSON.stringify(args) } }] });
  const result = (calls: any[], id: string) => cortexCalls(calls).flatMap((c) => c.body.messages).find((m: any) => m.tool_call_id === id)?.content;

  test("log_condition_event logs from what the user says; the journal read and visit summaries include it", async () => {
    const t = setup();
    const { calls } = mockApis({
      core: [
        call("s1", "log_condition_event", { tracker: "seizure", seizure_type: "focal_impaired", duration_seconds: 120, rescue_med: true, witness: "my partner said I was chewing" }),
        { content: "Logged it." },
        call("s2", "get_symptom_journal", { days: 7 }),
        { content: "ok" },
        { content: "# Visit summary" },
      ],
    });
    const { as } = await createAppUser(t);
    await as.mutation(api.chat.send, { text: "had a seizure this morning, about 2 minutes, took my rescue med, my partner said I was chewing" });
    await drain(t);
    expect(result(calls, "s1")).toBe("Logged a seizure entry for 2026-11-02. The user can see it in the Journal tab.");
    expect((await rows(t))[0]).toMatchObject({ tracker: "seizure", source: "chat", seizure: { type: "focal_impaired", durationSec: 120, rescueMed: true } });
    await as.mutation(api.chat.send, { text: "how have my seizures been?" });
    await drain(t);
    expect(result(calls, "s2")).toContain("Condition trackers:\nSeizures: 1, rescue medication 1 times.\n2026-11-02: seizure (focal impaired); 2 min; rescue medication taken; witness: my partner said I was chewing");
    await as.mutation(api.visit.create, {});
    await drain(t);
    expect(cortexCalls(calls).at(-1)!.body.messages[1].content).toContain("Condition trackers:\nSeizures: 1");
  });

  test("a pain entry without a score is refused", async () => {
    const t = setup();
    const { calls } = mockApis({ core: [call("p1", "log_condition_event", { tracker: "pain", locations: ["head"] }), { content: "?" }] });
    const { as } = await createAppUser(t);
    await as.mutation(api.chat.send, { text: "my head hurts" });
    await drain(t);
    expect(result(calls, "p1")).toBe("Tool error: Give the pain a 0-10 score.");
  });
});

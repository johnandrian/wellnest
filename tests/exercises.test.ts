import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api } from "../convex/_generated/api";
import { Id } from "../convex/_generated/dataModel";
import { scheduledOn } from "../convex/exercises";
import { exercisePatterns } from "../convex/lib/journal";
import { cortexCalls, createAppUser, drain, mockApis, setEnv, setup } from "./helpers";

// Monday 2026-11-02, 13:00 in Los Angeles.
const NOW = Date.parse("2026-11-02T21:00:00Z");
const DAY = 86_400_000;

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

describe("exercise helpers", () => {
  test("scheduled days and patterns", () => {
    const ex = { days: [1, 3, 5], _creationTime: Date.parse("2026-10-01T00:00:00Z") };
    expect(scheduledOn(ex, "2026-11-02")).toBe(true); // Monday
    expect(scheduledOn(ex, "2026-11-03")).toBe(false);
    expect(scheduledOn({ days: [], _creationTime: NOW }, "2026-11-01")).toBe(false); // before it was added
    const entries = ["01", "02", "03", "04", "05", "06"].map((d, i) => ({ date: `2026-10-${d}`, symptom: "back pain", severity: i < 3 ? 3 : 7 }));
    expect(exercisePatterns(entries, ["2026-10-01", "2026-10-02", "2026-10-03"], ["2026-10-04", "2026-10-05", "2026-10-06"])).toEqual([
      "Back pain averaged 3/10 on days you did your exercises (3 days) vs 7/10 on days you missed them (3 days).",
    ]);
  });
});

describe("exercises", () => {
  test("add, tick off today, see the last 14 days, stop; only the owner", async () => {
    const t = setup();
    await expect(t.mutation(api.exercises.add, { name: "x" })).rejects.toThrow(/Not signed in/);
    const { as } = await createAppUser(t);
    const other = await createAppUser(t, "b@example.com");
    await as.mutation(api.chat.setTimeZone, { timeZone: "America/Los_Angeles", utcOffsetMin: -480 });
    const id = (await as.mutation(api.exercises.add, { name: "Bridges", sets: 3, reps: 12, days: [1, 3, 5, 9] })) as Id<"exercises">;
    await as.mutation(api.exercises.add, { name: "Walk", minutes: 20 });
    await as.mutation(api.exercises.toggle, { id, date: "2026-11-02", done: true });
    await expect(as.mutation(api.exercises.toggle, { id, date: "2026-11-09", done: true })).rejects.toThrow(/today or an earlier day/);
    await expect(other.as.mutation(api.exercises.toggle, { id, date: "2026-11-02", done: true })).rejects.toThrow(/Not found/);
    const list = (await as.query(api.exercises.list, { date: "2026-11-02" }))!;
    expect(list.map((e) => [e.name, e.days, e.dueToday, e.doneToday])).toEqual([
      ["Bridges", [1, 3, 5], true, true],
      ["Walk", [], true, false],
    ]);
    expect(list[0].last14.at(-1)).toEqual({ date: "2026-11-02", scheduled: true, done: true });
    await as.mutation(api.exercises.toggle, { id, date: "2026-11-02", done: false });
    await as.mutation(api.exercises.stop, { id });
    expect((await as.query(api.exercises.list, { date: "2026-11-02" }))!.map((e) => e.name)).toEqual(["Walk"]);
  });

  test("the model adds and ticks off exercises; the journal read and visit summaries show adherence", async () => {
    const t = setup();
    const call = (id: string, name: string, args: object) => ({ content: null, tool_calls: [{ id, type: "function", function: { name, arguments: JSON.stringify(args) } }] });
    const { calls } = mockApis({
      core: [
        call("e1", "add_exercise", { name: "Calf stretch", sets: 2, reps: 10 }),
        { content: "Added." },
        call("e2", "log_exercise_done", { name: "calf" }),
        { content: "Nice." },
        call("e3", "get_symptom_journal", { days: 3 }),
        { content: "ok" },
      ],
    });
    const { as } = await createAppUser(t);
    await as.mutation(api.chat.send, { text: "physio gave me calf stretches, 2 sets of 10" });
    await drain(t);
    await as.mutation(api.chat.send, { text: "did my calf stretches" });
    await drain(t);
    await as.mutation(api.chat.send, { text: "how am I doing with physio?" });
    await drain(t);
    const result = (id: string) => cortexCalls(calls).flatMap((c) => c.body.messages).find((m: any) => m.tool_call_id === id)?.content;
    expect(result("e1")).toMatch(/^Added "Calf stretch"/);
    expect(result("e2")).toBe("Marked done for 2026-11-02: Calf stretch.");
    expect(result("e3")).toContain("Exercises:\n- Calf stretch (2x10): done 1 of 1 scheduled days");
  });

  test("deleting the journal removes exercises and their log", async () => {
    const t = setup();
    mockApis();
    const { as } = await createAppUser(t);
    const id = (await as.mutation(api.exercises.add, { name: "Walk" })) as Id<"exercises">;
    await as.mutation(api.exercises.toggle, { id, date: "2026-11-02", done: true });
    vi.setSystemTime(NOW + DAY);
    await as.mutation(api.me.deleteData, { category: "journal" });
    await drain(t);
    expect(await t.run((ctx) => ctx.db.query("exercises").collect())).toHaveLength(0);
    expect(await t.run((ctx) => ctx.db.query("exerciseLogs").collect())).toHaveLength(0);
  });
});

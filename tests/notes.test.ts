// Journal notes (convex/journal.ts addNote): kept as written, and the symptoms in them logged by the model.
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api } from "../convex/_generated/api";
import { parseNoteSymptoms } from "../convex/journal";
import { cortexCalls, createAppUser, drain, mockApis, setEnv, setup } from "./helpers";

const NOW = Date.UTC(2026, 10, 20, 15, 0);
const TODAY = "2026-11-20";

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

describe("journal notes", () => {
  test("a note is kept with its time, and the symptoms in it are logged from it", async () => {
    const t = setup();
    const { calls } = mockApis({ core: [{ content: '```json\n[{"symptom": "Headaches", "severity": 6}, {"symptom": "nausea"}]\n```' }] });
    const { userId, as } = await createAppUser(t);
    await as.mutation(api.journal.addNote, { text: "Bad headache since lunch, about a 6. A bit queasy too." });
    expect((await as.query(api.journal.notes, { since: TODAY }))[0]).toMatchObject({ date: TODAY, at: expect.closeTo(NOW, -2), logged: null });
    await drain(t);
    expect(cortexCalls(calls)[0].body.messages[1].content).toBe("Bad headache since lunch, about a 6. A bit queasy too.");
    const [note] = await as.query(api.journal.notes, { since: TODAY });
    expect(note.logged).toEqual([{ symptom: "headache", severity: 6 }, { symptom: "nausea" }]);
    const entries = await t.run((ctx) => ctx.db.query("symptomEntries").withIndex("by_user_and_date", (q) => q.eq("userId", userId)).collect());
    expect(entries.map((e) => [e.symptom, e.severity, e.source])).toEqual([
      ["headache", 6, "note"],
      ["nausea", undefined, "note"],
    ]);
  });

  test("a note sent later from the offline queue keeps when it was written; an unreadable answer logs nothing", async () => {
    const t = setup();
    mockApis({ core: [{ content: "Sorry, I can't." }] });
    const { userId, as } = await createAppUser(t);
    await as.mutation(api.journal.addNote, { text: "Tired.", at: NOW - 86_400_000 });
    await drain(t);
    const [note] = await as.query(api.journal.notes, { since: "2026-11-01" });
    expect(note).toMatchObject({ date: "2026-11-19", logged: [] });
    expect(await t.run((ctx) => ctx.db.query("symptomEntries").withIndex("by_user_and_date", (q) => q.eq("userId", userId)).collect())).toEqual([]);
    await expect(as.mutation(api.journal.addNote, { text: "   " })).rejects.toThrow(/Write something/);
  });

  test("only the writer can remove a note, and clearing the journal clears notes", async () => {
    const t = setup();
    mockApis({ core: [{ content: "[]" }] });
    const { as } = await createAppUser(t);
    const other = await createAppUser(t, "b@example.com");
    const id = await as.mutation(api.journal.addNote, { text: "Slept well." });
    await drain(t);
    expect(await other.as.query(api.journal.notes, { since: TODAY })).toEqual([]);
    await expect(other.as.mutation(api.journal.removeNote, { id })).rejects.toThrow(/Not found/);
    await as.mutation(api.journal.removeNote, { id });
    expect(await as.query(api.journal.notes, { since: TODAY })).toEqual([]);
    await as.mutation(api.journal.addNote, { text: "Knee hurt on the stairs." });
    expect((await as.query(api.me.overview))!.counts.journal.n).toBe(1);
    await as.mutation(api.me.deleteData, { category: "journal" });
    await drain(t);
    expect(await as.query(api.journal.notes, { since: TODAY })).toEqual([]);
  });

  test("the model's answer is cleaned: names normalized, repeats dropped, severity kept in range", () => {
    expect(parseNoteSymptoms('Here: [{"symptom":"Back pain","severity":12},{"symptom":"back pain"},{"symptom":""},{"x":1}]')).toEqual([{ symptom: "back pain", severity: 10 }]);
    expect(parseNoteSymptoms("none")).toEqual([]);
    expect(parseNoteSymptoms(null)).toEqual([]);
  });
});

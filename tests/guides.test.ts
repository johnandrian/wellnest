import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api } from "../convex/_generated/api";
import { Id } from "../convex/_generated/dataModel";
import { snippetOf } from "../convex/chats";
import { createAppUser, drain, mockApis, setEnv, setup } from "./helpers";

// 10:00 in Los Angeles.
const NOW = Date.parse("2026-11-02T18:00:00Z");
const H = 3_600_000;

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

describe("chat history search", () => {
  test("finds chats by what was said in them, newest match per chat, only the user's own", async () => {
    const t = setup();
    mockApis();
    const { as } = await createAppUser(t);
    const other = await createAppUser(t, "b@example.com");
    await as.mutation(api.chat.send, { text: "My knee hurts after running" });
    await drain(t);
    expect(await as.query(api.chats.search, { text: "knee" })).toMatchObject([{ _id: null, current: true, snippet: "My knee hurts after running" }]);

    await as.mutation(api.chats.start, {});
    vi.advanceTimersByTime(60_000);
    await as.mutation(api.chat.send, { text: "Any sleep tips for a sore knee?" });
    await drain(t);
    const found = await as.query(api.chats.search, { text: "knee" });
    expect(found).toHaveLength(2);
    expect(found.map((c) => c.title).sort()).toEqual(["Any sleep tips for a sore knee?", "My knee hurts after running"]);
    expect(found.every((c) => c._id !== null)).toBe(true);

    expect(await as.query(api.chats.search, { text: "k" })).toEqual([]);
    await other.as.mutation(api.chat.send, { text: "knee knee knee" });
    await drain(t);
    expect(await as.query(api.chats.search, { text: "knee" })).toHaveLength(2);
    expect(await other.as.query(api.chats.search, { text: "knee" })).toHaveLength(1);
  });

  test("the snippet is the words around the match", () => {
    const long = `${"a ".repeat(40)}the **knee** started hurting ${"b ".repeat(60)}`;
    const snip = snippetOf(long, "knee");
    expect(snip.startsWith("…")).toBe(true);
    expect(snip.endsWith("…")).toBe(true);
    expect(snip).toContain("the knee started hurting");
  });
});

describe("editing medications from account setup", () => {
  test("setup lists the medications with their dose and times; name, dose, times and directions can change", async () => {
    const t = setup();
    const { as } = await createAppUser(t);
    await as.mutation(api.chat.setTimeZone, { timeZone: "America/Los_Angeles", utcOffsetMin: -480 });
    const id = (await as.mutation(api.reminders.add, { name: "Metformn", dose: "500 mg", directions: "with food", schedule: { kind: "daily", times: ["08:00"] } })) as Id<"medications">;
    expect((await as.query(api.onboarding.state))!.meds).toEqual([{ _id: id, name: "Metformn", dose: "500 mg", times: ["08:00"] }]);

    await as.mutation(api.medications.update, { id, name: "Metformin", dose: "2 tablets", times: ["20:00", "09:00"], directions: " with dinner " });
    const med = (await as.query(api.medications.detail, { id }))!;
    expect(med).toMatchObject({ name: "Metformin", dose: "2 tablets", directions: "with dinner", rule: { kind: "daily", times: ["09:00", "20:00"] } });
    // The next reminder follows the new times: 20:00 today in Los Angeles.
    const [row] = await as.query(api.medications.all);
    expect(row.nextAt).toBe(Date.parse("2026-11-03T04:00:00Z"));
    expect(row).toMatchObject({ directions: "with dinner", notes: null, form: null });
    expect(med.events.map((e) => e.kind)).toEqual(["dose_changed", "started"]);

    await expect(as.mutation(api.medications.update, { id, name: "  " })).rejects.toThrow(/name/);
    await expect(as.mutation(api.medications.update, { id, times: ["25:00"] })).rejects.toThrow();
    const other = await createAppUser(t, "b@example.com");
    await expect(other.as.mutation(api.medications.update, { id, name: "Mine now" })).rejects.toThrow(/Not found/);
  });
});

describe("appointment prep checklist", () => {
  test("ticks are kept on the appointment, only by its owner", async () => {
    const t = setup();
    const { as } = await createAppUser(t);
    const id = (await as.mutation(api.visits.add, { title: "Rheumatology", startsAt: NOW + 48 * H })) as Id<"visits">;
    await as.mutation(api.visits.setChecked, { id, item: "s0.1", on: true });
    await as.mutation(api.visits.setChecked, { id, item: "s1.0", on: true });
    await as.mutation(api.visits.setChecked, { id, item: "s0.1", on: true });
    expect((await as.query(api.visits.list, { now: NOW }))!.upcoming[0].checked).toEqual(["s0.1", "s1.0"]);
    await as.mutation(api.visits.setChecked, { id, item: "s0.1", on: false });
    expect((await as.query(api.visits.list, { now: NOW }))!.upcoming[0].checked).toEqual(["s1.0"]);

    const other = await createAppUser(t, "b@example.com");
    await expect(other.as.mutation(api.visits.setChecked, { id, item: "s2.0", on: true })).rejects.toThrow();
  });

  test("the dashboard shows the next appointment with its questions", async () => {
    const t = setup();
    const { as } = await createAppUser(t);
    const id = (await as.mutation(api.visits.add, { title: "GP", startsAt: NOW + 24 * H })) as Id<"visits">;
    await t.run((ctx) => ctx.db.patch(id, { questions: ["Why are my headaches more often?"] }));
    const view = (await as.query(api.dashboard.view, { today: "2026-11-02", now: NOW }))!;
    expect(view.visit).toMatchObject({ _id: id, title: "GP", questions: ["Why are my headaches more often?"] });
  });
});

describe("first-time tour", () => {
  test("not seen until it's finished or skipped", async () => {
    const t = setup();
    const { as } = await createAppUser(t);
    expect((await as.query(api.chat.me))!.toured).toBe(false);
    await as.mutation(api.onboarding.tourDone, {});
    expect((await as.query(api.chat.me))!.toured).toBe(true);
    await expect(t.mutation(api.onboarding.tourDone, {})).rejects.toThrow();
  });
});

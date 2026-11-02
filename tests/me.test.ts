import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api } from "../convex/_generated/api";
import { cortexCalls, createAppUser, drain, messagesOf, mockApis, setEnv, setup } from "./helpers";

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

const toolCall = (name: string, args: object) => ({
  content: null,
  tool_calls: [{ id: "f1", type: "function", function: { name, arguments: JSON.stringify(args) } }],
});
const toolResult = (calls: any[]) =>
  cortexCalls(calls).flatMap((c) => c.body.messages).find((m: any) => m.role === "tool" && m.tool_call_id === "f1")?.content as string;

// Runs what's due now without running the recurring reminder (see reminders.test.ts).
const settle = (t: ReturnType<typeof setup>) => t.finishAllScheduledFunctions(() => vi.advanceTimersByTime(1));

// Some of everything for one user.
async function fill(t: ReturnType<typeof setup>, as: any, userId: any) {
  await as.mutation(api.chat.setTimeZone, { timeZone: "America/Los_Angeles", utcOffsetMin: -480 });
  await as.mutation(api.me.addFact, { text: "Allergic to penicillin" });
  await as.mutation(api.health.sync, { days: [{ date: "2026-11-01", metrics: { steps: 5000 } }] });
  await as.mutation(api.reminders.add, { name: "Zinc", schedule: { kind: "daily", times: ["20:00"] } });
  const photo = await t.run((ctx) => ctx.storage.store(new Blob(["img"], { type: "image/png" })));
  await t.run(async (ctx) => {
    await ctx.db.insert("messages", { userId, role: "user", text: "hello", channel: "app", image: photo });
    await ctx.db.insert("messages", { userId, role: "assistant", text: "hi", channel: "app" });
    await ctx.db.insert("visitSummaries", { userId, days: 30, status: "ready", text: "# Visit summary" });
    await ctx.db.insert("creaoRuns", { userId, channel: "app", inputs: { symptoms: "x" }, status: "completed", polls: 0, delivered: true });
  });
  return photo;
}

describe("saved facts", () => {
  test("the user can add, edit and remove facts; duplicates are ignored; others can't touch them", async () => {
    const t = setup();
    const { as } = await createAppUser(t);
    await as.mutation(api.me.addFact, { text: "  Allergic   to penicillin " });
    await as.mutation(api.me.addFact, { text: "allergic to penicillin" });
    let facts = (await as.query(api.me.overview))!.facts;
    expect(facts.map((f) => [f.text, f.source])).toEqual([["Allergic to penicillin", "user"]]);

    await as.mutation(api.me.updateFact, { id: facts[0]._id, text: "Allergic to penicillin (hives)" });
    facts = (await as.query(api.me.overview))!.facts;
    expect(facts[0].text).toBe("Allergic to penicillin (hives)");

    const other = await createAppUser(t, "b@example.com");
    await expect(other.as.mutation(api.me.deleteFact, { id: facts[0]._id })).rejects.toThrow(/Not found/);
    expect((await other.as.query(api.me.overview))!.facts).toEqual([]);

    await as.mutation(api.me.deleteFact, { id: facts[0]._id });
    expect((await as.query(api.me.overview))!.facts).toEqual([]);
    await expect(as.mutation(api.me.addFact, { text: "  " })).rejects.toThrow(/empty/);
  });

  test("caps at 50 facts", async () => {
    const t = setup();
    const { as } = await createAppUser(t);
    for (let i = 0; i < 50; i++) await as.mutation(api.me.addFact, { text: `fact ${i}` });
    await expect(as.mutation(api.me.addFact, { text: "one more" })).rejects.toThrow(/up to 50/);
  });

  test("the model saves facts with remember_fact and sees them on every turn", async () => {
    const t = setup();
    const { calls } = mockApis({ core: [toolCall("remember_fact", { fact: "Has type 1 diabetes" }), { content: "Noted." }, { content: "ok" }] });
    const { as } = await createAppUser(t);
    await as.mutation(api.chat.send, { text: "I have type 1 diabetes" });
    await drain(t);
    expect(toolResult(calls)).toMatch(/^Saved\./);
    expect((await as.query(api.me.overview))!.facts).toMatchObject([{ text: "Has type 1 diabetes", source: "assistant" }]);
    expect(cortexCalls(calls)[0].body.messages[0].content).toContain("No saved facts about the user yet");

    await as.mutation(api.chat.send, { text: "can I eat cake" });
    await drain(t);
    expect(cortexCalls(calls).at(-1)!.body.messages[0].content).toContain("Saved facts about the user");
    expect(cortexCalls(calls).at(-1)!.body.messages[0].content).toContain("- Has type 1 diabetes");
  });

  test("forget_fact removes matching facts, and says what's saved when nothing matches", async () => {
    const t = setup();
    const { calls } = mockApis({ core: [toolCall("forget_fact", { fact: "penicillin" }), { content: "Done." }] });
    const { as } = await createAppUser(t);
    await as.mutation(api.me.addFact, { text: "Allergic to penicillin" });
    await as.mutation(api.me.addFact, { text: "Has asthma" });
    await as.mutation(api.chat.send, { text: "I'm not actually allergic to penicillin" });
    await drain(t);
    expect(toolResult(calls)).toBe("Forgot: Allergic to penicillin.");
    expect((await as.query(api.me.overview))!.facts.map((f) => f.text)).toEqual(["Has asthma"]);

    const second = setup();
    const m = mockApis({ core: [toolCall("forget_fact", { fact: "migraines" }), { content: "Hmm." }] });
    const u = await createAppUser(second);
    await u.as.mutation(api.me.addFact, { text: "Has asthma" });
    await u.as.mutation(api.chat.send, { text: "forget the migraines thing" });
    await drain(second);
    expect(toolResult(m.calls)).toBe('Tool error: no saved fact matches "migraines". Saved facts: Has asthma.');
  });

  test("visit summaries include saved facts", async () => {
    const t = setup();
    const { calls } = mockApis({ core: [{ content: "# Visit summary" }] });
    const { as } = await createAppUser(t);
    await as.mutation(api.me.addFact, { text: "Allergic to penicillin" });
    await as.mutation(api.visit.create, {});
    await drain(t);
    expect(cortexCalls(calls).at(-1)!.body.messages[1].content).toContain("Facts the patient saved in Wellnest:\n- Allergic to penicillin");
  });
});

describe("overview, export and deletion", () => {
  test("overview counts what's stored for this user only", async () => {
    const t = setup();
    mockApis();
    const { userId, as } = await createAppUser(t);
    await fill(t, as, userId);
    const other = await createAppUser(t, "b@example.com");
    const o = (await as.query(api.me.overview))!;
    expect(o.profile).toMatchObject({ email: "a@example.com", timeZone: "America/Los_Angeles", healthConnected: true, language: "en" });
    expect(o.counts).toEqual({
      messages: { n: 2, more: false },
      photos: { n: 1, more: false },
      healthDays: { n: 1, more: false },
      reminders: { n: 1, more: false },
      doses: { n: 0, more: false },
      summaries: { n: 1, more: false },
      analyses: { n: 1, more: false },
      journal: { n: 0, more: false },
      visits: { n: 0, more: false },
      careTeam: { n: 0, more: false },
    });
    expect((await other.as.query(api.me.overview))!.counts.messages.n).toBe(0);
    expect(await t.query(api.me.overview)).toBeNull();
  });

  test("export has everything without embeddings or job ids", async () => {
    const t = setup();
    const { calls } = mockApis();
    const { userId, as } = await createAppUser(t);
    await fill(t, as, userId);
    await as.mutation(api.chat.send, { text: "embed me" });
    await settle(t);
    void calls;
    const data = JSON.parse(await as.action(api.me.exportData, {}));
    expect(data.profile.email).toBe("a@example.com");
    expect(data.messages.map((m: any) => m.text)).toEqual(["hello", "hi", "embed me", "Rest and drink water."]);
    expect(JSON.stringify(data)).not.toContain('"embedding"');
    expect(data.medications[0]).not.toHaveProperty("jobId");
    expect(data.facts.map((f: any) => f.text)).toEqual(["Allergic to penicillin"]);
    expect(data.healthDays).toHaveLength(1);
    expect(data.visitSummaries).toHaveLength(1);
    expect(data.symptomAnalyses).toHaveLength(1);
    await expect(t.action(api.me.exportData, {})).rejects.toThrow(/Not signed in/);
  });

  test("deleting one category leaves the rest", async () => {
    const t = setup();
    mockApis();
    const { userId, as } = await createAppUser(t);
    const photo = await fill(t, as, userId);
    await as.mutation(api.me.deleteData, { category: "chat" });
    await settle(t);
    expect(await messagesOf(t, userId)).toHaveLength(0);
    expect(await t.run((ctx) => ctx.storage.get(photo))).toBeNull();
    const o = (await as.query(api.me.overview))!;
    expect(o.counts.analyses.n).toBe(0);
    expect(o.counts.reminders.n).toBe(1);
    expect(o.facts).toHaveLength(1);

    await as.mutation(api.me.deleteData, { category: "reminders" });
    await settle(t);
    expect((await as.query(api.me.overview))!.counts.reminders.n).toBe(0);
    // The reminder's scheduled job was cancelled: nothing posts at 20:00.
    vi.advanceTimersByTime(24 * 3_600_000);
    await settle(t);
    expect(await messagesOf(t, userId)).toHaveLength(0);
  });

  test("delete everything removes all of the user's rows, auth and the user, and nobody else's", async () => {
    const t = setup();
    mockApis();
    const { userId, as } = await createAppUser(t);
    await fill(t, as, userId);
    const other = await createAppUser(t, "b@example.com");
    await other.as.mutation(api.me.addFact, { text: "Other's fact" });

    await as.mutation(api.me.deleteData, { category: "everything" });
    expect(await as.query(api.chat.me)).toBeNull(); // hidden right away
    await settle(t);

    const left = await t.run(async (ctx) => {
      const tables = ["messages", "healthDays", "medications", "doseLogs", "visitSummaries", "creaoRuns", "memoryFacts", "photoUploads", "authSessions"] as const;
      const out: Record<string, number> = {};
      for (const table of tables) out[table] = (await ctx.db.query(table).collect()).filter((r: any) => (r.userId ?? null) === userId).length;
      return { ...out, user: (await ctx.db.get(userId)) ? 1 : 0 };
    });
    expect(Object.values(left).every((n) => n === 0)).toBe(true);
    expect((await other.as.query(api.me.overview))!.facts.map((f) => f.text)).toEqual(["Other's fact"]);
  });

  test("deletion needs sign-in", async () => {
    const t = setup();
    await expect(t.mutation(api.me.deleteData, { category: "everything" })).rejects.toThrow(/Not signed in/);
  });
});

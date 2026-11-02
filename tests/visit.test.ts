import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "../convex/_generated/api";
import { DAILY_SUMMARIES } from "../convex/visit";
import { transcript } from "../convex/lib/visit";
import { markdownToHtml } from "../src/printable";
import { cortexCalls, createAppUser, drain, messagesOf, mockApis, setEnv, setup, telegramSends } from "./helpers";

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

const SUMMARY = "# Visit summary\nHeadaches for three weeks.\n## Main concerns\n- Daily headaches";

// The summary model call: its system prompt is the visit prompt.
const visitCalls = (calls: any[]) =>
  cortexCalls(calls).filter((c) => c.body.messages[0].content.startsWith("You prepare a one-page summary"));

async function seed(t: ReturnType<typeof setup>, userId: any) {
  await t.run(async (ctx) => {
    await ctx.db.insert("messages", { userId, role: "user", text: "I've had headaches every afternoon", channel: "app" });
    await ctx.db.insert("messages", { userId, role: "assistant", text: "Here are some links", channel: "app", kind: "links" });
    await ctx.db.insert("creaoRuns", {
      userId, channel: "app", inputs: { symptoms: "headache" }, status: "completed", polls: 1, delivered: true,
      report: "Most likely: tension-type headache.",
    });
  });
}

describe("visit summary", () => {
  test("needs sign-in", async () => {
    const t = setup();
    await expect(t.mutation(api.visit.create, {})).rejects.toThrow(/Not signed in/);
    expect(await t.query(api.visit.latest)).toBeNull();
  });

  test("writes a summary from the chat, analyses and Apple Health, without store links", async () => {
    const t = setup();
    const { calls } = mockApis({ core: [{ content: SUMMARY }] });
    const { userId, as } = await createAppUser(t);
    await seed(t, userId);
    await as.mutation(api.health.sync, { days: [{ date: "2026-11-01", metrics: { sleepHours: 5.5, restingHeartRate: 64 } }] });

    await as.mutation(api.visit.create, { reason: "  recurring headaches ", days: 14 });
    expect(await as.query(api.visit.latest)).toMatchObject({ status: "generating", reason: "recurring headaches", days: 14 });
    await drain(t);

    expect(await as.query(api.visit.latest)).toMatchObject({ status: "ready", text: SUMMARY });
    const material: string = visitCalls(calls)[0].body.messages[1].content;
    expect(material).toContain("Reason for the visit: recurring headaches");
    expect(material).toContain("Period covered: the last 14 days.");
    expect(material).toContain("[2026-11-02] Patient: I've had headaches every afternoon");
    expect(material).not.toContain("Here are some links");
    expect(material).toContain("Earlier AI symptom analysis (2026-11-02):\nMost likely: tension-type headache.");
    expect(material).toContain("2026-11-01: resting HR 64 bpm · sleep 5.5 h");
    // Made from the app: nothing is added to the chat.
    expect(await messagesOf(t, userId)).toHaveLength(2);
  });

  test("leaves out messages hidden by Clear chat and other users' data", async () => {
    const t = setup();
    const { calls } = mockApis({ core: [{ content: SUMMARY }] });
    const { userId, as } = await createAppUser(t);
    const other = await createAppUser(t, "b@example.com");
    await t.run((ctx) => ctx.db.insert("messages", { userId, role: "user", text: "old cleared secret", channel: "app" }));
    await t.run((ctx) => ctx.db.insert("messages", { userId: other.userId, role: "user", text: "someone else", channel: "app" }));
    vi.advanceTimersByTime(1000);
    await as.mutation(api.chat.clear);
    vi.advanceTimersByTime(1000);
    await t.run((ctx) => ctx.db.insert("messages", { userId, role: "user", text: "new knee pain", channel: "app" }));

    await as.mutation(api.visit.create, {});
    await drain(t);
    const material: string = visitCalls(calls)[0].body.messages[1].content;
    expect(material).toContain("new knee pain");
    expect(material).not.toContain("old cleared secret");
    expect(material).not.toContain("someone else");
    expect(material).not.toContain("Apple Health"); // not connected
  });

  test("a failed model call marks it failed", async () => {
    const t = setup();
    mockApis({ core: [new Error("overloaded")] });
    const { as } = await createAppUser(t);
    await as.mutation(api.visit.create, {});
    await drain(t);
    expect(await as.query(api.visit.latest)).toMatchObject({ status: "failed" });
  });

  test("one at a time, and a daily cap", async () => {
    const t = setup();
    mockApis({ core: Array(10).fill({ content: SUMMARY }) });
    const { as } = await createAppUser(t);
    await as.mutation(api.visit.create, {});
    await expect(as.mutation(api.visit.create, {})).rejects.toThrow(/already being written/);
    await drain(t);
    for (let i = 1; i < DAILY_SUMMARIES; i++) {
      await as.mutation(api.visit.create, {});
      await drain(t);
    }
    await expect(as.mutation(api.visit.create, {})).rejects.toThrow(/today's 5 visit summaries/);
  });

  test("only the owner can delete it", async () => {
    const t = setup();
    mockApis({ core: [{ content: SUMMARY }] });
    const a = await createAppUser(t, "a@example.com");
    const b = await createAppUser(t, "b@example.com");
    const id = await a.as.mutation(api.visit.create, {});
    await drain(t);
    await expect(b.as.mutation(api.visit.remove, { id })).rejects.toThrow(/Not found/);
    await a.as.mutation(api.visit.remove, { id });
    expect(await a.as.query(api.visit.latest)).toBeNull();
  });
});

describe("prepare_visit_summary tool", () => {
  const toolCall = (args: object) => ({
    content: null,
    tool_calls: [{ id: "v1", type: "function", function: { name: "prepare_visit_summary", arguments: JSON.stringify(args) } }],
  });

  test("in the app: starts the summary and posts a note when it's ready", async () => {
    const t = setup();
    const { calls } = mockApis({
      core: [toolCall({ reason: "headaches", days: 30 }), { content: "I'm writing it now." }, { content: SUMMARY }],
    });
    const { userId, as } = await createAppUser(t);
    await as.mutation(api.chat.send, { text: "prepare me for my doctor's appointment about headaches" });
    await drain(t);

    expect(cortexCalls(calls)[0].body.tools.map((x: any) => x.function.name)).toContain("prepare_visit_summary");
    expect(await as.query(api.visit.latest)).toMatchObject({ status: "ready", reason: "headaches", days: 30, text: SUMMARY });
    const texts = (await messagesOf(t, userId)).map((m) => m.text);
    expect(texts).toEqual([
      "prepare me for my doctor's appointment about headaches",
      "I'm writing it now.",
      expect.stringContaining("Your visit summary is ready"),
    ]);
  });

  test("on Telegram: the summary itself is sent as a message", async () => {
    const t = setup();
    const { calls } = mockApis({ core: [toolCall({}), { content: "Writing it now." }, { content: SUMMARY }] });
    const userId = await t.run((ctx) => ctx.db.insert("users", { telegramChatId: "42" }));
    await t.run((ctx) => ctx.db.insert("messages", { userId, role: "user", text: "summary for my doctor please", channel: "telegram" }));
    const messageId = (await messagesOf(t, userId))[0]._id;
    await t.action(internal.pipeline.respond, { messageId });
    await drain(t);
    const sent = telegramSends(calls).map((c) => c.body.text).join("\n");
    expect(sent).toContain("Visit summary");
    expect(sent).toContain("Daily headaches");
  });
});

describe("visit formatting", () => {
  test("transcript keeps the newest lines when it's too long", () => {
    const messages = Array.from({ length: 100 }, (_, i) => ({ role: "user" as const, text: `${i} ${"x".repeat(700)}`, at: NOW }));
    const text = transcript(messages);
    expect(text.length).toBeLessThanOrEqual(24_000);
    expect(text).toContain("Patient: 99 ");
    expect(text).not.toContain("Patient: 0 ");
  });

  test("printable HTML escapes text and keeps structure", () => {
    expect(markdownToHtml("# Title <b>\n- **one**\n- two\n\nplain *it*")).toBe(
      "<h1>Title &lt;b&gt;</h1>\n<ul>\n<li><strong>one</strong></li>\n<li>two</li>\n</ul>\n<p>plain <em>it</em></p>",
    );
  });
});

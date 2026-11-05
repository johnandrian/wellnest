// Doctor-visit summaries: a one-page Markdown summary of the user's recent chats, analyses and Apple Health data,
// to bring to an appointment. Made from the app (Visit summary panel) or by asking in chat (prepare_visit_summary).
import { v } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";
import { internalAction, internalMutation, internalQuery, mutation, MutationCtx, query } from "./_generated/server";
import { internal } from "./_generated/api";
import { Id } from "./_generated/dataModel";
import { complete, CORE_MODEL } from "./lib/cortex";
import { dateDaysAgo, healthReport } from "./lib/health";
import { DEFAULT_VISIT_DAYS, VISIT_PROMPT, visitMaterial } from "./lib/visit";
import { journalText } from "./lib/journal";
import { painAsEntries, trackersText } from "./lib/trackers";
import { saveAssistantReply } from "./pipeline";
import { channel } from "./schema";
import { LANGUAGES, langOf, t } from "./lib/language";

export const DAILY_SUMMARIES = 5;
const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_MESSAGES = 300;

type Requested = { id: Id<"visitSummaries"> } | { error: string };

// Shared by the app's button and the chat tool: checks the daily cap, stores a "generating" row, starts the model.
async function requestSummary(
  ctx: MutationCtx,
  userId: Id<"users">,
  opts: { reason?: string; days?: number; notify?: "app" | "telegram" },
): Promise<Requested> {
  const today = await ctx.db
    .query("visitSummaries")
    .withIndex("by_user", (q) => q.eq("userId", userId).gte("_creationTime", Date.now() - DAY_MS))
    .take(DAILY_SUMMARIES + 1);
  if (today.some((s) => s.status === "generating")) return { error: "A visit summary is already being written." };
  if (today.length >= DAILY_SUMMARIES) return { error: `You've made today's ${DAILY_SUMMARIES} visit summaries. Try again tomorrow.` };
  const days = Math.min(90, Math.max(1, Math.round(opts.days ?? DEFAULT_VISIT_DAYS)));
  const reason = opts.reason?.trim().slice(0, 300) || undefined;
  const id = await ctx.db.insert("visitSummaries", { userId, reason, days, status: "generating", notify: opts.notify });
  await ctx.scheduler.runAfter(0, internal.visit.generate, { id });
  return { id };
}

export const create = mutation({
  args: { reason: v.optional(v.string()), days: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not signed in");
    const res = await requestSummary(ctx, userId, args);
    if ("error" in res) throw new Error(res.error);
    return res.id;
  },
});

// From the chat tool: the finished summary is announced in the chat (in full on Telegram, where there's no panel).
export const request = internalMutation({
  args: { userId: v.id("users"), channel, reason: v.optional(v.string()), days: v.optional(v.number()) },
  handler: async (ctx, { userId, channel, ...opts }) => {
    const res = await requestSummary(ctx, userId, { ...opts, notify: channel });
    if ("error" in res) return `Tool error: ${res.error}`;
    return channel === "telegram"
      ? "Started writing the visit summary; it arrives as a separate message in a moment. Tell the user that briefly."
      : "Started writing the visit summary; it'll be in the app's Visit summary panel (the clipboard button at the top) in a moment, " +
          "and a note will appear in the chat. Tell the user that briefly.";
  },
});

export const latest = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;
    const row = await ctx.db
      .query("visitSummaries")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .order("desc")
      .first();
    if (!row) return null;
    const { notify, ...rest } = row;
    return rest;
  },
});

export const remove = mutation({
  args: { id: v.id("visitSummaries") },
  handler: async (ctx, { id }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not signed in");
    const row = await ctx.db.get(id);
    if (!row || row.userId !== userId) throw new Error("Not found");
    await ctx.db.delete(id);
  },
});

// Everything the summary is written from, for one user and period. Respects Clear chat.
export const material = internalQuery({
  args: { id: v.id("visitSummaries"), now: v.number() },
  handler: async (ctx, { id, now }) => {
    const row = await ctx.db.get(id);
    if (!row) return null;
    const user = await ctx.db.get(row.userId);
    const since = Math.max(now - row.days * DAY_MS, user?.chatClearedAt ?? 0);
    const messages = (
      await ctx.db
        .query("messages")
        .withIndex("by_user", (q) => q.eq("userId", row.userId).gt("_creationTime", since))
        .order("desc")
        .take(MAX_MESSAGES)
    )
      .reverse()
      .filter((m) => m.kind !== "links")
      .map((m) => ({ role: m.role, text: m.image ? `(sent a photo) ${m.text}`.trim() : m.text, at: m._creationTime }));
    const analyses = (
      await ctx.db
        .query("creaoRuns")
        .withIndex("by_user", (q) => q.eq("userId", row.userId).gt("_creationTime", now - row.days * DAY_MS))
        .take(20)
    ).flatMap((r) => (r.status === "completed" && r.report ? [{ at: r._creationTime, report: r.report }] : []));
    const healthDays = user?.health
      ? (
          await ctx.db
            .query("healthDays")
            .withIndex("by_user_and_date", (q) => q.eq("userId", row.userId).gte("date", dateDaysAgo(now, row.days - 1)))
            .take(92)
        ).map(({ date, metrics }) => ({ date, metrics }))
      : [];
    return { row, messages, analyses, healthDays };
  },
});

export const generate = internalAction({
  args: { id: v.id("visitSummaries") },
  handler: async (ctx, { id }) => {
    const now = Date.now();
    const data = await ctx.runQuery(internal.visit.material, { id, now });
    if (!data || data.row.status !== "generating") return;
    const today = dateDaysAgo(now, 0);
    try {
      const medications: string = await ctx.runQuery(internal.reminders.activeText, { userId: data.row.userId, now });
      const facts: string[] = await ctx.runQuery(internal.me.factsFor, { userId: data.row.userId });
      const entries = await ctx.runQuery(internal.journal.since, { userId: data.row.userId, since: dateDaysAgo(now, data.row.days - 1) });
      const daily = await ctx.runQuery(internal.journal.dailyFrom, { userId: data.row.userId, since: dateDaysAgo(now, data.row.days - 1) });
      const tracked = await ctx.runQuery(internal.trackers.since, { userId: data.row.userId, since: dateDaysAgo(now, data.row.days - 1) });
      const conditions = trackersText(tracked.entries, tracked.peakFlowBest);
      const ex = await ctx.runQuery(internal.exercises.adherenceFor, { userId: data.row.userId, from: dateDaysAgo(now, data.row.days - 1), to: today });
      const appointments: string = await ctx.runQuery(internal.visits.textFor, { userId: data.row.userId, from: now - data.row.days * DAY_MS, to: now + 60 * DAY_MS });
      const material = visitMaterial({
        reason: data.row.reason,
        days: data.row.days,
        today,
        messages: data.messages,
        analyses: data.analyses,
        health: data.healthDays.length ? healthReport(data.healthDays, today) : undefined,
        medications: medications || undefined,
        facts,
        journal:
          [entries.length || daily.length ? journalText([...entries, ...painAsEntries(tracked.entries)], data.healthDays, daily) : "", conditions && `Condition trackers:\n${conditions}`, ex.text && `Exercises and physical therapy:\n${ex.text}`]
            .filter(Boolean)
            .join("\n\n") || undefined,
        appointments: appointments || undefined,
      });
      const lang = langOf(await ctx.runQuery(internal.pipeline.getUser, { userId: data.row.userId }));
      const { content } = await complete({
        model: CORE_MODEL(),
        messages: [
          {
            role: "system",
            content: lang === "en" ? VISIT_PROMPT : `${VISIT_PROMPT}\nWrite the whole summary, headings included, in ${LANGUAGES[lang].english}.`,
          },
          { role: "user", content: material },
        ],
        maxTokens: 2500,
      });
      const text = content?.trim();
      if (!text) throw new Error("empty summary");
      await ctx.runMutation(internal.visit.finish, { id, text });
    } catch (e) {
      console.error("visit summary failed", e);
      await ctx.runMutation(internal.visit.finish, { id, error: (e as Error).message.slice(0, 300) });
    }
  },
});


export const finish = internalMutation({
  args: { id: v.id("visitSummaries"), text: v.optional(v.string()), error: v.optional(v.string()) },
  handler: async (ctx, { id, text, error }) => {
    const row = await ctx.db.get(id);
    if (!row || row.status !== "generating") return;
    await ctx.db.patch(id, text ? { status: "ready", text } : { status: "failed", error: error ?? "unknown error" });
    if (!row.notify) return;
    const reply = !text
      ? "Sorry, I couldn't write your visit summary just now. Please try again in a bit."
      : row.notify === "telegram"
        ? text
        : t(langOf(await ctx.db.get(row.userId)), "visitReady");
    await saveAssistantReply(ctx, { userId: row.userId, text: reply, channel: row.notify, urgent: false });
  },
});

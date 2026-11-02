// The daily check-in: mood, energy and sleep quality on a 1-5 scale, once per local day. Logged from the card in the
// chat and Journal tab, or by the model (log_how_i_feel) when the user says how they feel. Charted in the Journal tab
// and used in patterns, reports and visit summaries (convex/lib/journal.ts).
import { v } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";
import { internalMutation, mutation, MutationCtx, query } from "./_generated/server";
import { Id } from "./_generated/dataModel";
import { isDate } from "./lib/health";
import { localToday } from "./journal";

const score = (n: unknown) => {
  const x = Math.round(Number(n));
  return Number.isFinite(x) && x >= 1 && x <= 5 ? x : undefined;
};

type DailyArgs = { mood?: number; energy?: number; sleepQuality?: number; note?: string; date?: string; skipped?: boolean };

// Merges into today's row: a later answer fills in or replaces just the parts it gives.
async function save(ctx: MutationCtx, userId: Id<"users">, args: DailyArgs, source: "card" | "chat") {
  const user = await ctx.db.get(userId);
  const today = localToday(user);
  const date = args.date && isDate(args.date) && args.date <= today ? args.date : today;
  const fields = {
    ...(score(args.mood) && { mood: score(args.mood) }),
    ...(score(args.energy) && { energy: score(args.energy) }),
    ...(score(args.sleepQuality) && { sleepQuality: score(args.sleepQuality) }),
    ...(args.note?.trim() && { note: args.note.trim().slice(0, 300) }),
  };
  const existing = await ctx.db.query("dailyLogs").withIndex("by_user_and_date", (q) => q.eq("userId", userId).eq("date", date)).unique();
  if (!Object.keys(fields).length && !args.skipped) return { date, saved: false };
  if (existing) await ctx.db.patch(existing._id, { ...fields, skipped: args.skipped && !Object.keys(fields).length ? true : undefined, source });
  else await ctx.db.insert("dailyLogs", { userId, date, ...fields, source, ...(args.skipped && !Object.keys(fields).length && { skipped: true }) });
  return { date, saved: true };
}

const args = {
  mood: v.optional(v.number()),
  energy: v.optional(v.number()),
  sleepQuality: v.optional(v.number()),
  note: v.optional(v.string()),
  date: v.optional(v.string()),
};

export const log = mutation({
  args,
  handler: async (ctx, a) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not signed in");
    await save(ctx, userId, a, "card");
  },
});

// "Not today" on the chat card: it stays hidden until tomorrow.
export const skip = mutation({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not signed in");
    await save(ctx, userId, { skipped: true }, "card");
  },
});

// Today's row, for the card. `date` is the app's local date (queries can't read the clock).
export const today = query({
  args: { date: v.string() },
  handler: async (ctx, { date }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;
    const row = await ctx.db.query("dailyLogs").withIndex("by_user_and_date", (q) => q.eq("userId", userId).eq("date", date)).unique();
    return row
      ? { mood: row.mood ?? null, energy: row.energy ?? null, sleepQuality: row.sleepQuality ?? null, skipped: !!row.skipped }
      : { mood: null, energy: null, sleepQuality: null, skipped: false };
  },
});

export const fromChat = internalMutation({
  args: { userId: v.id("users"), ...args },
  handler: async (ctx, { userId, ...a }) => {
    const res = await save(ctx, userId, a, "chat");
    if (!res.saved) return "Tool error: give at least one of mood, energy or sleep_quality (1-5).";
    return `Logged today's check-in (${res.date}). The user sees it in the Journal tab.`;
  },
});

// Condition trackers (convex/lib/trackers.ts): pain / CRPS, asthma (with a personal-best peak flow), seizures, and
// glucose readings (stored in mg/dL).
// Several entries a day are fine. Logged from the Journal tab or by the model (log_condition_event), charted in the
// Journal tab, and included in visit summaries, reports and the model's journal reads. Pain feeds the journal's
// patterns as the "pain" symptom.
import { v } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";
import { internalMutation, internalQuery, mutation, MutationCtx, query, QueryCtx } from "./_generated/server";
import { Id } from "./_generated/dataModel";
import { internal } from "./_generated/api";
import {
  asthmaDetails,
  AsthmaDetails,
  cleanAsthma,
  cleanGlucose,
  cleanPain,
  cleanSeizure,
  glucoseDetails,
  GlucoseDetails,
  painDetails,
  PainDetails,
  seizureDetails,
  SeizureDetails,
  tracker,
  Tracker,
  TrackerEntry,
} from "./lib/trackers";
import { isDate } from "./lib/health";
import { localToday } from "./journal";

const MAX_PER_DAY = 50;

type AddArgs = {
  tracker: Tracker;
  date?: string;
  at?: number;
  pain?: Partial<PainDetails>;
  asthma?: Partial<AsthmaDetails>;
  seizure?: Partial<SeizureDetails>;
  glucose?: Partial<GlucoseDetails>;
  note?: string;
};

async function addEntry(ctx: MutationCtx, userId: Id<"users">, a: AddArgs, source: "manual" | "chat") {
  const user = await ctx.db.get(userId);
  const today = localToday(user);
  const date = a.date && isDate(a.date) && a.date <= today ? a.date : today;
  const sameDay = await ctx.db.query("trackerEntries").withIndex("by_user_and_date", (q) => q.eq("userId", userId).eq("date", date)).take(MAX_PER_DAY);
  if (sameDay.length >= MAX_PER_DAY) throw new Error(`That day already has ${MAX_PER_DAY} entries.`);
  const base = { userId, date, at: a.at && a.at <= Date.now() + 60_000 ? a.at : Date.now(), tracker: a.tracker, note: a.note?.trim().slice(0, 500) || undefined, source };
  if (a.tracker === "pain") {
    const pain = cleanPain(a.pain ?? {});
    if ("error" in pain) throw new Error(pain.error);
    return { id: await ctx.db.insert("trackerEntries", { ...base, pain }), date };
  }
  if (a.tracker === "asthma") {
    const asthma = cleanAsthma(a.asthma ?? {});
    if ("error" in asthma) throw new Error(asthma.error);
    return { id: await ctx.db.insert("trackerEntries", { ...base, asthma }), date };
  }
  if (a.tracker === "glucose") {
    const glucose = cleanGlucose(a.glucose ?? {});
    if ("error" in glucose) throw new Error(glucose.error);
    const id = await ctx.db.insert("trackerEntries", { ...base, glucose });
    // A very low or very high reading goes to the Action Inbox right away (convex/agentScan.ts).
    await ctx.scheduler.runAfter(0, internal.agentScan.afterGlucose, { userId });
    return { id, date };
  }
  return { id: await ctx.db.insert("trackerEntries", { ...base, seizure: cleanSeizure(a.seizure ?? {}) }), date };
}

export const add = mutation({
  args: {
    tracker,
    date: v.optional(v.string()),
    at: v.optional(v.number()),
    pain: v.optional(painDetails),
    asthma: v.optional(asthmaDetails),
    seizure: v.optional(seizureDetails),
    glucose: v.optional(glucoseDetails),
    note: v.optional(v.string()),
  },
  handler: async (ctx, a) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not signed in");
    return (await addEntry(ctx, userId, a, "manual")).id;
  },
});

export const remove = mutation({
  args: { id: v.id("trackerEntries") },
  handler: async (ctx, { id }) => {
    const userId = await getAuthUserId(ctx);
    const row = await ctx.db.get(id);
    if (!userId || !row || row.userId !== userId) throw new Error("Not found");
    await ctx.db.delete(id);
  },
});

export const setPeakFlowBest = mutation({
  args: { value: v.union(v.number(), v.null()) },
  handler: async (ctx, { value }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not signed in");
    if (value !== null && !(value >= 50 && value <= 900)) throw new Error("Peak flow is usually between 50 and 900 L/min.");
    await ctx.db.patch(userId, { peakFlowBest: value ?? undefined });
  },
});

export async function trackersSince(ctx: QueryCtx, userId: Id<"users">, since: string): Promise<TrackerEntry[]> {
  const rows = await ctx.db.query("trackerEntries").withIndex("by_user_and_date", (q) => q.eq("userId", userId).gte("date", since)).take(1000);
  return rows
    .map(({ date, at, tracker, pain, asthma, seizure, glucose, note }) => ({ date, at, tracker, pain, asthma, seizure, glucose, note }))
    .sort((a, b) => a.at - b.at);
}

export const since = internalQuery({
  args: { userId: v.id("users"), since: v.string() },
  handler: async (ctx, { userId, since }) => ({
    entries: await trackersSince(ctx, userId, since),
    peakFlowBest: (await ctx.db.get(userId))?.peakFlowBest,
  }),
});

// The Journal tab's tracker charts and lists. `since` comes from the app.
export const view = query({
  args: { since: v.string() },
  handler: async (ctx, { since }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId || !isDate(since)) return null;
    const user = await ctx.db.get(userId);
    const rows = await ctx.db.query("trackerEntries").withIndex("by_user_and_date", (q) => q.eq("userId", userId).gte("date", since)).take(1000);
    const of = (t: Tracker) => rows.filter((r) => r.tracker === t).sort((a, b) => b.at - a.at);
    return {
      peakFlowBest: user?.peakFlowBest ?? null,
      pain: of("pain").map((r) => ({ _id: r._id, date: r.date, at: r.at, note: r.note ?? null, ...r.pain! })),
      asthma: of("asthma").map((r) => ({ _id: r._id, date: r.date, at: r.at, note: r.note ?? null, ...r.asthma! })),
      seizure: of("seizure").map((r) => ({ _id: r._id, date: r.date, at: r.at, note: r.note ?? null, ...r.seizure! })),
      glucose: of("glucose").map((r) => ({ _id: r._id, date: r.date, at: r.at, note: r.note ?? null, ...r.glucose! })),
    };
  },
});

// The model's log_condition_event tool.
export const fromChat = internalMutation({
  args: {
    userId: v.id("users"),
    tracker,
    date: v.optional(v.string()),
    pain: v.optional(v.any()),
    asthma: v.optional(v.any()),
    seizure: v.optional(v.any()),
    glucose: v.optional(v.any()),
    note: v.optional(v.string()),
  },
  handler: async (ctx, { userId, ...a }) => {
    try {
      const { date } = await addEntry(ctx, userId, a, "chat");
      return `Logged a ${a.tracker} entry for ${date}. The user can see it in the Journal tab.`;
    } catch (e) {
      return `Tool error: ${(e as Error).message}`;
    }
  },
});

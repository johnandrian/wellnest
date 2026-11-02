// Symptom journal (convex/lib/journal.ts): the model logs symptoms from chat with log_symptom, the user adds or
// removes entries in the Journal tab, and `view` gives the tab its charts and patterns.
import { v } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";
import { internalMutation, internalQuery, mutation, MutationCtx, query, QueryCtx } from "./_generated/server";
import { Doc, Id } from "./_generated/dataModel";
import { clampSeverity, dailySeverity, Entry, entrySource, MAX_PER_DAY, normalizeSymptom, patterns, summaries } from "./lib/journal";
import { isDate } from "./lib/health";
import { zoneOffsetMin } from "./lib/reminders";

const MAX_ROWS = 1000;

// The user's calendar date now, in their time zone (UTC until the app has reported one).
export function localToday(user: Doc<"users"> | null, now = Date.now()) {
  const offset = zoneOffsetMin(now, user?.timeZone ?? "UTC", user?.utcOffsetMin ?? 0);
  return new Date(now + offset * 60_000).toISOString().slice(0, 10);
}

async function addEntry(
  ctx: MutationCtx,
  userId: Id<"users">,
  args: { symptom: string; severity?: number; note?: string; date?: string; source: "chat" | "manual" | "checkin" },
): Promise<{ id: Id<"symptomEntries">; date: string; symptom: string } | { error: string }> {
  const symptom = normalizeSymptom(args.symptom);
  if (!symptom) return { error: "Say which symptom." };
  const user = await ctx.db.get(userId);
  const today = localToday(user);
  const date = args.date && isDate(args.date) && args.date <= today ? args.date : today;
  const sameDay = await ctx.db
    .query("symptomEntries")
    .withIndex("by_user_and_date", (q) => q.eq("userId", userId).eq("date", date))
    .take(MAX_PER_DAY);
  if (sameDay.length >= MAX_PER_DAY) return { error: `That day already has ${MAX_PER_DAY} entries.` };
  const severity = clampSeverity(args.severity);
  const note = args.note?.trim().slice(0, 300) || undefined;
  // Same symptom again that day: update it instead of adding a second entry.
  const existing = sameDay.find((e) => e.symptom === symptom);
  if (existing) {
    await ctx.db.patch(existing._id, { severity: severity ?? existing.severity, note: note ?? existing.note });
    return { id: existing._id, date, symptom };
  }
  const id = await ctx.db.insert("symptomEntries", { userId, date, symptom, severity, note, source: args.source });
  return { id, date, symptom };
}

export const add = mutation({
  args: { symptom: v.string(), severity: v.optional(v.number()), note: v.optional(v.string()), date: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not signed in");
    const res = await addEntry(ctx, userId, { ...args, source: "manual" });
    if ("error" in res) throw new Error(res.error);
  },
});

export const remove = mutation({
  args: { id: v.id("symptomEntries") },
  handler: async (ctx, { id }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not signed in");
    const row = await ctx.db.get(id);
    if (!row || row.userId !== userId) throw new Error("Not found");
    await ctx.db.delete(id);
  },
});

// log_symptom from chat, and answers to check-ins (convex/checkins.ts).
export const logFromChat = internalMutation({
  args: {
    userId: v.id("users"),
    symptom: v.string(),
    severity: v.optional(v.number()),
    note: v.optional(v.string()),
    date: v.optional(v.string()),
    source: v.optional(entrySource),
  },
  handler: async (ctx, { userId, source: from, ...args }) => {
    const res = await addEntry(ctx, userId, { ...args, source: from ?? "chat" });
    if ("error" in res) return `Tool error: ${res.error}`;
    return `Logged in the symptom journal: ${res.symptom}${args.severity !== undefined ? ` ${clampSeverity(args.severity)}/10` : ""} on ${res.date}. The user can see trends in the Journal tab.`;
  },
});

async function entriesSince(ctx: QueryCtx, userId: Id<"users">, since: string): Promise<Entry[]> {
  const rows = await ctx.db
    .query("symptomEntries")
    .withIndex("by_user_and_date", (q) => q.eq("userId", userId).gte("date", since))
    .take(MAX_ROWS);
  return rows.map(({ date, symptom, severity, note }) => ({ date, symptom, severity, note }));
}

export const since = internalQuery({
  args: { userId: v.id("users"), since: v.string() },
  handler: (ctx, { userId, since }) => entriesSince(ctx, userId, since),
});

// The Journal tab: per-symptom daily severity for the charts, sleep for comparison, patterns and recent entries.
// `since` comes from the app (queries can't read the clock).
export const view = query({
  args: { since: v.string() },
  handler: async (ctx, { since }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId || !isDate(since)) return null;
    const entries = await entriesSince(ctx, userId, since);
    const health = (
      await ctx.db
        .query("healthDays")
        .withIndex("by_user_and_date", (q) => q.eq("userId", userId).gte("date", since))
        .take(100)
    ).map(({ date, metrics }) => ({ date, metrics }));
    const recent = await ctx.db
      .query("symptomEntries")
      .withIndex("by_user_and_date", (q) => q.eq("userId", userId))
      .order("desc")
      .take(30);
    const counts = new Map<string, number>();
    for (const e of entries) counts.set(e.symptom, (counts.get(e.symptom) ?? 0) + 1);
    const series = dailySeverity(entries);
    return {
      symptoms: [...counts.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([name, count]) => ({
          name,
          count,
          points: [...(series.get(name) ?? new Map()).entries()].map(([date, severity]) => ({ date, severity })),
        })),
      sleep: health.flatMap((d) => (d.metrics.sleepHours === undefined ? [] : [{ date: d.date, hours: d.metrics.sleepHours }])),
      periodDays: health.filter((d) => d.metrics.menstrualFlow && d.metrics.menstrualFlow !== "none").map((d) => d.date),
      summaries: summaries(entries),
      patterns: patterns(entries, health),
      recent: recent.map(({ _id, date, symptom, severity, note, source }) => ({ _id, date, symptom, severity: severity ?? null, note: note ?? null, source })),
    };
  },
});

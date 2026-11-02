// Phone health data: the app reads daily summaries from Apple Health (src/health.ios.ts) or Health Connect
// (src/health.android.ts) and syncs them here.
// The model reads them with get_health_data (convex/pipeline.ts); CREAO gets them only with the user's OK.
import { v } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";
import { internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { internal } from "./_generated/api";
import { cleanMetrics, healthMetrics, healthSource, isDate, MAX_SYNC_DAYS } from "./lib/health";

const DELETE_BATCH = 200;

// Upserts up to 90 days of summaries. Days the phone sends with nothing usable are left as they are.
export const sync = mutation({
  args: { days: v.array(v.object({ date: v.string(), metrics: healthMetrics })), source: v.optional(healthSource) },
  handler: async (ctx, { days, source = "apple_health" }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not signed in");
    if (days.length > MAX_SYNC_DAYS) throw new Error(`At most ${MAX_SYNC_DAYS} days per sync`);
    const latest = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10); // allow for time zones ahead of UTC
    let saved = 0;
    for (const day of days) {
      if (!isDate(day.date) || day.date > latest) continue;
      const metrics = cleanMetrics(day.metrics);
      if (!metrics) continue;
      const existing = await ctx.db
        .query("healthDays")
        .withIndex("by_user_and_date", (q) => q.eq("userId", userId).eq("date", day.date))
        .unique();
      if (existing) await ctx.db.patch(existing._id, { metrics, source });
      else await ctx.db.insert("healthDays", { userId, date: day.date, source, metrics });
      saved++;
    }
    const user = await ctx.db.get(userId);
    const now = Date.now();
    await ctx.db.patch(userId, {
      health: {
        connectedAt: user?.health?.connectedAt ?? now,
        syncedAt: now,
        shareWithAnalysis: user?.health?.shareWithAnalysis ?? false,
        source,
      },
    });
    return { saved };
  },
});

export const status = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;
    const user = await ctx.db.get(userId);
    if (!user?.health) return { connected: false as const };
    const latest = await ctx.db
      .query("healthDays")
      .withIndex("by_user_and_date", (q) => q.eq("userId", userId))
      .order("desc")
      .first();
    return {
      connected: true as const,
      syncedAt: user.health.syncedAt,
      shareWithAnalysis: user.health.shareWithAnalysis,
      source: user.health.source ?? ("apple_health" as const),
      latestDate: latest?.date ?? null,
    };
  },
});

export const setShareWithAnalysis = mutation({
  args: { enabled: v.boolean() },
  handler: async (ctx, { enabled }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not signed in");
    const user = await ctx.db.get(userId);
    if (!user?.health) throw new Error("Health data isn't connected");
    await ctx.db.patch(userId, { health: { ...user.health, shareWithAnalysis: enabled } });
  },
});

// Unlinks Apple Health and deletes every synced day (in batches, in the background).
export const disconnect = mutation({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not signed in");
    await ctx.db.patch(userId, { health: undefined });
    await ctx.scheduler.runAfter(0, internal.health.deleteDays, { userId });
  },
});

export const deleteDays = internalMutation({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    const rows = await ctx.db
      .query("healthDays")
      .withIndex("by_user_and_date", (q) => q.eq("userId", userId))
      .take(DELETE_BATCH);
    for (const row of rows) await ctx.db.delete(row._id);
    if (rows.length === DELETE_BATCH) await ctx.scheduler.runAfter(0, internal.health.deleteDays, { userId });
  },
});

// Days on or after `since` (YYYY-MM-DD), oldest first.
export const daysSince = internalQuery({
  args: { userId: v.id("users"), since: v.string() },
  handler: async (ctx, { userId, since }) => {
    const rows = await ctx.db
      .query("healthDays")
      .withIndex("by_user_and_date", (q) => q.eq("userId", userId).gte("date", since))
      .take(MAX_SYNC_DAYS + 2);
    return rows.map(({ date, metrics }) => ({ date, metrics }));
  },
});

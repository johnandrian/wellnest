// Local weather, air quality and pollen (convex/lib/weather.ts) at each user's saved location, kept per day so
// insights can look for weather triggers. A daily cron refreshes everyone with a location; saving a new location
// refreshes right away. Each fetch also rewrites the last two weeks, which fills gaps and replaces forecasts.
import { v } from "convex/values";
import { internalAction, internalMutation, MutationCtx, QueryCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import { Doc, Id } from "./_generated/dataModel";
import { fetchWeather, PAST_DAYS, WeatherDay } from "./lib/weather";
import { geocode, parseCoords } from "./lib/places";

const BATCH = 100;
const SPACING_MS = 2_000; // between users, to be gentle on the free API
const KEEP_DAYS = 400;

const weatherDay = v.object({
  date: v.string(),
  tempMax: v.optional(v.number()),
  tempMin: v.optional(v.number()),
  humidity: v.optional(v.number()),
  pressure: v.optional(v.number()),
  precip: v.optional(v.number()),
  aqi: v.optional(v.number()),
  pollen: v.optional(v.number()),
});

// Daily, from crons.ts: every user with a saved location, a page at a time.
export const scan = internalMutation({
  args: { cursor: v.optional(v.union(v.string(), v.null())) },
  handler: async (ctx, { cursor }) => {
    const page = await ctx.db.query("users").paginate({ numItems: BATCH, cursor: cursor ?? null });
    let i = 0;
    for (const user of page.page) {
      if (!user.location?.trim() || user.deleting) continue;
      await ctx.scheduler.runAfter(i++ * SPACING_MS, internal.weather.refresh, { userId: user._id });
    }
    if (!page.isDone) await ctx.scheduler.runAfter(i * SPACING_MS, internal.weather.scan, { cursor: page.continueCursor });
  },
});

// Called when the user saves a location (Settings or chat).
export async function refreshSoon(ctx: MutationCtx, userId: Id<"users">) {
  await ctx.scheduler.runAfter(0, internal.weather.refresh, { userId });
}

export const refresh = internalAction({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    const user: Doc<"users"> | null = await ctx.runQuery(internal.pipeline.getUser, { userId });
    const location = user?.location?.trim();
    if (!user || !location || user.deleting) return;
    try {
      let point = user.locationPoint?.for === location ? user.locationPoint : null;
      if (!point) {
        const hit = parseCoords(location) ?? (await geocode(location));
        if (!hit) return;
        point = { lat: hit.lat, lon: hit.lon, for: location };
        await ctx.runMutation(internal.care.savePoint, { userId, point });
      }
      const days = await fetchWeather(point.lat, point.lon);
      if (days.length) await ctx.runMutation(internal.weather.save, { userId, days: days.slice(-(PAST_DAYS + 3)) });
    } catch (e) {
      console.error("weather refresh failed", e);
    }
  },
});

export const save = internalMutation({
  args: { userId: v.id("users"), days: v.array(weatherDay) },
  handler: async (ctx, { userId, days }) => {
    for (const day of days) {
      const existing = await ctx.db
        .query("weatherDays")
        .withIndex("by_user_and_date", (q) => q.eq("userId", userId).eq("date", day.date))
        .unique();
      if (existing) await ctx.db.replace(existing._id, { userId, ...day });
      else await ctx.db.insert("weatherDays", { userId, ...day });
    }
    // Keep about a year.
    const oldest = await ctx.db.query("weatherDays").withIndex("by_user_and_date", (q) => q.eq("userId", userId)).take(20);
    const cutoff = new Date(Date.now() - KEEP_DAYS * 86_400_000).toISOString().slice(0, 10);
    for (const row of oldest) if (row.date < cutoff) await ctx.db.delete(row._id);
  },
});

export async function weatherSince(ctx: QueryCtx, userId: Id<"users">, from: string, to: string): Promise<WeatherDay[]> {
  return (
    await ctx.db
      .query("weatherDays")
      .withIndex("by_user_and_date", (q) => q.eq("userId", userId).gte("date", from).lte("date", to))
      .take(KEEP_DAYS)
  ).map(({ _id, _creationTime, userId: _, ...day }) => day);
}


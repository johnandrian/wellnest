// Insights (convex/lib/insights.ts): patterns between the user's bad days and their sleep, activity, cycle and
// local weather; how things changed after starting a medication or changing its dose; and charts for the chat.
// The Journal tab shows them, the model reads them with find_patterns and draws charts with show_chart, and the
// weekly summary (convex/weekly.ts) picks the strongest.
import { v } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";
import { internalQuery, query, QueryCtx } from "./_generated/server";
import { Doc, Id } from "./_generated/dataModel";
import { CHART_METRICS, ChartMetric, chartMarks, chartSeries, Chart, dateList, findPatterns, forecastMatches, ForecastMatch, Inputs, MedChange, medEffects, shiftDate, sliceInputs, WEATHER_FACTORS } from "./lib/insights";
import { chartName, forecastLine, medEffectText, patternText, weatherLine } from "./lib/insightsText";
import { isDate } from "./lib/health";
import { Lang, langOf } from "./lib/language";
import { zoneOffsetMin } from "./lib/reminders";
import { normalizeSymptom } from "./lib/journal";
import { dailySince, entriesSince, localToday } from "./journal";
import { trackersSince } from "./trackers";
import { weatherSince } from "./weather";
import { parseCoords } from "./lib/places";
import { unitsOf } from "./lib/units";

export const LOOKBACK_DAYS = 90;
const MED_LOOKBACK_DAYS = 120;

export async function gatherInputs(ctx: QueryCtx, userId: Id<"users">, from: string, to: string): Promise<Inputs> {
  const inRange = <T extends { date: string }>(xs: T[]) => xs.filter((x) => x.date >= from && x.date <= to);
  return {
    entries: inRange(await entriesSince(ctx, userId, from)),
    trackers: inRange(await trackersSince(ctx, userId, from)),
    daily: inRange(await dailySince(ctx, userId, from)),
    health: (
      await ctx.db
        .query("healthDays")
        .withIndex("by_user_and_date", (q) => q.eq("userId", userId).gte("date", from).lte("date", to))
        .take(400)
    ).map(({ date, metrics }) => ({ date, metrics })),
    weather: await weatherSince(ctx, userId, from, to),
  };
}

// Medication starts and dose changes since `from`, as local dates.
export async function medChanges(ctx: QueryCtx, userId: Id<"users">, from: string): Promise<MedChange[]> {
  const user = await ctx.db.get(userId);
  const localDate = (at: number) =>
    new Date(at + zoneOffsetMin(at, user?.timeZone ?? "UTC", user?.utcOffsetMin ?? 0) * 60_000).toISOString().slice(0, 10);
  const meds = new Map((await ctx.db.query("medications").withIndex("by_user_and_active", (q) => q.eq("userId", userId)).take(100)).map((m) => [m._id, m]));
  const events = await ctx.db
    .query("medicationEvents")
    .withIndex("by_user", (q) => q.eq("userId", userId).gte("_creationTime", Date.parse(`${from}T00:00:00Z`) - 86_400_000))
    .take(500);
  const out: MedChange[] = [];
  const started = new Set<string>();
  for (const e of events) {
    const med = meds.get(e.medicationId);
    if (!med || (e.kind !== "started" && e.kind !== "dose_changed")) continue;
    if (e.kind === "started") started.add(med._id);
    out.push({ name: med.name, kind: e.kind, date: localDate(e.at), note: e.note });
  }
  // Medications added before their history was kept have no "started" event; their creation date stands in.
  for (const med of meds.values()) {
    if (!started.has(med._id) && localDate(med._creationTime) >= from) out.push({ name: med.name, kind: "started", date: localDate(med._creationTime) });
  }
  return out.filter((c) => c.date >= from);
}

// The flare forecast: tomorrow's weather against the user's own weather patterns (none without a saved location).
export async function tomorrowMatches(ctx: QueryCtx, userId: Id<"users">, today: string): Promise<ForecastMatch[]> {
  const tomorrow = shiftDate(today, 1);
  const from = shiftDate(today, -(LOOKBACK_DAYS - 1));
  const input = await gatherInputs(ctx, userId, from, tomorrow);
  if (!input.weather.some((w) => w.date === tomorrow)) return [];
  return forecastMatches(findPatterns(input, dateList(from, today), 50, WEATHER_FACTORS), input.weather, tomorrow);
}

async function computed(ctx: QueryCtx, userId: Id<"users">, today: string) {
  const from = shiftDate(today, -(LOOKBACK_DAYS - 1));
  const dates = dateList(from, today);
  // Medication changes look back further (and two weeks before the oldest one) than patterns do.
  const medFrom = shiftDate(today, -(MED_LOOKBACK_DAYS + 14));
  const input = await gatherInputs(ctx, userId, medFrom, today);
  return {
    patterns: findPatterns(sliceInputs(input, from), dates),
    effects: medEffects(input, await medChanges(ctx, userId, shiftDate(today, -MED_LOOKBACK_DAYS)), dateList(medFrom, today), today),
    weatherToday: input.weather.find((w) => w.date === today),
  };
}

function placeOf(user: Doc<"users"> | null): string | null {
  const location = user?.location?.trim();
  if (!location) return null;
  const point = user?.locationPoint;
  if (point?.for === location && point.place) return point.place;
  return parseCoords(location) ? null : location;
}

// The Journal tab's insights card. `today` is the phone's local date (queries can't read the clock).
export const view = query({
  args: { today: v.string() },
  handler: async (ctx, { today }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId || !isDate(today)) return null;
    const user = await ctx.db.get(userId);
    const lang = langOf(user);
    const units = unitsOf(user);
    const { patterns, effects, weatherToday } = await computed(ctx, userId, today);
    return {
      patterns: patterns.map((p) => patternText(p, lang, units)),
      medEffects: effects.map((e) => medEffectText(e, lang, units)),
      weather: weatherToday ? weatherLine(weatherToday, lang) : null,
      // Where that weather is for: the looked-up place name, else the location as they typed it.
      weatherPlace: weatherToday ? placeOf(user) : null,
      // The flare forecast: tomorrow's weather on the worse side of one of their weather patterns.
      tomorrow: (await tomorrowMatches(ctx, userId, today)).map((m) => forecastLine(m, lang, units)),
      hasLocation: !!user?.location?.trim(),
    };
  },
});

// The model's find_patterns tool.
export const forModel = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }): Promise<string> => {
    const user = await ctx.db.get(userId);
    const today = localToday(user);
    const units = unitsOf(user);
    const { patterns, effects, weatherToday } = await computed(ctx, userId, today);
    const tomorrow = (await weatherSince(ctx, userId, shiftDate(today, 1), shiftDate(today, 1)))[0];
    const flare = await tomorrowMatches(ctx, userId, today);
    return [
      patterns.length
        ? `Patterns over the last ${LOOKBACK_DAYS} days (associations in their own logs, not proof of cause):\n${patterns.map((p) => `- ${patternText(p, "en", units)}`).join("\n")}`
        : `No clear patterns yet in the last ${LOOKBACK_DAYS} days (needs about 10 days with both a symptom score and the factor).`,
      effects.length
        ? `Before and after medication changes (other things may have changed too):\n${effects.map((e) => `- ${medEffectText(e, "en", units)}`).join("\n")}`
        : "",
      weatherToday ? `Today's local weather: ${weatherLine(weatherToday, "en")}` : "No local weather (no saved location).",
      tomorrow ? `Tomorrow's forecast: ${weatherLine(tomorrow, "en")}` : "",
      flare.length
        ? `Flare forecast (tomorrow's weather matches their own patterns; a heads-up, not a prediction):\n${flare.map((m) => `- ${forecastLine(m, "en", units)}`).join("\n")}`
        : "",
    ]
      .filter(Boolean)
      .join("\n\n");
  },
});

// One chart for the chat, in the user's language. null when there's nothing to draw.
export const chartFor = internalQuery({
  args: { userId: v.id("users"), metric: v.string(), symptom: v.optional(v.string()), days: v.number() },
  handler: async (ctx, { userId, metric, symptom, days }): Promise<Chart | { error: string }> => {
    if (!CHART_METRICS.includes(metric as ChartMetric)) return { error: `metric must be one of ${CHART_METRICS.join(", ")}` };
    const user = await ctx.db.get(userId);
    const lang: Lang = langOf(user);
    const to = localToday(user);
    const from = shiftDate(to, -(Math.min(180, Math.max(7, Math.round(days) || 30)) - 1));
    const name = metric === "symptom" ? normalizeSymptom(symptom ?? "") : undefined;
    if (metric === "symptom" && !name) return { error: "say which symptom" };
    const input = await gatherInputs(ctx, userId, from, to);
    const units = unitsOf(user);
    const series = chartSeries(input, metric as ChartMetric, dateList(from, to), name, units);
    if (!series.points.length) return { error: `nothing logged for ${name ?? metric} in that time` };
    const meds = chartMarks(await medChanges(ctx, userId, from), from, to);
    return { metric, ...chartName(metric as ChartMetric, lang, name, units), from, to, ...series, ...(meds.length && { meds }) };
  },
});

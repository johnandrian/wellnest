// The flare forecast: at 7 PM local time, when tomorrow's forecast falls on the worse side of one of the user's own
// weather patterns (convex/lib/insights.ts: a pressure drop, humidity, heat, rain, air quality or pollen that has
// gone with their worse days), a short heads-up in the chat with a push notification (and on Telegram when linked).
// Care circle members who picked it get their own copy. Nothing is sent on days with no match; a Settings switch
// turns it off.
// Air quality alerts go out at the same time, to everyone with a location, when tomorrow's air quality index is
// forecast at 101 or worse (unhealthy for sensitive groups), whether or not it has gone with their worse days. They
// have their own Settings switch.
import { v } from "convex/values";
import { unitsOf } from "./lib/units";
import { getAuthUserId } from "@convex-dev/auth/server";
import { internal } from "./_generated/api";
import { internalMutation, mutation } from "./_generated/server";
import { Doc } from "./_generated/dataModel";
import { AIR_ALERT_AQI, airAlertText, forecastText } from "./lib/insightsText";
import { langOf } from "./lib/language";
import { zoneOffsetMin } from "./lib/reminders";
import { plain } from "./lib/push";
import { localToday } from "./journal";
import { tomorrowMatches } from "./insights";
import { weatherSince } from "./weather";
import { shiftDate } from "./lib/insights";
import { saveAssistantReply } from "./pipeline";
import { notify } from "./push";
import { alertCircle } from "./circle";

const SEND_HOUR = 19;
const BATCH = 100;
const MIN_GAP_MS = 20 * 3_600_000;

export const setEnabled = mutation({
  args: { enabled: v.boolean() },
  handler: async (ctx, { enabled }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not signed in");
    await ctx.db.patch(userId, { flareForecast: enabled });
  },
});

export const setAirAlerts = mutation({
  args: { enabled: v.boolean() },
  handler: async (ctx, { enabled }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not signed in");
    await ctx.db.patch(userId, { airAlerts: enabled });
  },
});

const isDue = (user: Doc<"users">, now: number) => {
  if (user.flareForecast === false && user.airAlerts === false) return false;
  if (user.deleting || !user.location?.trim() || (user.forecastSentAt ?? 0) > now - MIN_GAP_MS) return false;
  const local = new Date(now + zoneOffsetMin(now, user.timeZone ?? "UTC", user.utcOffsetMin ?? 0) * 60_000);
  return local.getUTCHours() === SEND_HOUR;
};

// Hourly, from crons.ts: finds the users whose evening it is and hands each to `send`.
export const scan = internalMutation({
  args: { cursor: v.optional(v.union(v.string(), v.null())) },
  handler: async (ctx, { cursor }) => {
    const now = Date.now();
    const page = await ctx.db.query("users").paginate({ numItems: BATCH, cursor: cursor ?? null });
    for (const user of page.page) if (isDue(user, now)) await ctx.scheduler.runAfter(0, internal.forecast.send, { userId: user._id });
    if (!page.isDone) await ctx.scheduler.runAfter(0, internal.forecast.scan, { cursor: page.continueCursor });
  },
});

export const send = internalMutation({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    const user = await ctx.db.get(userId);
    const now = Date.now();
    if (!user || !isDue(user, now)) return;
    await ctx.db.patch(userId, { forecastSentAt: now });
    const today = localToday(user, now);
    const lang = langOf(user);
    const matches = user.flareForecast === false ? [] : await tomorrowMatches(ctx, userId, today);
    // Bad air tomorrow, unless one of their own patterns already says so.
    const aqi = (await weatherSince(ctx, userId, shiftDate(today, 1), shiftDate(today, 1)))[0]?.aqi;
    const air = user.airAlerts !== false && aqi !== undefined && aqi >= AIR_ALERT_AQI && !matches.some((m) => m.pattern.factor === "aqi") ? airAlertText(aqi, lang) : null;
    if (!matches.length && !air) return;

    const flare = matches.length ? forecastText(matches, lang, undefined, unitsOf(user)) : null;
    const text = [flare?.text, air?.text].filter(Boolean).join("\n\n");
    const title = flare?.title ?? air!.title;
    await saveAssistantReply(ctx, { userId, text, channel: user.telegramChatId ? "telegram" : "app", urgent: false, kind: "forecast" });
    await notify(ctx, userId, "forecast", { title, body: [flare && bodyOf(flare.text), air?.body].filter(Boolean).join("\n") });
    if (!matches.length) return;
    await alertCircle(ctx, userId, "forecast", (lang, who) => {
      const copy = forecastText(matches, lang, who, unitsOf(user));
      return { ...copy, body: bodyOf(copy.text) };
    });
  },
});

// The push body: the bullets, without the title line and the footer.
const bodyOf = (text: string) =>
  plain(text)
    .split("\n")
    .filter((l) => l.startsWith("•"))
    .join("\n");

// The flare forecast: at 7 PM local time, when tomorrow's forecast falls on the worse side of one of the user's own
// weather patterns (convex/lib/insights.ts: a pressure drop, humidity, heat, rain, air quality or pollen that has
// gone with their worse days), a short heads-up in the chat with a push notification (and on Telegram when linked).
// Care circle members who picked it get their own copy. Nothing is sent on days with no match; a Settings switch
// turns it off.
import { v } from "convex/values";
import { unitsOf } from "./lib/units";
import { getAuthUserId } from "@convex-dev/auth/server";
import { internal } from "./_generated/api";
import { internalMutation, mutation } from "./_generated/server";
import { Doc } from "./_generated/dataModel";
import { forecastText } from "./lib/insightsText";
import { langOf } from "./lib/language";
import { zoneOffsetMin } from "./lib/reminders";
import { plain } from "./lib/push";
import { localToday } from "./journal";
import { tomorrowMatches } from "./insights";
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

const isDue = (user: Doc<"users">, now: number) => {
  if (user.flareForecast === false || user.deleting || !user.location?.trim() || (user.forecastSentAt ?? 0) > now - MIN_GAP_MS) return false;
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
    const matches = await tomorrowMatches(ctx, userId, localToday(user, now));
    if (!matches.length) return;

    const { text, title } = forecastText(matches, langOf(user), undefined, unitsOf(user));
    await saveAssistantReply(ctx, { userId, text, channel: user.telegramChatId ? "telegram" : "app", urgent: false, kind: "forecast" });
    await notify(ctx, userId, "forecast", { title, body: bodyOf(text) });
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

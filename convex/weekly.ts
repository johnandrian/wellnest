// The weekly summary: Sunday at 6 PM local time, a short recap of the week in the chat (and on Telegram when linked)
// with a push notification: each measure's average against last week, medication doses, the strongest pattern and
// any medication change worth noting (convex/lib/insights.ts). Only when there's something logged this week, and
// a Settings switch turns it off.
import { v } from "convex/values";
import { unitsOf } from "./lib/units";
import { getAuthUserId } from "@convex-dev/auth/server";
import { internal } from "./_generated/api";
import { internalMutation, mutation } from "./_generated/server";
import { Doc } from "./_generated/dataModel";
import { dateList, findPatterns, medEffects, shiftDate, sliceInputs, weekStats } from "./lib/insights";
import { weeklyText } from "./lib/insightsText";
import { langOf } from "./lib/language";
import { zoneOffsetMin } from "./lib/reminders";
import { plain } from "./lib/push";
import { gatherInputs, LOOKBACK_DAYS, medChanges } from "./insights";
import { saveAssistantReply } from "./pipeline";
import { notify } from "./push";

const SEND_DAY = 0; // Sunday
const SEND_HOUR = 18;
const BATCH = 100;
const MIN_GAP_MS = 6 * 24 * 3_600_000;

export const setEnabled = mutation({
  args: { enabled: v.boolean() },
  handler: async (ctx, { enabled }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not signed in");
    await ctx.db.patch(userId, { weeklySummary: enabled });
  },
});

const isDue = (user: Doc<"users">, now: number) => {
  if (user.weeklySummary === false || user.deleting || (user.weeklySentAt ?? 0) > now - MIN_GAP_MS) return false;
  const local = new Date(now + zoneOffsetMin(now, user.timeZone ?? "UTC", user.utcOffsetMin ?? 0) * 60_000);
  return local.getUTCDay() === SEND_DAY && local.getUTCHours() === SEND_HOUR;
};

// Hourly, from crons.ts: finds the users whose Sunday evening it is and hands each to `send`.
export const scan = internalMutation({
  args: { cursor: v.optional(v.union(v.string(), v.null())) },
  handler: async (ctx, { cursor }) => {
    const now = Date.now();
    const page = await ctx.db.query("users").paginate({ numItems: BATCH, cursor: cursor ?? null });
    for (const user of page.page) if (isDue(user, now)) await ctx.scheduler.runAfter(0, internal.weekly.send, { userId: user._id });
    if (!page.isDone) await ctx.scheduler.runAfter(0, internal.weekly.scan, { cursor: page.continueCursor });
  },
});

export const send = internalMutation({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    const user = await ctx.db.get(userId);
    const now = Date.now();
    if (!user || !isDue(user, now)) return;
    await ctx.db.patch(userId, { weeklySentAt: now });

    const offset = zoneOffsetMin(now, user.timeZone ?? "UTC", user.utcOffsetMin ?? 0);
    const today = new Date(now + offset * 60_000).toISOString().slice(0, 10);
    const weekStart = shiftDate(today, -6);
    const from = shiftDate(today, -(LOOKBACK_DAYS - 1));
    const input = await gatherInputs(ctx, userId, from, today);
    const stats = weekStats(input, dateList(from, today), today);

    // Medication reminders answered this week.
    const reminders = (
      await ctx.db
        .query("messages")
        .withIndex("by_user", (q) => q.eq("userId", userId).gte("_creationTime", Date.parse(`${weekStart}T00:00:00Z`) - offset * 60_000))
        .take(1000)
    ).filter((m) => m.kind === "reminder" && m.reminder);
    const doses = { taken: reminders.filter((m) => m.reminder!.status === "taken").length, total: reminders.length };
    if (!stats.length && !doses.total) return; // nothing logged this week

    const lang = langOf(user);
    const pattern = findPatterns(sliceInputs(input, from), dateList(from, today), 1)[0];
    // A medication change from the last month whose before/after is clear.
    const medEffect = medEffects(input, await medChanges(ctx, userId, shiftDate(today, -30)), dateList(from, today), today)[0];
    const text = weeklyText({ lang, from: weekStart, to: today, stats, doses, pattern, medEffect, units: unitsOf(user) });
    const channel = user.telegramChatId ? "telegram" : "app";
    await saveAssistantReply(ctx, { userId, text, channel, urgent: false, kind: "summary" });
    const [title, ...rest] = plain(text).split("\n").filter(Boolean);
    await notify(ctx, userId, "weekly", { title: title.replace(/^📅\s*/, ""), body: rest.slice(0, 4).join("\n") });
  },
});

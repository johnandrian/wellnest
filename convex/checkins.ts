// Proactive check-ins (convex/lib/checkins.ts): an hourly cron looks, for each user whose local time is 9 AM, at
// their recent Apple Health days and asks a gentle question in the chat when something changed. At most one a day,
// the same kind of change at most every 3 days, and a Settings switch turns them off.
import { v } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";
import { internalMutation, mutation, MutationCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import { Doc } from "./_generated/dataModel";
import { checkinText, detect, shift } from "./lib/checkins";
import { langOf } from "./lib/language";
import { zoneOffsetMin } from "./lib/reminders";
import { insertMessage } from "./lib/chats";

const CHECKIN_HOUR = 9;
const BATCH = 100;
const DAY_MS = 24 * 60 * 60 * 1000;
const SAME_KIND_GAP_MS = 3 * DAY_MS;

export const setEnabled = mutation({
  args: { enabled: v.boolean() },
  handler: async (ctx, { enabled }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not signed in");
    await ctx.db.patch(userId, { checkins: enabled });
  },
});

// Hourly, from crons.ts: walks every user in batches.
export const scan = internalMutation({
  args: { cursor: v.optional(v.union(v.string(), v.null())) },
  handler: async (ctx, { cursor }) => {
    const now = Date.now();
    const page = await ctx.db.query("users").paginate({ numItems: BATCH, cursor: cursor ?? null });
    for (const user of page.page) await maybeCheckIn(ctx, user, now);
    if (!page.isDone) await ctx.scheduler.runAfter(0, internal.checkins.scan, { cursor: page.continueCursor });
  },
});

async function maybeCheckIn(ctx: MutationCtx, user: Doc<"users">, now: number) {
  if (!user.health || user.checkins === false || user.deleting) return;
  const offset = zoneOffsetMin(now, user.timeZone ?? "UTC", user.utcOffsetMin ?? 0);
  const local = new Date(now + offset * 60_000);
  if (local.getUTCHours() !== CHECKIN_HOUR) return;
  const today = local.toISOString().slice(0, 10);

  const recent = await ctx.db
    .query("checkins")
    .withIndex("by_user", (q) => q.eq("userId", user._id).gte("_creationTime", now - SAME_KIND_GAP_MS))
    .take(10);
  if (recent.some((c) => c._creationTime > now - 20 * 60 * 60 * 1000)) return; // at most one a day

  const days = (
    await ctx.db
      .query("healthDays")
      .withIndex("by_user_and_date", (q) => q.eq("userId", user._id).gte("date", shift(today, -16)))
      .take(20)
  ).map(({ date, metrics }) => ({ date, metrics }));
  const signal = detect(days, today);
  if (!signal || recent.some((c) => c.kind === signal.kind)) return;

  const messageId = await insertMessage(ctx, {
    userId: user._id,
    role: "assistant",
    channel: "app",
    kind: "checkin",
    text: checkinText(signal, langOf(user)),
    urgent: signal.kind === "oxygen",
  });
  await ctx.db.insert("checkins", { userId: user._id, kind: signal.kind, messageId });
}

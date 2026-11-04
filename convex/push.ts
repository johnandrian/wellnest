// Push notifications for medication reminders, appointment updates (the user's choice of what pushes), and the weekly
// summary, flare forecast and care circle alerts (each switched off with the feature itself).
// The phone registers its Expo push token here; `notify` sends to every device the user has signed in on.
import { v } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";
import { internalAction, internalMutation, mutation, MutationCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import { Id } from "./_generated/dataModel";
import { isPushToken, plain, sendPush } from "./lib/push";

const MAX_DEVICES = 10;
export const pushKind = v.union(v.literal("reminders"), v.literal("appointments"));
type PushKind = "reminders" | "appointments" | "weekly" | "forecast" | "circle";

export const register = mutation({
  args: { token: v.string(), platform: v.string() },
  handler: async (ctx, { token, platform }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not signed in");
    if (!isPushToken(token)) throw new Error("Not an Expo push token");
    // A phone that signs in to another account moves to that account.
    const existing = await ctx.db.query("pushTokens").withIndex("by_token", (q) => q.eq("token", token)).unique();
    if (existing) {
      if (existing.userId !== userId) await ctx.db.patch(existing._id, { userId, platform: platform.slice(0, 16) });
      return;
    }
    const mine = await ctx.db.query("pushTokens").withIndex("by_user", (q) => q.eq("userId", userId)).take(MAX_DEVICES + 1);
    // Keep the newest devices only.
    for (const old of mine.slice(0, Math.max(0, mine.length - MAX_DEVICES + 1))) await ctx.db.delete(old._id);
    await ctx.db.insert("pushTokens", { userId, token, platform: platform.slice(0, 16) });
  },
});

// On sign-out, so a shared phone stops getting this account's notifications.
export const unregister = mutation({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return;
    const row = await ctx.db.query("pushTokens").withIndex("by_token", (q) => q.eq("token", token)).unique();
    if (row?.userId === userId) await ctx.db.delete(row._id);
  },
});

export const setPreference = mutation({
  args: { kind: pushKind, enabled: v.boolean() },
  handler: async (ctx, { kind, enabled }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not signed in");
    const user = await ctx.db.get(userId);
    const notifications = { reminders: true, appointments: true, ...user?.notifications, [kind]: enabled };
    await ctx.db.patch(userId, { notifications });
  },
});

// Called from mutations (reminders, appointments): schedules the send so a slow Expo never holds up the caller.
export async function notify(
  ctx: MutationCtx,
  userId: Id<"users">,
  kind: PushKind,
  message: { title: string; body: string; data?: Record<string, string>; categoryId?: string },
) {
  const user = await ctx.db.get(userId);
  if (!user || ((kind === "reminders" || kind === "appointments") && user.notifications?.[kind] === false)) return;
  const devices = await ctx.db.query("pushTokens").withIndex("by_user", (q) => q.eq("userId", userId)).take(MAX_DEVICES);
  if (!devices.length) return;
  await ctx.scheduler.runAfter(0, internal.push.send, {
    tokens: devices.map((d) => d.token),
    title: plain(message.title).slice(0, 120),
    body: plain(message.body).slice(0, 400),
    data: { kind, ...message.data },
    categoryId: message.categoryId,
    channelId: kind,
  });
}

export const send = internalAction({
  args: {
    tokens: v.array(v.string()),
    title: v.string(),
    body: v.string(),
    data: v.record(v.string(), v.string()),
    categoryId: v.optional(v.string()),
    channelId: v.string(),
  },
  handler: async (ctx, { tokens, ...message }) => {
    try {
      const { deadTokens, errors } = await sendPush(tokens.map((to) => ({ to, sound: "default", ...message })));
      if (errors.length) console.error("push errors", errors);
      if (deadTokens.length) await ctx.runMutation(internal.push.forget, { tokens: deadTokens });
    } catch (e) {
      console.error("push failed", e);
    }
  },
});

export const forget = internalMutation({
  args: { tokens: v.array(v.string()) },
  handler: async (ctx, { tokens }) => {
    for (const token of tokens) {
      const row = await ctx.db.query("pushTokens").withIndex("by_token", (q) => q.eq("token", token)).unique();
      if (row) await ctx.db.delete(row._id);
    }
  },
});

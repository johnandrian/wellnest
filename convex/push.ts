// Push notifications for medication reminders, appointment updates (the user's choice of what pushes), and the weekly
// summary, flare forecast and care circle alerts (each switched off with the feature itself).
// The phone registers its Expo push token here, and a browser its Web Push subscription (convex/webPush.ts);
// `notify` sends to every device the user has signed in on.
import { v } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";
import { internalAction, internalMutation, mutation, MutationCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import { Id } from "./_generated/dataModel";
import { isPushToken, plain, sendPush } from "./lib/push";

const MAX_DEVICES = 10;
export const pushKind = v.union(v.literal("reminders"), v.literal("appointments"));
type PushKind = "reminders" | "appointments" | "weekly" | "forecast" | "circle" | "agent";

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

export const registerWeb = mutation({
  args: { endpoint: v.string(), p256dh: v.string(), auth: v.string() },
  handler: async (ctx, { endpoint, p256dh, auth }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not signed in");
    if (!/^https:\/\/\S+$/.test(endpoint) || endpoint.length > 1000 || !p256dh || !auth || p256dh.length > 200 || auth.length > 100) {
      throw new Error("Not a push subscription");
    }
    const existing = await ctx.db.query("webPushSubs").withIndex("by_endpoint", (q) => q.eq("endpoint", endpoint)).unique();
    if (existing) {
      await ctx.db.patch(existing._id, { userId, p256dh, auth });
      return;
    }
    const mine = await ctx.db.query("webPushSubs").withIndex("by_user", (q) => q.eq("userId", userId)).take(MAX_DEVICES + 1);
    for (const old of mine.slice(0, Math.max(0, mine.length - MAX_DEVICES + 1))) await ctx.db.delete(old._id);
    await ctx.db.insert("webPushSubs", { userId, endpoint, p256dh, auth });
  },
});

// On sign-out, so a shared phone or browser stops getting this account's notifications (`token` is a browser's
// endpoint there).
export const unregister = mutation({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return;
    const row = await ctx.db.query("pushTokens").withIndex("by_token", (q) => q.eq("token", token)).unique();
    if (row?.userId === userId) await ctx.db.delete(row._id);
    const sub = await ctx.db.query("webPushSubs").withIndex("by_endpoint", (q) => q.eq("endpoint", token)).unique();
    if (sub?.userId === userId) await ctx.db.delete(sub._id);
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
  const browsers = await ctx.db.query("webPushSubs").withIndex("by_user", (q) => q.eq("userId", userId)).take(MAX_DEVICES);
  const title = plain(message.title).slice(0, 120);
  const body = plain(message.body).slice(0, 400);
  const data = { kind, ...message.data };
  if (devices.length) {
    await ctx.scheduler.runAfter(0, internal.push.send, { tokens: devices.map((d) => d.token), title, body, data, categoryId: message.categoryId, channelId: kind });
  }
  if (browsers.length && process.env.WEB_PUSH_PRIVATE_KEY) {
    await ctx.scheduler.runAfter(0, internal.webPush.send, { subs: browsers.map(({ endpoint, p256dh, auth }) => ({ endpoint, p256dh, auth })), title, body, data });
  }
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

export const forgetWeb = internalMutation({
  args: { endpoints: v.array(v.string()) },
  handler: async (ctx, { endpoints }) => {
    for (const endpoint of endpoints) {
      const row = await ctx.db.query("webPushSubs").withIndex("by_endpoint", (q) => q.eq("endpoint", endpoint)).unique();
      if (row) await ctx.db.delete(row._id);
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

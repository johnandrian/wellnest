// Chat history: the list of the user's chats, starting a new one, going back to an old one, and deleting one.
// See convex/lib/chats.ts for how messages are filed.
import { v } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";
import { internalMutation, mutation, MutationCtx, query, QueryCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { chatMessages, chatTitle, currentChatKey } from "./lib/chats";

const MAX_LISTED = 50;
const BATCH = 200;

async function signedIn(ctx: QueryCtx) {
  const userId = await getAuthUserId(ctx);
  const user = userId ? await ctx.db.get(userId) : null;
  if (!user) throw new Error("Not signed in");
  return user;
}

async function own(ctx: QueryCtx, user: Doc<"users">, chatId: Id<"chats">) {
  const row = await ctx.db.get(chatId);
  if (!row || row.userId !== user._id) throw new Error("Chat not found");
  return row;
}

const keyOf = (row: Doc<"chats">) => (row.legacy ? undefined : row._id);

// The first chat, before it has a row: named after the user's first message, or the first message at all when
// they never wrote one (only reminders or a welcome).
async function firstChat(ctx: QueryCtx, user: Doc<"users">) {
  const first =
    (await chatMessages(ctx, user, undefined).filter((q) => q.eq(q.field("role"), "user")).first()) ??
    (await chatMessages(ctx, user, undefined).first());
  const last = await chatMessages(ctx, user, undefined).order("desc").first();
  return last ? { title: first ? chatTitle(first.text.replace(/[*_#`]/g, "")) : "", lastAt: last._creationTime } : null;
}

// Newest first. `_id` is null for the first chat while it's the only one.
export const list = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    const user = userId ? await ctx.db.get(userId) : null;
    if (!user) return [];
    if (!user.chatId) {
      const first = await firstChat(ctx, user);
      return first ? [{ _id: null, ...first, current: true }] : [];
    }
    const rows = await ctx.db
      .query("chats")
      .withIndex("by_user_and_last", (q) => q.eq("userId", user._id))
      .order("desc")
      .take(MAX_LISTED);
    return rows.map((r) => ({ _id: r._id as Id<"chats"> | null, title: r.title ?? "", lastAt: r.lastAt, current: r._id === user.chatId }));
  },
});

// "New chat". Nothing happens while the current chat is still empty.
export const start = mutation({
  args: {},
  handler: async (ctx) => {
    const user = await signedIn(ctx);
    const key = await currentChatKey(ctx, user);
    if (!(await chatMessages(ctx, user, key).first())) return;
    // The first chat gets its row now, so it shows in the list.
    if (!user.chatId) {
      const first = (await firstChat(ctx, user))!;
      await ctx.db.insert("chats", { userId: user._id, legacy: true, lastAt: first.lastAt, ...(first.title && { title: first.title }) });
    }
    const chatId = await ctx.db.insert("chats", { userId: user._id, lastAt: Date.now() });
    await ctx.db.patch(user._id, { chatId, analysisOfferedAt: undefined });
  },
});

// Go back to an older chat; new messages continue it.
export const open = mutation({
  args: { chatId: v.id("chats") },
  handler: async (ctx, { chatId }) => {
    const user = await signedIn(ctx);
    await own(ctx, user, chatId);
    if (user.chatId === chatId) return;
    await dropIfEmpty(ctx, user);
    await ctx.db.patch(user._id, { chatId, analysisOfferedAt: undefined });
  },
});

// Leaving a new chat nobody wrote in: it isn't kept.
async function dropIfEmpty(ctx: MutationCtx, user: Doc<"users">) {
  const row = user.chatId ? await ctx.db.get(user.chatId) : null;
  if (row && !(await ctx.db.query("messages").withIndex("by_user_and_chat", (q) => q.eq("userId", user._id).eq("chatId", keyOf(row))).first())) {
    await ctx.db.delete(row._id);
  }
}

// Deletes the chat and its messages. Deleting the current chat moves to the newest other one, or a new empty one.
export const remove = mutation({
  args: { chatId: v.id("chats") },
  handler: async (ctx, { chatId }) => {
    const user = await signedIn(ctx);
    const row = await own(ctx, user, chatId);
    await ctx.db.delete(row._id);
    await ctx.scheduler.runAfter(0, internal.chats.purge, { userId: user._id, chatId: keyOf(row) });
    if (user.chatId !== chatId) return;
    const next = await ctx.db.query("chats").withIndex("by_user_and_last", (q) => q.eq("userId", user._id)).order("desc").first();
    const nextId = next?._id ?? (await ctx.db.insert("chats", { userId: user._id, lastAt: Date.now() }));
    await ctx.db.patch(user._id, { chatId: nextId, analysisOfferedAt: undefined });
  },
});

// A deleted chat's messages (and their photos), in batches.
export const purge = internalMutation({
  args: { userId: v.id("users"), chatId: v.optional(v.id("chats")) },
  handler: async (ctx, { userId, chatId }) => {
    const rows = await ctx.db.query("messages").withIndex("by_user_and_chat", (q) => q.eq("userId", userId).eq("chatId", chatId)).take(BATCH);
    for (const m of rows) {
      if (m.image) await ctx.storage.delete(m.image).catch(() => {});
      await ctx.db.delete(m._id);
    }
    if (rows.length === BATCH) await ctx.scheduler.runAfter(0, internal.chats.purge, { userId, chatId });
  },
});

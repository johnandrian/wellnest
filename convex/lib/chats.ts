// Chat history (convex/chats.ts): every message belongs to one of the user's chats, and new ones (the user's, the
// replies, reminders, check-ins, Telegram) go into the current chat (users.chatId).
// Messages from before chats existed have no chatId; together they are the user's first chat, whose row is marked
// `legacy` once they start a second one.
import type { WithoutSystemFields } from "convex/server";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";

// The chatId the current chat's messages carry: undefined for the first chat.
export async function currentChatKey(ctx: QueryCtx, user: Doc<"users"> | null): Promise<Id<"chats"> | undefined> {
  if (!user?.chatId) return undefined;
  const row = await ctx.db.get(user.chatId);
  return row && !row.legacy ? row._id : undefined;
}

// A chat's visible messages, oldest first in the index (after "Clear chat").
export function chatMessages(ctx: QueryCtx, user: Doc<"users">, key: Id<"chats"> | undefined) {
  return ctx.db
    .query("messages")
    .withIndex("by_user_and_chat", (q) => q.eq("userId", user._id).eq("chatId", key).gt("_creationTime", user.chatClearedAt ?? 0));
}

// The chat's name in the history list: its first message, on one line.
export function chatTitle(text: string) {
  const line = text.replace(/\s+/g, " ").trim();
  return line.length > 60 ? `${line.slice(0, 57).trimEnd()}…` : line;
}

// Every message is stored through this, so it lands in the current chat and moves that chat to the top.
export async function insertMessage(ctx: MutationCtx, doc: Omit<WithoutSystemFields<Doc<"messages">>, "chatId">) {
  const user = await ctx.db.get(doc.userId);
  const row = user?.chatId ? await ctx.db.get(user.chatId) : null;
  const id = await ctx.db.insert("messages", { ...doc, ...(row && !row.legacy && { chatId: row._id }) });
  if (row) {
    const title = !row.title && doc.role === "user" && doc.text.trim() ? chatTitle(doc.text) : undefined;
    await ctx.db.patch(row._id, { lastAt: Date.now(), ...(title && { title }) });
  }
  return id;
}

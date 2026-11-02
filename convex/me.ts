// "What Wellnest knows about me": saved facts the assistant uses (editable), an inventory of everything stored,
// who it's shared with, export, and deletion by category or of the whole account.
import { v } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";
import { action, internalMutation, internalQuery, mutation, MutationCtx, query } from "./_generated/server";
import { internal } from "./_generated/api";
import { Id } from "./_generated/dataModel";

export const MAX_FACTS = 50;
const MAX_FACT_LENGTH = 300;
const COUNT_CAP = 200; // counts above this show as "200+"
const BATCH = 200;

// ---------- Saved facts ----------

async function requireUser(ctx: Parameters<typeof getAuthUserId>[0]) {
  const userId = await getAuthUserId(ctx);
  if (!userId) throw new Error("Not signed in");
  return userId;
}

async function insertFact(ctx: MutationCtx, userId: Id<"users">, text: string, source: "user" | "assistant") {
  const clean = text.replace(/\s+/g, " ").trim().slice(0, MAX_FACT_LENGTH);
  if (!clean) return { error: "The fact is empty." };
  const facts = await ctx.db.query("memoryFacts").withIndex("by_user", (q) => q.eq("userId", userId)).take(MAX_FACTS);
  const same = facts.find((f) => f.text.toLowerCase() === clean.toLowerCase());
  if (same) return { id: same._id };
  if (facts.length >= MAX_FACTS) return { error: `Wellnest keeps up to ${MAX_FACTS} facts. Remove one first.` };
  return { id: await ctx.db.insert("memoryFacts", { userId, text: clean, source }) };
}

export const addFact = mutation({
  args: { text: v.string() },
  handler: async (ctx, { text }) => {
    const userId = await requireUser(ctx);
    const res = await insertFact(ctx, userId, text, "user");
    if ("error" in res) throw new Error(res.error);
  },
});

export const updateFact = mutation({
  args: { id: v.id("memoryFacts"), text: v.string() },
  handler: async (ctx, { id, text }) => {
    const userId = await requireUser(ctx);
    const fact = await ctx.db.get(id);
    if (!fact || fact.userId !== userId) throw new Error("Not found");
    const clean = text.replace(/\s+/g, " ").trim().slice(0, MAX_FACT_LENGTH);
    if (!clean) await ctx.db.delete(id);
    else await ctx.db.patch(id, { text: clean, source: "user" });
  },
});

export const deleteFact = mutation({
  args: { id: v.id("memoryFacts") },
  handler: async (ctx, { id }) => {
    const userId = await requireUser(ctx);
    const fact = await ctx.db.get(id);
    if (!fact || fact.userId !== userId) throw new Error("Not found");
    await ctx.db.delete(id);
  },
});

// The model's remember_fact / forget_fact tools (convex/pipeline.ts).
export const rememberFromChat = internalMutation({
  args: { userId: v.id("users"), text: v.string() },
  handler: async (ctx, { userId, text }) => {
    const res = await insertFact(ctx, userId, text, "assistant");
    if ("error" in res) return `Tool error: ${res.error}`;
    return "Saved. The user can see and edit it under Settings → What Wellnest knows about me.";
  },
});

export const forgetFromChat = internalMutation({
  args: { userId: v.id("users"), text: v.string() },
  handler: async (ctx, { userId, text }) => {
    const words = text.toLowerCase().match(/[a-z0-9]+/g) ?? [];
    if (!words.length) return "Tool error: say which fact to forget.";
    const facts = await ctx.db.query("memoryFacts").withIndex("by_user", (q) => q.eq("userId", userId)).take(MAX_FACTS);
    // Facts that contain every meaningful word the model passed.
    const keep = words.filter((w) => w.length > 2);
    const matches = facts.filter((f) => (keep.length ? keep : words).every((w) => f.text.toLowerCase().includes(w)));
    if (!matches.length) return `Tool error: no saved fact matches "${text}". Saved facts: ${facts.map((f) => f.text).join("; ") || "none"}.`;
    for (const f of matches) await ctx.db.delete(f._id);
    return `Forgot: ${matches.map((f) => f.text).join("; ")}.`;
  },
});

export const factsFor = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) =>
    (await ctx.db.query("memoryFacts").withIndex("by_user", (q) => q.eq("userId", userId)).take(MAX_FACTS)).map((f) => f.text),
});

// ---------- Inventory ----------

export const overview = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;
    const user = await ctx.db.get(userId);
    if (!user) return null;
    const count = (rows: unknown[]) => ({ n: Math.min(rows.length, COUNT_CAP), more: rows.length > COUNT_CAP });
    const messages = await ctx.db.query("messages").withIndex("by_user", (q) => q.eq("userId", userId)).take(COUNT_CAP + 1);
    const first = await ctx.db.query("messages").withIndex("by_user", (q) => q.eq("userId", userId)).first();
    const healthDays = await ctx.db.query("healthDays").withIndex("by_user_and_date", (q) => q.eq("userId", userId)).take(COUNT_CAP + 1);
    const meds = await ctx.db.query("medications").withIndex("by_user_and_active", (q) => q.eq("userId", userId)).take(COUNT_CAP + 1);
    const doses = await ctx.db.query("doseLogs").withIndex("by_user", (q) => q.eq("userId", userId)).take(COUNT_CAP + 1);
    const summaries = await ctx.db.query("visitSummaries").withIndex("by_user", (q) => q.eq("userId", userId)).take(COUNT_CAP + 1);
    const analyses = await ctx.db.query("creaoRuns").withIndex("by_user", (q) => q.eq("userId", userId)).take(COUNT_CAP + 1);
    const facts = await ctx.db.query("memoryFacts").withIndex("by_user", (q) => q.eq("userId", userId)).take(MAX_FACTS);
    return {
      profile: {
        email: user.email ?? null,
        location: user.location ?? null,
        timeZone: user.timeZone ?? null,
        telegramLinked: !!user.telegramChatId,
        voiceMode: user.voiceMode ?? true,
        language: user.language ?? "en",
        healthConnected: !!user.health,
        healthInAnalyses: !!user.health?.shareWithAnalysis,
      },
      facts: facts.map((f) => ({ _id: f._id, text: f.text, source: f.source, at: f._creationTime })),
      counts: {
        messages: count(messages),
        photos: count(messages.filter((m) => m.image)),
        healthDays: count(healthDays),
        reminders: count(meds),
        doses: count(doses),
        summaries: count(summaries),
        analyses: count(analyses),
      },
      since: first?._creationTime ?? null,
      chatClearedAt: user.chatClearedAt ?? null,
    };
  },
});

// ---------- Export ----------

const strip = <T extends { embedding?: unknown }>({ embedding, ...rest }: T) => rest;

export const exportPart = internalQuery({
  args: { userId: v.id("users"), cursor: v.union(v.string(), v.null()) },
  handler: async (ctx, { userId, cursor }) => {
    const page = await ctx.db
      .query("messages")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .paginate({ numItems: BATCH, cursor });
    return { messages: page.page.map(strip), cursor: page.continueCursor, done: page.isDone };
  },
});

export const exportRest = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    const user = await ctx.db.get(userId);
    const take = 2000;
    return {
      profile: user && {
        email: user.email,
        location: user.location,
        timeZone: user.timeZone,
        voiceMode: user.voiceMode,
        language: user.language,
        telegramLinked: !!user.telegramChatId,
        health: user.health,
        createdAt: user._creationTime,
      },
      facts: await ctx.db.query("memoryFacts").withIndex("by_user", (q) => q.eq("userId", userId)).take(MAX_FACTS),
      healthDays: await ctx.db.query("healthDays").withIndex("by_user_and_date", (q) => q.eq("userId", userId)).take(take),
      medications: (await ctx.db.query("medications").withIndex("by_user_and_active", (q) => q.eq("userId", userId)).take(take)).map(
        ({ jobId, ...m }) => m,
      ),
      doseLogs: await ctx.db.query("doseLogs").withIndex("by_user", (q) => q.eq("userId", userId)).take(take),
      visitSummaries: await ctx.db.query("visitSummaries").withIndex("by_user", (q) => q.eq("userId", userId)).take(take),
      symptomAnalyses: await ctx.db.query("creaoRuns").withIndex("by_user", (q) => q.eq("userId", userId)).take(take),
    };
  },
});

// Everything stored about the user, as JSON (photos are listed by storage id, not included).
export const exportData = action({
  args: {},
  handler: async (ctx): Promise<string> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not signed in");
    const messages: unknown[] = [];
    let cursor: string | null = null;
    for (let i = 0; i < 100; i++) {
      const part: { messages: unknown[]; cursor: string; done: boolean } = await ctx.runQuery(internal.me.exportPart, { userId, cursor });
      messages.push(...part.messages);
      if (part.done) break;
      cursor = part.cursor;
    }
    const rest = await ctx.runQuery(internal.me.exportRest, { userId });
    return JSON.stringify({ exportedAt: new Date().toISOString(), app: "Wellnest", ...rest, messages }, null, 2);
  },
});

// ---------- Deletion ----------

const category = v.union(
  v.literal("chat"),
  v.literal("health"),
  v.literal("reminders"),
  v.literal("summaries"),
  v.literal("facts"),
  v.literal("everything"),
);

const STEPS = {
  chat: ["messages", "photoUploads", "creaoRuns"],
  health: ["healthDays"],
  reminders: ["medications", "doseLogs"],
  summaries: ["visitSummaries"],
  facts: ["memoryFacts"],
} as const;
// Only "everything" also removes the account's devices and sign-in records.
const ACCOUNT_STEPS = ["pushTokens", "auth"] as const;
type Step = (typeof STEPS)[keyof typeof STEPS][number] | (typeof ACCOUNT_STEPS)[number];

export const deleteData = mutation({
  args: { category },
  handler: async (ctx, { category }) => {
    const userId = await requireUser(ctx);
    const steps: Step[] =
      category === "everything" ? [...Object.values(STEPS).flat(), ...ACCOUNT_STEPS] : [...STEPS[category]];
    // Fields on the user record go right away; rows are deleted in batches in the background.
    if (category === "chat" || category === "everything") await ctx.db.patch(userId, { chatClearedAt: undefined, analysisOfferedAt: undefined });
    if (category === "health" || category === "everything") await ctx.db.patch(userId, { health: undefined });
    if (category === "everything") await ctx.db.patch(userId, { deleting: true });
    await ctx.scheduler.runAfter(0, internal.me.purge, { userId, steps, deleteUser: category === "everything" });
  },
});

export const purge = internalMutation({
  args: { userId: v.id("users"), steps: v.array(v.string()), deleteUser: v.boolean() },
  handler: async (ctx, { userId, steps, deleteUser }) => {
    const [step, ...rest] = steps as Step[];
    if (!step) {
      if (deleteUser && (await ctx.db.get(userId))) await ctx.db.delete(userId);
      return;
    }
    const n = await purgeBatch(ctx, userId, step);
    await ctx.scheduler.runAfter(0, internal.me.purge, { userId, steps: n < BATCH ? rest : steps, deleteUser });
  },
});

// Deletes up to BATCH rows for this step; returns how many.
async function purgeBatch(ctx: MutationCtx, userId: Id<"users">, step: Step): Promise<number> {
  switch (step) {
    case "messages": {
      const rows = await ctx.db.query("messages").withIndex("by_user", (q) => q.eq("userId", userId)).take(BATCH);
      for (const m of rows) {
        if (m.image) await ctx.storage.delete(m.image).catch(() => {});
        await ctx.db.delete(m._id);
      }
      return rows.length;
    }
    case "photoUploads": {
      const rows = await ctx.db.query("photoUploads").withIndex("by_user", (q) => q.eq("userId", userId)).take(BATCH);
      for (const r of rows) {
        // Uploads that never made it into a message still have their file.
        if (!r.messageId) await ctx.storage.delete(r.storageId).catch(() => {});
        await ctx.db.delete(r._id);
      }
      return rows.length;
    }
    case "medications": {
      const rows = await ctx.db.query("medications").withIndex("by_user_and_active", (q) => q.eq("userId", userId)).take(BATCH);
      for (const m of rows) {
        if (m.jobId) await ctx.scheduler.cancel(m.jobId).catch(() => {});
        await ctx.db.delete(m._id);
      }
      return rows.length;
    }
    case "pushTokens":
    case "creaoRuns":
    case "doseLogs":
    case "visitSummaries":
    case "memoryFacts": {
      const rows = await ctx.db.query(step).withIndex("by_user", (q) => q.eq("userId", userId)).take(BATCH);
      for (const r of rows) await ctx.db.delete(r._id);
      return rows.length;
    }
    case "healthDays": {
      const rows = await ctx.db.query("healthDays").withIndex("by_user_and_date", (q) => q.eq("userId", userId)).take(BATCH);
      for (const r of rows) await ctx.db.delete(r._id);
      return rows.length;
    }
    case "auth": {
      let n = 0;
      const sessions = await ctx.db.query("authSessions").withIndex("userId", (q) => q.eq("userId", userId)).take(50);
      for (const s of sessions) {
        const tokens = await ctx.db.query("authRefreshTokens").withIndex("sessionId", (q) => q.eq("sessionId", s._id)).take(BATCH);
        for (const t of tokens) await ctx.db.delete(t._id);
        await ctx.db.delete(s._id);
        n += 1 + tokens.length;
      }
      const accounts = await ctx.db.query("authAccounts").withIndex("userIdAndProvider", (q) => q.eq("userId", userId)).take(50);
      for (const a of accounts) {
        const codes = await ctx.db.query("authVerificationCodes").withIndex("accountId", (q) => q.eq("accountId", a._id)).take(BATCH);
        for (const c of codes) await ctx.db.delete(c._id);
        await ctx.db.delete(a._id);
        n += 1 + codes.length;
      }
      // Another round only if a page was full.
      return n && (sessions.length === 50 || accounts.length === 50) ? BATCH : 0;
    }
  }
}

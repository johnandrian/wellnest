// Health records: the user adds a lab report or clinic letter as a photo or PDF, and the model reads it into a
// plain-language summary in their language and, for labs, one row per test so each test can be followed over time.
// The model also sees the latest results (forModel). The original file is kept so it can be opened again.
import { v } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";
import { internalAction, internalMutation, internalQuery, mutation, MutationCtx, query, QueryCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { complete, CORE_MODEL, imageDataUrl, VISION_MODEL } from "./lib/cortex";
import { langOf } from "./lib/language";
import { LabResult, parseRecord, recordPrompt, testKey } from "./lib/records";

const MAX_BYTES = 15 * 1024 * 1024;
const MAX_READING = 3; // records being read at once
const MAX_PDF_TEXT = 40_000;
const MAX_RECORDS = 500;

async function own(ctx: QueryCtx, id: Id<"records">) {
  const userId = await getAuthUserId(ctx);
  const record = await ctx.db.get(id);
  if (!userId || !record || record.userId !== userId) throw new Error("Not found");
  return record;
}

const today = (user: Doc<"users"> | null) => {
  const offset = user?.utcOffsetMin ?? 0;
  return new Date(Date.now() + offset * 60_000).toISOString().slice(0, 10);
};

// A photo or PDF the user uploaded and claimed (convex/chat.ts claimUpload) becomes a record, read in the background.
export const add = mutation({
  args: { storageId: v.id("_storage") },
  handler: async (ctx, { storageId }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not signed in");
    const upload = await ctx.db.query("photoUploads").withIndex("by_storage", (q) => q.eq("storageId", storageId)).unique();
    const file = await ctx.db.system.get("_storage", storageId);
    const type = file?.contentType ?? "";
    const fileType = type.startsWith("image/") ? "image" : type === "application/pdf" ? "pdf" : null;
    if (!upload || upload.userId !== userId || upload.messageId || upload.usedFor || !file || !fileType) {
      throw new Error("That file didn't upload. Please try again with a photo or a PDF.");
    }
    if (file.size > MAX_BYTES) throw new Error("That file is too big. Please use one under 15 MB.");
    const mine = await ctx.db.query("records").withIndex("by_user", (q) => q.eq("userId", userId)).order("desc").take(MAX_RECORDS);
    if (mine.length >= MAX_RECORDS) throw new Error(`You can keep up to ${MAX_RECORDS} records.`);
    if (mine.filter((r) => r.status === "reading").length >= MAX_READING) throw new Error("Still reading your last few records. Try again in a minute.");
    await ctx.db.patch(upload._id, { usedFor: "record" });
    const id = await ctx.db.insert("records", { userId, status: "reading", file: storageId, fileType });
    await ctx.scheduler.runAfter(0, internal.records.read, { id });
    return id;
  },
});

export const forReading = internalQuery({
  args: { id: v.id("records") },
  handler: async (ctx, { id }) => {
    const record = await ctx.db.get(id);
    if (!record || record.status !== "reading" || !record.file) return null;
    return { record, language: langOf(await ctx.db.get(record.userId)) };
  },
});

export const read = internalAction({
  args: { id: v.id("records") },
  handler: async (ctx, { id }): Promise<void> => {
    const job = await ctx.runQuery(internal.records.forReading, { id });
    if (!job) return;
    const { record, language } = job;
    try {
      const blob = await ctx.storage.get(record.file!);
      if (!blob) throw new Error("gone");
      let content: { type: "text"; text: string } | { type: "image_url"; image_url: { url: string } };
      if (record.fileType === "pdf") {
        const text: string = await ctx.runAction(internal.recordsPdf.text, { storageId: record.file! });
        if (text.trim().length < 20) {
          await ctx.runMutation(internal.records.fail, { id, error: "noText" });
          return;
        }
        content = { type: "text", text: `The record's text:\n\n${text.slice(0, MAX_PDF_TEXT)}` };
      } else {
        content = { type: "image_url", image_url: { url: await imageDataUrl(blob) } };
      }
      const reply = await complete({
        model: record.fileType === "image" ? VISION_MODEL() : CORE_MODEL(),
        messages: [
          { role: "system", content: recordPrompt(language) },
          { role: "user", content: [content] },
        ],
        maxTokens: 4000,
      });
      const parsed = parseRecord(reply.content ?? "");
      if (!parsed) {
        await ctx.runMutation(internal.records.fail, { id, error: "notRecord" });
        return;
      }
      await ctx.runMutation(internal.records.save, { id, ...parsed });
    } catch (e) {
      console.error("record read failed", e);
      await ctx.runMutation(internal.records.fail, { id, error: "failed" });
    }
  },
});

export const fail = internalMutation({
  args: { id: v.id("records"), error: v.string() },
  handler: async (ctx, { id, error }) => {
    if (await ctx.db.get(id)) await ctx.db.patch(id, { status: "failed", error });
  },
});

const result = v.object({
  test: v.string(),
  value: v.optional(v.number()),
  text: v.optional(v.string()),
  unit: v.optional(v.string()),
  low: v.optional(v.number()),
  high: v.optional(v.number()),
  flag: v.optional(v.union(v.literal("low"), v.literal("normal"), v.literal("high"), v.literal("abnormal"))),
  explanation: v.string(),
});

export const save = internalMutation({
  args: {
    id: v.id("records"),
    kind: v.union(v.literal("lab"), v.literal("letter"), v.literal("imaging"), v.literal("other")),
    title: v.string(),
    date: v.optional(v.string()),
    source: v.optional(v.string()),
    summary: v.string(),
    results: v.array(result),
  },
  handler: async (ctx, { id, results, date, ...fields }) => {
    const record = await ctx.db.get(id);
    if (!record) return; // deleted while it was read
    const day = date ?? today(await ctx.db.get(record.userId));
    await ctx.db.patch(id, { ...fields, date: day, status: "done", error: undefined });
    for (const r of results) await ctx.db.insert("labResults", { userId: record.userId, recordId: id, date: day, key: testKey(r.test), ...r });
  },
});

// Newest first, with how many results are outside the range.
export const list = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];
    const records = await ctx.db.query("records").withIndex("by_user", (q) => q.eq("userId", userId)).order("desc").take(100);
    const out = await Promise.all(
      records.map(async (r) => {
        const results = await ctx.db.query("labResults").withIndex("by_record", (q) => q.eq("recordId", r._id)).take(100);
        return {
          _id: r._id,
          _creationTime: r._creationTime,
          status: r.status,
          error: r.error ?? null,
          kind: r.kind ?? null,
          title: r.title ?? null,
          date: r.date ?? null,
          source: r.source ?? null,
          fileType: r.fileType,
          results: results.length,
          flagged: results.filter((x) => x.flag && x.flag !== "normal").length,
        };
      }),
    );
    // By the record's own date, newest first; ones still being read on top.
    return out.sort((a, b) => (a.status === "reading" ? -1 : 0) - (b.status === "reading" ? -1 : 0) || (b.date ?? "").localeCompare(a.date ?? ""));
  },
});

export const detail = query({
  args: { id: v.id("records") },
  handler: async (ctx, { id }) => {
    const record = await own(ctx, id);
    const results = await ctx.db.query("labResults").withIndex("by_record", (q) => q.eq("recordId", id)).take(100);
    return {
      ...record,
      fileUrl: record.file ? await ctx.storage.getUrl(record.file) : null,
      results: results.map(({ _id, test, key, value, text, unit, low, high, flag, explanation }) => ({ _id, test, key, value, text, unit, low, high, flag, explanation })),
    };
  },
});

// Every numeric test seen more than once or flagged, with its values over time (oldest first) for a trend.
export const trends = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];
    const rows = await ctx.db.query("labResults").withIndex("by_user_and_date", (q) => q.eq("userId", userId)).take(2000);
    const byKey = new Map<string, Doc<"labResults">[]>();
    for (const r of rows) if (r.value !== undefined) byKey.set(r.key, [...(byKey.get(r.key) ?? []), r]);
    return [...byKey.values()]
      .map((list) => {
        const latest = list[list.length - 1];
        return {
          key: latest.key,
          test: latest.test,
          unit: latest.unit ?? "",
          low: latest.low ?? null,
          high: latest.high ?? null,
          flag: latest.flag ?? null,
          explanation: latest.explanation,
          points: list.map((r) => ({ date: r.date, value: r.value! })),
        };
      })
      .filter((t) => t.points.length > 1 || (t.flag && t.flag !== "normal"))
      .sort((a, b) => b.points[b.points.length - 1].date.localeCompare(a.points[a.points.length - 1].date) || a.test.localeCompare(b.test));
  },
});

export const remove = mutation({
  args: { id: v.id("records") },
  handler: async (ctx, { id }) => {
    const record = await own(ctx, id);
    await removeRecord(ctx, record);
  },
});

export async function removeRecord(ctx: MutationCtx, record: Doc<"records">) {
  const results = await ctx.db.query("labResults").withIndex("by_record", (q) => q.eq("recordId", record._id)).take(200);
  for (const r of results) await ctx.db.delete(r._id);
  if (record.file) {
    const upload = await ctx.db.query("photoUploads").withIndex("by_storage", (q) => q.eq("storageId", record.file!)).unique();
    if (upload) await ctx.db.delete(upload._id);
    await ctx.storage.delete(record.file).catch(() => {});
  }
  await ctx.db.delete(record._id);
}

// For the model: the latest value of each test, out-of-range ones first, and the newest letters' summaries.
export async function recordsText(ctx: QueryCtx, userId: Id<"users">): Promise<string> {
  const rows = await ctx.db.query("labResults").withIndex("by_user_and_date", (q) => q.eq("userId", userId)).order("desc").take(500);
  const latest = new Map<string, Doc<"labResults">>();
  for (const r of rows) if (!latest.has(r.key)) latest.set(r.key, r);
  const show = (r: LabResult & { date: string }) =>
    `- ${r.date} ${r.test}: ${r.value ?? r.text}${r.unit ? ` ${r.unit}` : ""}` +
    (r.low !== undefined || r.high !== undefined ? ` (range ${r.low ?? ""}-${r.high ?? ""})` : "") +
    (r.flag && r.flag !== "normal" ? ` [${r.flag}]` : "");
  const tests = [...latest.values()].sort((a, b) => Number(!a.flag || a.flag === "normal") - Number(!b.flag || b.flag === "normal")).slice(0, 40);
  const letters = (await ctx.db.query("records").withIndex("by_user", (q) => q.eq("userId", userId)).order("desc").take(20))
    .filter((r) => r.status === "done" && r.kind !== "lab" && r.summary)
    .slice(0, 3);
  const parts: string[] = [];
  if (tests.length) parts.push(`Latest lab results from the user's records (as printed on the reports):\n${tests.map(show).join("\n")}`);
  if (letters.length) parts.push(`Recent clinic letters and reports:\n${letters.map((r) => `- ${r.date} ${r.title}: ${r.summary}`).join("\n")}`);
  return parts.join("\n\n");
}

export const forModel = internalQuery({
  args: { userId: v.id("users") },
  handler: (ctx, { userId }) => recordsText(ctx, userId),
});

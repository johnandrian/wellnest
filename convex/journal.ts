// Symptom journal (convex/lib/journal.ts): the model logs symptoms from chat with log_symptom, the user adds, edits,
// or removes entries in the Journal tab (any past day, with an optional time), writes notes in their own words (with
// any symptoms in them logged too, see Notes below), and `view` gives the tab its charts and patterns.
import { v } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";
import { internalAction, internalMutation, internalQuery, mutation, MutationCtx, query, QueryCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import { complete, CORE_MODEL } from "./lib/cortex";
import { Doc, Id } from "./_generated/dataModel";
import { clampSeverity, dailyPatterns, exercisePatterns, dailySeverity, dailySummary, DailyLog, Entry, entrySource, MAX_PER_DAY, normalizeSymptom, patterns, summaries } from "./lib/journal";
import { isDate } from "./lib/health";
import { painAsEntries, withLoggedPeriods } from "./lib/trackers";
import { trackersSince } from "./trackers";
import { adherence } from "./exercises";
import { normalizeTime, zoneOffsetMin } from "./lib/reminders";

const MAX_ROWS = 1000;

// The user's calendar date now, in their time zone (UTC until the app has reported one).
export function localToday(user: Doc<"users"> | null, now = Date.now()) {
  const offset = zoneOffsetMin(now, user?.timeZone ?? "UTC", user?.utcOffsetMin ?? 0);
  return new Date(now + offset * 60_000).toISOString().slice(0, 10);
}

async function addEntry(
  ctx: MutationCtx,
  userId: Id<"users">,
  args: { symptom: string; severity?: number; note?: string; date?: string; time?: string; source: "chat" | "manual" | "checkin" | "note" },
): Promise<{ id: Id<"symptomEntries">; date: string; symptom: string } | { error: string }> {
  const symptom = normalizeSymptom(args.symptom);
  if (!symptom) return { error: "Say which symptom." };
  const user = await ctx.db.get(userId);
  const today = localToday(user);
  const date = args.date && isDate(args.date) && args.date <= today ? args.date : today;
  const sameDay = await ctx.db
    .query("symptomEntries")
    .withIndex("by_user_and_date", (q) => q.eq("userId", userId).eq("date", date))
    .take(MAX_PER_DAY);
  if (sameDay.length >= MAX_PER_DAY) return { error: `That day already has ${MAX_PER_DAY} entries.` };
  const severity = clampSeverity(args.severity);
  const note = args.note?.trim().slice(0, 300) || undefined;
  const time = args.time ? (normalizeTime(args.time) ?? undefined) : undefined;
  // Same symptom again that day: update it instead of adding a second entry.
  const existing = sameDay.find((e) => e.symptom === symptom);
  if (existing) {
    await ctx.db.patch(existing._id, { severity: severity ?? existing.severity, note: note ?? existing.note, time: time ?? existing.time });
    return { id: existing._id, date, symptom };
  }
  const id = await ctx.db.insert("symptomEntries", { userId, date, symptom, severity, note, time, source: args.source });
  return { id, date, symptom };
}

export const add = mutation({
  args: { symptom: v.string(), severity: v.optional(v.number()), note: v.optional(v.string()), date: v.optional(v.string()), time: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not signed in");
    const res = await addEntry(ctx, userId, { ...args, source: "manual" });
    if ("error" in res) throw new Error(res.error);
  },
});

// Changing an entry from the Journal tab. `severity: null` and an empty note or time clear them.
export const update = mutation({
  args: {
    id: v.id("symptomEntries"),
    symptom: v.optional(v.string()),
    severity: v.optional(v.union(v.number(), v.null())),
    note: v.optional(v.string()),
    date: v.optional(v.string()),
    time: v.optional(v.string()),
  },
  handler: async (ctx, { id, ...a }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not signed in");
    const row = await ctx.db.get(id);
    if (!row || row.userId !== userId) throw new Error("Not found");
    const symptom = a.symptom === undefined ? row.symptom : normalizeSymptom(a.symptom);
    if (!symptom) throw new Error("Say which symptom.");
    const today = localToday(await ctx.db.get(userId));
    const date = a.date === undefined ? row.date : a.date;
    if (!isDate(date) || date > today) throw new Error("Pick a day up to today.");
    if (date !== row.date || symptom !== row.symptom) {
      const there = await ctx.db
        .query("symptomEntries")
        .withIndex("by_user_and_date", (q) => q.eq("userId", userId).eq("date", date))
        .take(MAX_PER_DAY);
      if (there.some((e) => e._id !== id && e.symptom === symptom)) throw new Error("That day already has this symptom. Change that entry instead.");
      if (date !== row.date && there.length >= MAX_PER_DAY) throw new Error(`That day already has ${MAX_PER_DAY} entries.`);
    }
    const time = a.time === undefined ? row.time : a.time.trim() ? normalizeTime(a.time) : undefined;
    if (time === null) throw new Error("Times must look like 08:00 or 20:30.");
    await ctx.db.patch(id, {
      symptom,
      date,
      time,
      severity: a.severity === undefined ? row.severity : (clampSeverity(a.severity ?? undefined) ?? undefined),
      note: a.note === undefined ? row.note : a.note.trim().slice(0, 300) || undefined,
    });
  },
});

export const remove = mutation({
  args: { id: v.id("symptomEntries") },
  handler: async (ctx, { id }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not signed in");
    const row = await ctx.db.get(id);
    if (!row || row.userId !== userId) throw new Error("Not found");
    await ctx.db.delete(id);
  },
});

// log_symptom from chat, and answers to check-ins (convex/checkins.ts).
export const logFromChat = internalMutation({
  args: {
    userId: v.id("users"),
    symptom: v.string(),
    severity: v.optional(v.number()),
    note: v.optional(v.string()),
    date: v.optional(v.string()),
    source: v.optional(entrySource),
  },
  handler: async (ctx, { userId, source: from, ...args }) => {
    const res = await addEntry(ctx, userId, { ...args, source: from ?? "chat" });
    if ("error" in res) return `Tool error: ${res.error}`;
    return `Logged in the symptom journal: ${res.symptom}${args.severity !== undefined ? ` ${clampSeverity(args.severity)}/10` : ""} on ${res.date}. The user can see trends in the Journal tab.`;
  },
});

export async function entriesSince(ctx: QueryCtx, userId: Id<"users">, since: string): Promise<Entry[]> {
  const rows = await ctx.db
    .query("symptomEntries")
    .withIndex("by_user_and_date", (q) => q.eq("userId", userId).gte("date", since))
    .take(MAX_ROWS);
  return rows.map(({ date, symptom, severity, note }) => ({ date, symptom, severity, note }));
}

export const since = internalQuery({
  args: { userId: v.id("users"), since: v.string() },
  handler: (ctx, { userId, since }) => entriesSince(ctx, userId, since),
});

export async function dailySince(ctx: QueryCtx, userId: Id<"users">, since: string): Promise<DailyLog[]> {
  const rows = await ctx.db
    .query("dailyLogs")
    .withIndex("by_user_and_date", (q) => q.eq("userId", userId).gte("date", since))
    .take(400);
  return rows.filter((r) => !r.skipped).map(({ date, mood, energy, sleepQuality, note, foods, caffeine }) => ({ date, mood, energy, sleepQuality, note, foods, caffeine }));
}

export const dailyFrom = internalQuery({
  args: { userId: v.id("users"), since: v.string() },
  handler: (ctx, { userId, since }) => dailySince(ctx, userId, since),
});

// The Journal tab: per-symptom daily severity for the charts, sleep for comparison, patterns and recent entries.
// `since` comes from the app (queries can't read the clock).
export const view = query({
  args: { since: v.string(), today: v.optional(v.string()) },
  handler: async (ctx, { since, today }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId || !isDate(since)) return null;
    const tracked = await trackersSince(ctx, userId, since);
    const entries = [...(await entriesSince(ctx, userId, since)), ...painAsEntries(tracked)];
    const daily = await dailySince(ctx, userId, since);
    // Period days logged in the app count with the phone's (convex/lib/trackers.ts).
    const health = withLoggedPeriods(
      (
        await ctx.db
          .query("healthDays")
          .withIndex("by_user_and_date", (q) => q.eq("userId", userId).gte("date", since))
          .take(100)
      ).map(({ date, metrics }) => ({ date, metrics })),
      tracked,
    );
    const recent = await ctx.db
      .query("symptomEntries")
      .withIndex("by_user_and_date", (q) => q.eq("userId", userId))
      .order("desc")
      .take(30);
    const counts = new Map<string, number>();
    for (const e of entries) counts.set(e.symptom, (counts.get(e.symptom) ?? 0) + 1);
    const series = dailySeverity(entries);
    return {
      symptoms: [...counts.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([name, count]) => ({
          name,
          count,
          points: [...(series.get(name) ?? new Map()).entries()].map(([date, severity]) => ({ date, severity })),
        })),
      sleep: health.flatMap((d) => (d.metrics.sleepHours === undefined ? [] : [{ date: d.date, hours: d.metrics.sleepHours }])),
      periodDays: health.filter((d) => d.metrics.menstrualFlow && d.metrics.menstrualFlow !== "none").map((d) => d.date),
      daily: daily.map(({ date, mood, energy, sleepQuality }) => ({ date, mood: mood ?? null, energy: energy ?? null, sleepQuality: sleepQuality ?? null })),
      summaries: [...summaries(entries), ...dailySummary(daily)],
      patterns: [
        ...patterns(entries, health),
        ...dailyPatterns(daily, health),
        ...(today && isDate(today) ? await adherence(ctx, userId, since, today).then((a) => exercisePatterns(entries, a.doneDates, a.missedDates)) : []),
      ],
      recent: recent.map(({ _id, date, symptom, severity, note, time, source }) => ({ _id, date, symptom, severity: severity ?? null, note: note ?? null, time: time ?? null, source })),
    };
  },
});

// Notes: what the user writes in the Journal in their own words. Each is kept as written (and read by the model and
// visit summaries), and the model picks out any symptoms in it to log, as the chat would (source "note").
const MAX_NOTE = 2000;
const NOTE_PROMPT =
  "Read this journal entry a person wrote about their health. List every symptom they say they have or had that day, " +
  'as a JSON array like [{"symptom": "headache", "severity": 6}]. Use a short common English name (headache, nausea, ' +
  "cramps, fatigue). Give severity 0-10 only when they say how bad it was (a number, or words like mild = 3, bad = 7, " +
  "worst ever = 10); leave it out otherwise. Leave out symptoms they say are gone, someone else's, or only feared. " +
  "Answer with the JSON array only, [] if there are none.";

// The model's answer -> symptoms to log. Tolerates a code fence or words around the JSON.
export function parseNoteSymptoms(content: string | null): { symptom: string; severity?: number }[] {
  const m = content?.match(/\[[\s\S]*\]/);
  if (!m) return [];
  try {
    const arr = JSON.parse(m[0]);
    if (!Array.isArray(arr)) return [];
    const out: { symptom: string; severity?: number }[] = [];
    for (const x of arr) {
      const symptom = typeof x?.symptom === "string" ? normalizeSymptom(x.symptom) : "";
      if (!symptom || out.some((o) => o.symptom === symptom)) continue;
      const severity = clampSeverity(typeof x.severity === "number" ? x.severity : undefined);
      out.push(severity === undefined ? { symptom } : { symptom, severity });
    }
    return out.slice(0, 8);
  } catch {
    return [];
  }
}

export async function notesSince(ctx: QueryCtx, userId: Id<"users">, since: string) {
  const rows = await ctx.db
    .query("journalNotes")
    .withIndex("by_user_and_date", (q) => q.eq("userId", userId).gte("date", since))
    .take(200);
  return rows.map(({ date, text }) => ({ date, text }));
}

// For the model's journal read and visit summaries.
export function notesText(notes: { date: string; text: string }[]) {
  return notes.length ? `Notes in their own words:\n${notes.map((n) => `- ${n.date}: ${n.text}`).join("\n")}` : "";
}

export const notesFrom = internalQuery({
  args: { userId: v.id("users"), since: v.string() },
  handler: (ctx, { userId, since }) => notesSince(ctx, userId, since),
});

// Save a note (the Journal's Log tab). `at`: when it was written, for notes sent later from the offline queue.
export const addNote = mutation({
  args: { text: v.string(), at: v.optional(v.number()) },
  handler: async (ctx, { text, at }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not signed in");
    const clean = text.trim().slice(0, MAX_NOTE);
    if (!clean) throw new Error("Write something first.");
    const when = at && at <= Date.now() ? at : Date.now();
    const user = await ctx.db.get(userId);
    const id = await ctx.db.insert("journalNotes", { userId, date: localToday(user, when), at: when, text: clean });
    await ctx.scheduler.runAfter(0, internal.journal.extractNote, { id });
    return id;
  },
});

// The Log tab's notes from `since` on, newest first.
export const notes = query({
  args: { since: v.string() },
  handler: async (ctx, { since }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId || !isDate(since)) return [];
    const rows = await ctx.db
      .query("journalNotes")
      .withIndex("by_user_and_date", (q) => q.eq("userId", userId).gte("date", since))
      .order("desc")
      .take(50);
    return rows.map(({ _id, date, at, text, logged }) => ({ _id, date, at, text, logged: logged ?? null }));
  },
});

// Remove a note. What was logged from it stays in the journal (it can be changed or removed there).
export const removeNote = mutation({
  args: { id: v.id("journalNotes") },
  handler: async (ctx, { id }) => {
    const userId = await getAuthUserId(ctx);
    const note = await ctx.db.get(id);
    if (!userId || !note || note.userId !== userId) throw new Error("Not found");
    await ctx.db.delete(id);
  },
});

export const noteFor = internalQuery({
  args: { id: v.id("journalNotes") },
  handler: async (ctx, { id }) => ctx.db.get(id),
});

export const extractNote = internalAction({
  args: { id: v.id("journalNotes") },
  handler: async (ctx, { id }) => {
    const note: Doc<"journalNotes"> | null = await ctx.runQuery(internal.journal.noteFor, { id });
    if (!note) return;
    try {
      const { content } = await complete({
        model: CORE_MODEL(),
        messages: [
          { role: "system", content: NOTE_PROMPT },
          { role: "user", content: note.text },
        ],
        maxTokens: 400,
      });
      await ctx.runMutation(internal.journal.logFromNote, { id, symptoms: parseNoteSymptoms(content) });
    } catch (e) {
      // The note stays saved; nothing is logged from it.
      console.error("journal note extraction failed", e);
      await ctx.runMutation(internal.journal.logFromNote, { id, symptoms: [] });
    }
  },
});

export const logFromNote = internalMutation({
  args: { id: v.id("journalNotes"), symptoms: v.array(v.object({ symptom: v.string(), severity: v.optional(v.number()) })) },
  handler: async (ctx, { id, symptoms }) => {
    const note = await ctx.db.get(id);
    if (!note) return;
    const logged: { symptom: string; severity?: number }[] = [];
    for (const x of symptoms) {
      const res = await addEntry(ctx, note.userId, { ...x, date: note.date, source: "note" });
      if (!("error" in res)) logged.push(x);
    }
    await ctx.db.patch(id, { logged });
  },
});

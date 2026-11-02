// Exercises and physio routines: what to do (sets, reps or minutes) on which weekdays, checked off each day.
// Adherence goes to the model, visit summaries and reports; the journal compares symptoms on done vs missed days.
import { v } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";
import { internalMutation, internalQuery, mutation, MutationCtx, query, QueryCtx } from "./_generated/server";
import { Doc, Id } from "./_generated/dataModel";
import { isDate } from "./lib/health";
import { localToday } from "./journal";

const MAX_ACTIVE = 30;
const weekday = (date: string) => new Date(`${date}T12:00:00Z`).getUTCDay(); // 0 = Sunday

// Scheduled on that date: no weekdays means every day.
export const scheduledOn = (ex: { days: number[]; _creationTime: number }, date: string) =>
  (ex.days.length === 0 || ex.days.includes(weekday(date))) && date >= new Date(ex._creationTime).toISOString().slice(0, 10);

const cleanDays = (days: number[]) => [...new Set(days.filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))].sort();
const n = (x: number | undefined, hi: number) => (x !== undefined && Number.isFinite(x) && x > 0 && x <= hi ? Math.round(x) : undefined);

type AddArgs = { name: string; sets?: number; reps?: number; minutes?: number; days?: number[]; notes?: string };

async function addExercise(ctx: MutationCtx, userId: Id<"users">, a: AddArgs) {
  const name = a.name.trim().slice(0, 80);
  if (!name) throw new Error("Give the exercise a name.");
  const active = await ctx.db.query("exercises").withIndex("by_user_and_active", (q) => q.eq("userId", userId).eq("active", true)).take(MAX_ACTIVE);
  if (active.length >= MAX_ACTIVE) throw new Error(`Up to ${MAX_ACTIVE} exercises at a time.`);
  return await ctx.db.insert("exercises", {
    userId,
    name,
    sets: n(a.sets, 50),
    reps: n(a.reps, 500),
    minutes: n(a.minutes, 600),
    days: cleanDays(a.days ?? []),
    notes: a.notes?.trim().slice(0, 500) || undefined,
    active: true,
  });
}

const fields = { name: v.string(), sets: v.optional(v.number()), reps: v.optional(v.number()), minutes: v.optional(v.number()), days: v.optional(v.array(v.number())), notes: v.optional(v.string()) };

async function me(ctx: MutationCtx | QueryCtx) {
  const userId = await getAuthUserId(ctx);
  if (!userId) throw new Error("Not signed in");
  return userId;
}

async function own(ctx: MutationCtx, id: Id<"exercises">) {
  const userId = await me(ctx);
  const row = await ctx.db.get(id);
  if (!row || row.userId !== userId) throw new Error("Not found");
  return row;
}

export const add = mutation({ args: fields, handler: async (ctx, a) => addExercise(ctx, await me(ctx), a) });

export const update = mutation({
  args: { id: v.id("exercises"), ...fields },
  handler: async (ctx, { id, ...a }) => {
    await own(ctx, id);
    const name = a.name.trim().slice(0, 80);
    if (!name) throw new Error("Give the exercise a name.");
    await ctx.db.patch(id, { name, sets: n(a.sets, 50), reps: n(a.reps, 500), minutes: n(a.minutes, 600), days: cleanDays(a.days ?? []), notes: a.notes?.trim().slice(0, 500) || undefined });
  },
});

// Stopped exercises stay for the history.
export const stop = mutation({ args: { id: v.id("exercises") }, handler: async (ctx, { id }) => (await own(ctx, id), ctx.db.patch(id, { active: false })) });

async function setDone(ctx: MutationCtx, ex: Doc<"exercises">, date: string, done: boolean) {
  const existing = await ctx.db.query("exerciseLogs").withIndex("by_exercise_and_date", (q) => q.eq("exerciseId", ex._id).eq("date", date)).unique();
  if (done && !existing) await ctx.db.insert("exerciseLogs", { userId: ex.userId, exerciseId: ex._id, date });
  if (!done && existing) await ctx.db.delete(existing._id);
}

export const toggle = mutation({
  args: { id: v.id("exercises"), date: v.string(), done: v.boolean() },
  handler: async (ctx, { id, date, done }) => {
    const ex = await own(ctx, id);
    const today = localToday(await ctx.db.get(ex.userId));
    if (!isDate(date) || date > today) throw new Error("Pick today or an earlier day.");
    await setDone(ctx, ex, date, done);
  },
});

// The Exercise tab: active exercises with what's due on `date`, and the last 14 days of ticks.
export const list = query({
  args: { date: v.string() },
  handler: async (ctx, { date }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId || !isDate(date)) return null;
    const exercises = await ctx.db.query("exercises").withIndex("by_user_and_active", (q) => q.eq("userId", userId).eq("active", true)).take(MAX_ACTIVE);
    const from = new Date(Date.parse(`${date}T00:00:00Z`) - 13 * 86_400_000).toISOString().slice(0, 10);
    const logs = await ctx.db.query("exerciseLogs").withIndex("by_user_and_date", (q) => q.eq("userId", userId).gte("date", from).lte("date", date)).take(1000);
    return exercises.map((ex) => {
      const done = new Set(logs.filter((l) => l.exerciseId === ex._id).map((l) => l.date));
      const last14 = Array.from({ length: 14 }, (_, i) => {
        const d = new Date(Date.parse(`${from}T00:00:00Z`) + i * 86_400_000).toISOString().slice(0, 10);
        return { date: d, scheduled: scheduledOn(ex, d), done: done.has(d) };
      });
      return {
        _id: ex._id,
        name: ex.name,
        sets: ex.sets ?? null,
        reps: ex.reps ?? null,
        minutes: ex.minutes ?? null,
        days: ex.days,
        notes: ex.notes ?? null,
        dueToday: scheduledOn(ex, date),
        doneToday: done.has(date),
        last14,
      };
    });
  },
});

// Per exercise: done on how many of the days it was scheduled, plus dates done and missed (for patterns).
export async function adherence(ctx: QueryCtx, userId: Id<"users">, from: string, to: string) {
  const exercises = (await ctx.db.query("exercises").withIndex("by_user_and_active", (q) => q.eq("userId", userId)).take(100)).filter(
    (e) => new Date(e._creationTime).toISOString().slice(0, 10) <= to,
  );
  const logs = await ctx.db.query("exerciseLogs").withIndex("by_user_and_date", (q) => q.eq("userId", userId).gte("date", from).lte("date", to)).take(2000);
  const doneDates = new Set(logs.map((l) => l.date));
  const missedDates = new Set<string>();
  const lines: string[] = [];
  for (const ex of exercises) {
    let scheduled = 0;
    let done = 0;
    for (let t = Date.parse(`${from}T00:00:00Z`); t <= Date.parse(`${to}T00:00:00Z`); t += 86_400_000) {
      const d = new Date(t).toISOString().slice(0, 10);
      if (!scheduledOn(ex, d)) continue;
      scheduled++;
      if (logs.some((l) => l.exerciseId === ex._id && l.date === d)) done++;
      else if (ex.active) missedDates.add(d);
    }
    if (!scheduled) continue;
    const plan = [ex.sets && ex.reps ? `${ex.sets}x${ex.reps}` : ex.reps ? `${ex.reps} reps` : "", ex.minutes ? `${ex.minutes} min` : ""].filter(Boolean).join(", ");
    lines.push(`- ${ex.name}${plan ? ` (${plan})` : ""}${ex.active ? "" : " [stopped]"}: done ${done} of ${scheduled} scheduled days`);
  }
  for (const d of doneDates) missedDates.delete(d);
  return { text: lines.join("\n"), doneDates: [...doneDates], missedDates: [...missedDates] };
}

export const adherenceFor = internalQuery({
  args: { userId: v.id("users"), from: v.string(), to: v.string() },
  handler: (ctx, { userId, from, to }) => adherence(ctx, userId, from, to),
});

// The model's tools.
export const addFromChat = internalMutation({
  args: { userId: v.id("users"), ...fields },
  handler: async (ctx, { userId, ...a }) => {
    try {
      await addExercise(ctx, userId, a);
      return `Added "${a.name}" to the user's exercises. They tick it off in the Exercise tab, or tell you when it's done.`;
    } catch (e) {
      return `Tool error: ${(e as Error).message}`;
    }
  },
});

export const doneFromChat = internalMutation({
  args: { userId: v.id("users"), name: v.string(), date: v.optional(v.string()) },
  handler: async (ctx, { userId, name, date }) => {
    const wanted = name.trim().toLowerCase();
    const exercises = await ctx.db.query("exercises").withIndex("by_user_and_active", (q) => q.eq("userId", userId).eq("active", true)).take(MAX_ACTIVE);
    const matches = wanted === "all" ? exercises : exercises.filter((e) => e.name.toLowerCase().includes(wanted) || wanted.includes(e.name.toLowerCase()));
    if (!matches.length) return `Tool error: no exercise matches "${name}". Current: ${exercises.map((e) => e.name).join(", ") || "none"}.`;
    const today = localToday(await ctx.db.get(userId));
    const day = date && isDate(date) && date <= today ? date : today;
    for (const ex of matches) await setDone(ctx, ex, day, true);
    return `Marked done for ${day}: ${matches.map((e) => e.name).join(", ")}.`;
  },
});

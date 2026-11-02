// Medication reminders: each due dose posts a reminder message in the app chat with Taken / Skip buttons.
// Set up from the Reminders panel or by asking in chat (set_medication_reminder). Times follow the user's time zone.
import { v } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";
import { internalMutation, internalQuery, mutation, MutationCtx, query, QueryCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import { Doc, Id } from "./_generated/dataModel";
import { checkSchedule, describeSchedule, localTimeText, MAX_ACTIVE, nextDue, schedule, Schedule } from "./lib/reminders";
import { langOf, t, timeText } from "./lib/language";
import { notify } from "./push";

const DAY_MS = 24 * 60 * 60 * 1000;
// A dose due within a minute of a course's end counts as past it ("every 12 hours for 1 day" is 2 reminders).
const END_SLACK_MS = 60_000;

type AddArgs = { name: string; dose?: string; schedule: Schedule; days?: number };

function zoneOf(user: Doc<"users"> | null) {
  return { timeZone: user?.timeZone ?? "UTC", utcOffsetMin: user?.utcOffsetMin ?? 0 };
}

async function schedule_(ctx: MutationCtx, id: Id<"medications">, at: number) {
  const jobId = await ctx.scheduler.runAt(at, internal.reminders.fire, { id, dueAt: at });
  await ctx.db.patch(id, { nextAt: at, jobId });
}

// Shared by the panel and the chat tool. Returns the new reminder, or an error to show the user.
async function addMedication(ctx: MutationCtx, userId: Id<"users">, args: AddArgs) {
  const name = args.name.trim().slice(0, 80);
  if (!name) return { error: "Give the medication a name." };
  const checked = checkSchedule(args.schedule);
  if ("error" in checked) return checked;
  const active = await ctx.db
    .query("medications")
    .withIndex("by_user_and_active", (q) => q.eq("userId", userId).eq("active", true))
    .take(MAX_ACTIVE);
  if (active.length >= MAX_ACTIVE) return { error: `You can have up to ${MAX_ACTIVE} active reminders.` };
  const user = await ctx.db.get(userId);
  const { timeZone, utcOffsetMin } = zoneOf(user);
  const now = Date.now();
  const days = args.days && args.days > 0 ? Math.min(365, Math.round(args.days)) : undefined;
  const id = await ctx.db.insert("medications", {
    userId,
    name,
    dose: args.dose?.trim().slice(0, 80) || undefined,
    schedule: checked.schedule,
    timeZone,
    utcOffsetMin,
    active: true,
    ...(days && { endsAt: now + days * DAY_MS }),
  });
  const at = nextDue(checked.schedule, now, timeZone, utcOffsetMin);
  await schedule_(ctx, id, at);
  return { id, nextAt: at, timeZone, schedule: checked.schedule };
}

async function stop(ctx: MutationCtx, med: Doc<"medications">) {
  if (med.jobId) await ctx.scheduler.cancel(med.jobId);
  await ctx.db.patch(med._id, { active: false, nextAt: undefined, jobId: undefined, stoppedAt: Date.now() });
}

export const add = mutation({
  args: { name: v.string(), dose: v.optional(v.string()), schedule, days: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not signed in");
    const res = await addMedication(ctx, userId, args);
    if ("error" in res) throw new Error(res.error);
    return res.id;
  },
});

export const list = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];
    const meds = await ctx.db
      .query("medications")
      .withIndex("by_user_and_active", (q) => q.eq("userId", userId).eq("active", true))
      .take(MAX_ACTIVE);
    return meds.map((m) => ({
      _id: m._id,
      name: m.name,
      dose: m.dose ?? null,
      schedule: describeSchedule(m.schedule),
      nextAt: m.nextAt ?? null,
      endsAt: m.endsAt ?? null,
    }));
  },
});

export const remove = mutation({
  args: { id: v.id("medications") },
  handler: async (ctx, { id }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not signed in");
    const med = await ctx.db.get(id);
    if (!med || med.userId !== userId) throw new Error("Not found");
    await stop(ctx, med);
  },
});

// Taken / Skip on a reminder message. Can be changed later.
export const log = mutation({
  args: { messageId: v.id("messages"), status: v.union(v.literal("taken"), v.literal("skipped")) },
  handler: async (ctx, { messageId, status }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not signed in");
    const message = await ctx.db.get(messageId);
    if (!message || message.userId !== userId || !message.reminder) throw new Error("Not found");
    const { medicationId, dueAt } = message.reminder;
    await ctx.db.patch(messageId, { reminder: { ...message.reminder, status } });
    const existing = await ctx.db
      .query("doseLogs")
      .withIndex("by_medication_and_due", (q) => q.eq("medicationId", medicationId).eq("dueAt", dueAt))
      .unique();
    if (existing) await ctx.db.patch(existing._id, { status });
    else await ctx.db.insert("doseLogs", { userId, medicationId, dueAt, status });
  },
});

// A dose is due: post the reminder and schedule the next one. Ignores stale jobs (stopped, or rescheduled).
export const fire = internalMutation({
  args: { id: v.id("medications"), dueAt: v.number() },
  handler: async (ctx, { id, dueAt }) => {
    const med = await ctx.db.get(id);
    if (!med?.active || med.nextAt !== dueAt) return;
    const user = await ctx.db.get(med.userId);
    if (user) {
      const text = t(langOf(user), "reminder", med.name, med.dose ?? "", timeText(dueAt, med.timeZone, langOf(user)));
      const messageId = await ctx.db.insert("messages", {
        userId: med.userId,
        role: "assistant",
        channel: "app",
        kind: "reminder",
        text,
        urgent: false,
        reminder: { medicationId: id, dueAt },
      });
      // The phone shows Taken / Skip buttons on it (the "reminder" category, src/push.ts).
      await notify(ctx, med.userId, "reminders", {
        title: `💊 ${med.name}`,
        body: text.replace(/^💊\s*/, ""),
        data: { messageId },
        categoryId: "reminder",
      });
    }
    const next = nextDue(med.schedule, Math.max(dueAt, Date.now()), med.timeZone, med.utcOffsetMin);
    if (!user || (med.endsAt !== undefined && next > med.endsAt - END_SLACK_MS)) {
      await ctx.db.patch(id, { active: false, nextAt: undefined, jobId: undefined, stoppedAt: Date.now() });
      return;
    }
    await schedule_(ctx, id, next);
  },
});

// For the chat model's tools (convex/pipeline.ts).
export const addFromChat = internalMutation({
  args: { userId: v.id("users"), name: v.string(), dose: v.optional(v.string()), schedule, days: v.optional(v.number()) },
  handler: async (ctx, { userId, ...args }) => {
    const res = await addMedication(ctx, userId, args);
    if ("error" in res) return `Tool error: ${res.error}`;
    const user = await ctx.db.get(userId);
    const zoneNote = user?.timeZone ? "" : " (The user's time zone isn't known yet, so times are UTC until they open the app.)";
    return (
      `Reminder set: ${args.name}${args.dose ? ` ${args.dose}` : ""}, ${describeSchedule(res.schedule)}` +
      `${args.days ? ` for ${args.days} days` : ""}. First reminder at ${localTimeText(res.nextAt, res.timeZone)}. ` +
      `Reminders appear in the app chat with Taken / Skip buttons; they can be managed in the Reminders panel (pill button).${zoneNote}`
    );
  },
});

export const cancelFromChat = internalMutation({
  args: { userId: v.id("users"), name: v.string() },
  handler: async (ctx, { userId, name }) => {
    const wanted = name.trim().toLowerCase();
    const meds = (
      await ctx.db
        .query("medications")
        .withIndex("by_user_and_active", (q) => q.eq("userId", userId).eq("active", true))
        .take(MAX_ACTIVE)
    ).filter((m) => m.name.toLowerCase().includes(wanted) || wanted.includes(m.name.toLowerCase()));
    if (!meds.length) return `Tool error: no active reminder matches "${name}".`;
    for (const m of meds) await stop(ctx, m);
    return `Stopped reminders for ${meds.map((m) => m.name).join(", ")}.`;
  },
});

// Current medications with the last 30 days of Taken / Skip, for the model's context and visit summaries.
export async function medicationsText(ctx: QueryCtx, userId: Id<"users">, now: number): Promise<string> {
  const meds = await ctx.db
    .query("medications")
    .withIndex("by_user_and_active", (q) => q.eq("userId", userId).eq("active", true))
    .take(MAX_ACTIVE);
  const lines: string[] = [];
  for (const m of meds) {
    const logs = await ctx.db
      .query("doseLogs")
      .withIndex("by_medication_and_due", (q) => q.eq("medicationId", m._id).gte("dueAt", now - 30 * DAY_MS))
      .take(500);
    const taken = logs.filter((l) => l.status === "taken").length;
    const skipped = logs.length - taken;
    const since = new Date(m._creationTime).toISOString().slice(0, 10);
    lines.push(
      `- ${m.name}${m.dose ? ` ${m.dose}` : ""}, ${describeSchedule(m.schedule)}, reminders since ${since}` +
        (logs.length ? `; last 30 days: ${taken} taken, ${skipped} skipped` : ""),
    );
  }
  return lines.join("\n");
}

export const activeText = internalQuery({
  args: { userId: v.id("users"), now: v.number() },
  handler: (ctx, { userId, now }) => medicationsText(ctx, userId, now),
});

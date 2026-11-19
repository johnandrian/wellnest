// Medication reminders: each due dose posts a reminder message in the app chat with Taken / Skip / Snooze buttons.
// Set up from the Reminders panel or by asking in chat (set_medication_reminder). Times follow the user's time zone.
// Today's doses (`today`) can be answered from the Medications tab and the dashboard too; as-needed medications
// have no reminders and are logged with "Took one" (`takeNow`).
import { v } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";
import { internalMutation, internalQuery, mutation, MutationCtx, query, QueryCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import { Doc, Id } from "./_generated/dataModel";
import { checkSchedule, describeSchedule, dueTimes, isTimed, localParts, localTimeText, MAX_ACTIVE, nextDue, ruleOf, schedule, Schedule } from "./lib/reminders";
import { langOf, t, timeText } from "./lib/language";
import { notify } from "./push";
import { daysLeft, doseAt, medForm, statusOf, timeDose } from "./lib/meds";
import { logEvent } from "./medications";
import { insertMessage } from "./lib/chats";
import { interactionsText, lookupSoon } from "./drugs";
import { alertCircle } from "./circle";

const DAY_MS = 24 * 60 * 60 * 1000;
// A dose due within a minute of a course's end counts as past it ("every 12 hours for 1 day" is 2 reminders).
const END_SLACK_MS = 60_000;
export const SNOOZE_MS = 15 * 60_000;
// How far from a due time a dose can still be answered from the Today list (yesterday's late dose, tonight's early one).
const ANSWER_WINDOW_MS = 2 * DAY_MS;

type AddArgs = {
  name: string;
  dose?: string;
  schedule: Schedule;
  days?: number;
  genericName?: string;
  form?: "tablet" | "capsule" | "liquid" | "inhaler" | "patch" | "injection" | "cream" | "drops" | "other";
  prescriber?: string;
  directions?: string;
  timeDoses?: { time: string; dose: string }[];
};

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
    genericName: args.genericName?.trim().slice(0, 80) || undefined,
    form: args.form,
    prescriber: args.prescriber?.trim().slice(0, 80) || undefined,
    directions: args.directions?.trim().slice(0, 200) || undefined,
    timeDoses: checked.schedule.kind === "daily" ? args.timeDoses?.filter((t) => t.dose.trim() && (checked.schedule as { times: string[] }).times.includes(t.time)) : undefined,
  });
  const med = (await ctx.db.get(id))!;
  await logEvent(ctx, med, "started");
  await lookupSoon(ctx, med, true);
  if (!isTimed(checked.schedule)) return { id, nextAt: null, timeZone, schedule: checked.schedule };
  const at = nextDue(checked.schedule, now, timeZone, utcOffsetMin);
  await schedule_(ctx, id, at);
  return { id, nextAt: at, timeZone, schedule: checked.schedule };
}

async function stop(ctx: MutationCtx, med: Doc<"medications">) {
  if (med.jobId) await ctx.scheduler.cancel(med.jobId);
  await ctx.db.patch(med._id, { active: false, nextAt: undefined, jobId: undefined, stoppedAt: Date.now() });
  await logEvent(ctx, med, "stopped");
}

export const add = mutation({
  args: {
    name: v.string(),
    dose: v.optional(v.string()),
    schedule,
    days: v.optional(v.number()),
    genericName: v.optional(v.string()),
    form: v.optional(medForm),
    prescriber: v.optional(v.string()),
    directions: v.optional(v.string()),
    timeDoses: v.optional(v.array(timeDose)),
  },
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
      // The app words it in the user's language.
      rule: ruleOf(m.schedule),
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

const doseStatus = v.union(v.literal("taken"), v.literal("skipped"));

async function ownMed(ctx: MutationCtx, id: Id<"medications">) {
  const userId = await getAuthUserId(ctx);
  if (!userId) throw new Error("Not signed in");
  const med = await ctx.db.get(id);
  if (!med || med.userId !== userId) throw new Error("Not found");
  return med;
}

// One answer for one due dose, from the chat, a notification, or the Today list. Can be changed later. The dose log
// is the record; the reminder messages for that dose show the same answer; the supply follows taken doses.
// When a dose was tapped: now, or the time an answer made offline was tapped (src/offline.tsx), never later than now
// and at most two days back.
const tappedAt = (at: number | undefined) => {
  const now = Date.now();
  return at === undefined ? now : Math.min(now, Math.max(now - ANSWER_WINDOW_MS, at));
};

async function recordDose(ctx: MutationCtx, userId: Id<"users">, medicationId: Id<"medications">, dueAt: number, status: "taken" | "skipped", at?: number) {
  const existing = await ctx.db
    .query("doseLogs")
    .withIndex("by_medication_and_due", (q) => q.eq("medicationId", medicationId).eq("dueAt", dueAt))
    .unique();
  const wasTaken = existing?.status === "taken";
  const takenAt = status === "taken" ? (wasTaken ? existing.takenAt : tappedAt(at)) : undefined;
  if (existing) await ctx.db.patch(existing._id, { status, takenAt });
  else await ctx.db.insert("doseLogs", { userId, medicationId, dueAt, status, takenAt });
  if (status === "taken" && !wasTaken) await useSupply(ctx, medicationId);
  if (status !== "taken" && wasTaken) await giveBack(ctx, medicationId);
  // A snoozed dose has two reminder messages; both show the answer.
  const posted = await ctx.db
    .query("messages")
    .withIndex("by_user", (q) => q.eq("userId", userId).gte("_creationTime", dueAt - 60_000))
    .take(300);
  for (const m of posted) {
    if (m.reminder?.medicationId === medicationId && m.reminder.dueAt === dueAt && m.reminder.status !== status) {
      await ctx.db.patch(m._id, { reminder: { ...m.reminder, status } });
    }
  }
}

// Taken / Skip on a reminder message or its notification.
export const log = mutation({
  args: { messageId: v.id("messages"), status: doseStatus },
  handler: async (ctx, { messageId, status }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not signed in");
    const message = await ctx.db.get(messageId);
    if (!message || message.userId !== userId || !message.reminder) throw new Error("Not found");
    await recordDose(ctx, userId, message.reminder.medicationId, message.reminder.dueAt, status);
  },
});

// Taken / Skip from the Today list, for a dose due within two days of now. `at` is when it was tapped, for an
// answer made offline.
export const mark = mutation({
  args: { medicationId: v.id("medications"), dueAt: v.number(), status: doseStatus, at: v.optional(v.number()) },
  handler: async (ctx, { medicationId, dueAt, status, at }) => {
    const med = await ownMed(ctx, medicationId);
    if (Math.abs(dueAt - Date.now()) > ANSWER_WINDOW_MS) throw new Error("That dose is too far from today to change here.");
    await recordDose(ctx, med.userId, med._id, dueAt, status, at);
  },
});

// An as-needed dose, taken now (or at `at`, when it was tapped offline).
export const takeNow = mutation({
  args: { medicationId: v.id("medications"), at: v.optional(v.number()) },
  handler: async (ctx, { medicationId, at }) => {
    const med = await ownMed(ctx, medicationId);
    if (statusOf(med) !== "active") throw new Error("Resume this medication first.");
    const now = tappedAt(at);
    await ctx.db.insert("doseLogs", { userId: med.userId, medicationId, dueAt: now, status: "taken", takenAt: now });
    await useSupply(ctx, medicationId);
    return now;
  },
});

// Removes one answer: Undo after "Took one", or clearing a Taken / Skip tapped by mistake.
export const unmark = mutation({
  args: { medicationId: v.id("medications"), dueAt: v.number() },
  handler: async (ctx, { medicationId, dueAt }) => {
    const med = await ownMed(ctx, medicationId);
    const row = await ctx.db
      .query("doseLogs")
      .withIndex("by_medication_and_due", (q) => q.eq("medicationId", med._id).eq("dueAt", dueAt))
      .unique();
    if (!row) return;
    await ctx.db.delete(row._id);
    if (row.status === "taken") await giveBack(ctx, med._id);
  },
});

// Remind me again in 15 minutes: one more reminder for this dose, unless it's answered by then.
export const snooze = mutation({
  args: { medicationId: v.id("medications"), dueAt: v.number() },
  handler: async (ctx, { medicationId, dueAt }) => {
    const med = await ownMed(ctx, medicationId);
    await ctx.scheduler.runAfter(SNOOZE_MS, internal.reminders.remindAgain, { id: med._id, dueAt });
  },
});

export const remindAgain = internalMutation({
  args: { id: v.id("medications"), dueAt: v.number() },
  handler: async (ctx, { id, dueAt }) => {
    const med = await ctx.db.get(id);
    if (!med?.active) return;
    const answered = await ctx.db
      .query("doseLogs")
      .withIndex("by_medication_and_due", (q) => q.eq("medicationId", id).eq("dueAt", dueAt))
      .unique();
    const user = await ctx.db.get(med.userId);
    if (answered || !user) return;
    await postReminder(ctx, med, user, dueAt);
  },
});

// Today's doses, for the Medications tab and the dashboard: each due time of every active medication between `from`
// and `to` (the user's local day, from the app) with its answer, and the as-needed medications with what was taken.
export const today = query({
  args: { from: v.number(), to: v.number() },
  handler: async (ctx, { from, to }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId || !(to > from) || to - from > 2 * DAY_MS) return null;
    const meds = await ctx.db
      .query("medications")
      .withIndex("by_user_and_active", (q) => q.eq("userId", userId).eq("active", true))
      .take(MAX_ACTIVE);
    const doses: { medicationId: Id<"medications">; name: string; dose: string | null; dueAt: number; time: string; status: "taken" | "skipped" | null; takenAt: number | null }[] = [];
    const asNeeded: { medicationId: Id<"medications">; name: string; dose: string | null; taken: number[] }[] = [];
    for (const m of meds) {
      const logs = await ctx.db
        .query("doseLogs")
        .withIndex("by_medication_and_due", (q) => q.eq("medicationId", m._id).gte("dueAt", from).lt("dueAt", to))
        .take(100);
      if (!isTimed(m.schedule)) {
        asNeeded.push({ medicationId: m._id, name: m.name, dose: m.dose ?? null, taken: logs.filter((l) => l.status === "taken").map((l) => l.dueAt) });
        continue;
      }
      // Only doses since the medication was added: a noon start doesn't owe the morning dose.
      for (const at of dueTimes(m.schedule, Math.max(from, m._creationTime), to, m.timeZone, m.utcOffsetMin, 48)) {
        const log = logs.find((l) => l.dueAt === at);
        const time = localParts(at, m.timeZone, m.utcOffsetMin).time;
        doses.push({ medicationId: m._id, name: m.name, dose: doseAt(time, m.dose, m.timeDoses) ?? null, dueAt: at, time, status: log?.status ?? null, takenAt: log?.takenAt ?? null });
      }
    }
    doses.sort((a, b) => a.dueAt - b.dueAt || a.name.localeCompare(b.name));
    return { doses, asNeeded };
  },
});

// A dose taken: count it off the supply, and warn once when it'll run out within the warning window.
async function useSupply(ctx: MutationCtx, medicationId: Id<"medications">) {
  const med = await ctx.db.get(medicationId);
  if (!med?.supply) return;
  const supply = { ...med.supply, left: Math.max(0, med.supply.left - med.supply.perDose) };
  const left = daysLeft(med.schedule, supply);
  const warn = left !== null && left <= supply.warnDays && !supply.warnedAt;
  await ctx.db.patch(med._id, { supply: warn ? { ...supply, warnedAt: Date.now() } : supply });
  if (!warn) return;
  const user = await ctx.db.get(med.userId);
  const lang = langOf(user);
  const text = t(lang, "lowSupply", med.name, left!);
  await insertMessage(ctx, { userId: med.userId, role: "assistant", channel: "app", kind: "reminder", text, urgent: false });
  await notify(ctx, med.userId, "reminders", { title: `💊 ${med.name}`, body: text, data: {} });
}

// A Taken answer taken back: the dose goes back in the bottle.
async function giveBack(ctx: MutationCtx, medicationId: Id<"medications">) {
  const med = await ctx.db.get(medicationId);
  if (!med?.supply) return;
  await ctx.db.patch(med._id, { supply: { ...med.supply, left: med.supply.left + med.supply.perDose } });
}

// The reminder message in the chat, and the push notification with Taken / Skip / Snooze on it.
async function postReminder(ctx: MutationCtx, med: Doc<"medications">, user: Doc<"users">, dueAt: number) {
  const dose = doseAt(localParts(dueAt, med.timeZone, med.utcOffsetMin).time, med.dose, med.timeDoses) ?? "";
  const text = t(langOf(user), "reminder", med.name, dose, timeText(dueAt, med.timeZone, langOf(user)));
  const messageId = await insertMessage(ctx, {
    userId: med.userId,
    role: "assistant",
    channel: "app",
    kind: "reminder",
    text,
    urgent: false,
    reminder: { medicationId: med._id, dueAt },
  });
  // The phone shows Taken / Skip / Snooze on it (the "reminder" category, src/push.ts).
  await notify(ctx, med.userId, "reminders", {
    title: `💊 ${med.name}`,
    body: text.replace(/^💊\s*/, ""),
    data: { messageId, medicationId: med._id, dueAt: String(dueAt) },
    categoryId: "reminder",
  });
}

// Doses skipped or never answered (2 hours on) this past week. Three or more: a kind nudge in chat, at most weekly,
// and an alert to the care circle members who get missed-dose alerts.
const NUDGE_AFTER = 3;
async function nudgeIfMissing(ctx: MutationCtx, med: Doc<"medications">, user: Doc<"users">, now: number) {
  if (med.nudgedAt && med.nudgedAt > now - 7 * DAY_MS) return;
  const recent = await ctx.db
    .query("messages")
    .withIndex("by_user", (q) => q.eq("userId", med.userId).gte("_creationTime", now - 7 * DAY_MS))
    .take(1000);
  const missed = recent.filter((m) => m.reminder?.medicationId === med._id && m.reminder.status !== "taken" && m.reminder.dueAt < now - 2 * 60 * 60 * 1000).length;
  if (missed < NUDGE_AFTER) return;
  await insertMessage(ctx, { userId: med.userId, role: "assistant", channel: "app", text: t(langOf(user), "missedDoses", med.name, missed), urgent: false });
  await ctx.db.patch(med._id, { nudgedAt: now });
  // Care circle members the user picked for this hear about it too.
  await alertCircle(ctx, med.userId, "missedDoses", (lang, who) => ({ text: t(lang, "circleMissedDoses", who, med.name, missed), title: t(lang, "circleMissedDosesTitle", who) }));
}

// A dose is due: post the reminder and schedule the next one. Ignores stale jobs (stopped, or rescheduled).
export const fire = internalMutation({
  args: { id: v.id("medications"), dueAt: v.number() },
  handler: async (ctx, { id, dueAt }) => {
    const med = await ctx.db.get(id);
    if (!med?.active || med.nextAt !== dueAt || !isTimed(med.schedule)) return;
    const user = await ctx.db.get(med.userId);
    if (user) {
      await nudgeIfMissing(ctx, med, user, Date.now());
      await postReminder(ctx, med, user, dueAt);
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
      `${args.days ? ` for ${args.days} days` : ""}. ` +
      (res.nextAt === null
        ? "As needed: no reminders; the user logs each dose with Took one in the Medications tab."
        : `First reminder at ${localTimeText(res.nextAt, res.timeZone)}. Reminders appear in the app chat with Taken / Skip / Snooze buttons; they can be managed in the Medications tab.${zoneNote}`)
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

// Current, paused and recently stopped medications with details, the last 30 days of Taken / Skip, dose changes
// and side effects, for the model's context, visit summaries and reports.
export async function medicationsText(ctx: QueryCtx, userId: Id<"users">, now: number, sinceDays = 90): Promise<string> {
  const meds = (await ctx.db.query("medications").withIndex("by_user_and_active", (q) => q.eq("userId", userId)).take(100)).filter(
    (m) => !m.stoppedAt || m.stoppedAt > now - sinceDays * DAY_MS,
  );
  const lines: string[] = [];
  for (const m of meds) {
    const logs = await ctx.db
      .query("doseLogs")
      .withIndex("by_medication_and_due", (q) => q.eq("medicationId", m._id).gte("dueAt", now - 30 * DAY_MS))
      .take(500);
    const taken = logs.filter((l) => l.status === "taken").length;
    const skipped = logs.length - taken;
    const since = new Date(m._creationTime).toISOString().slice(0, 10);
    const status = m.active ? "" : m.stoppedAt ? ` (stopped ${new Date(m.stoppedAt).toISOString().slice(0, 10)})` : " (paused)";
    const perTime = m.timeDoses?.length ? ` (${m.timeDoses.map((t) => `${t.time}: ${t.dose}`).join(", ")})` : "";
    const left = daysLeft(m.schedule, m.supply);
    let line =
      `- ${m.name}${m.genericName ? ` [${m.genericName}]` : ""}${m.form ? ` ${m.form}` : ""}${m.dose ? ` ${m.dose}` : ""}${perTime}, ` +
      `${describeSchedule(m.schedule)}${status}, since ${since}` +
      (m.prescriber ? `, prescribed by ${m.prescriber}` : "") +
      (logs.length ? `; last 30 days: ${taken} taken, ${skipped} skipped` : "") +
      (left !== null ? `; about ${left} days of supply left` : "");
    const changes = await ctx.db.query("medicationEvents").withIndex("by_medication", (q) => q.eq("medicationId", m._id)).take(20);
    const doseChanges = changes.filter((e) => e.kind === "dose_changed");
    if (doseChanges.length) line += `; dose changes: ${doseChanges.map((e) => `${new Date(e.at).toISOString().slice(0, 10)} ${e.note}`).join(", ")}`;
    const effects = await ctx.db.query("sideEffects").withIndex("by_medication", (q) => q.eq("medicationId", m._id)).take(10);
    if (effects.length) line += `; side effects: ${effects.map((e) => `${e.date} ${e.effect}${e.severity !== undefined ? ` ${e.severity}/10` : ""}`).join(", ")}`;
    lines.push(line);
  }
  const interactions = await interactionsText(ctx, userId);
  return [...lines, ...(interactions ? [interactions] : [])].join("\n");
}

export const activeText = internalQuery({
  args: { userId: v.id("users"), now: v.number() },
  handler: (ctx, { userId, now }) => medicationsText(ctx, userId, now),
});

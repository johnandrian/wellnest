// Questions to ask at an appointment: the model reads what changed since the user's last visit (symptoms, trackers,
// check-ins, medication changes and side effects, patterns) and suggests a few specific questions, saved on the
// visit. Made from the Visits tab, and automatically with the 2-hour reminder when there are none yet.
import { v } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";
import { action, ActionCtx, internalAction, internalMutation, internalQuery, mutation } from "./_generated/server";
import { internal } from "./_generated/api";
import { Id } from "./_generated/dataModel";
import { complete, CORE_MODEL } from "./lib/cortex";
import { journalText } from "./lib/journal";
import { painAsEntries, trackersText } from "./lib/trackers";
import { dateList, findPatterns, medEffects, shiftDate, sliceInputs } from "./lib/insights";
import { medEffectText, patternText } from "./lib/insightsText";
import { LANGUAGES, langOf } from "./lib/language";
import { localToday } from "./journal";
import { gatherInputs, medChanges } from "./insights";

const DAY_MS = 86_400_000;
const DEFAULT_DAYS = 60;
const MAX_DAYS = 120;
export const MAX_QUESTIONS = 6;

const PROMPT = `You help a patient get ready for a medical appointment. From their records since their last visit, write 3 to 6 short questions they could ask the clinician.
- Each question must point at something specific in the records: a symptom that got worse or keeps coming back, a pattern, a medication change or side effect, a missed dose streak, a goal that isn't working.
- Write them in the first person, the way the patient would ask ("My headaches went from 2 to 5 days a week since March. What could be behind that?").
- Never diagnose or suggest a treatment yourself. Don't repeat questions already in their own notes.
- Reply with only a JSON array of strings.`;

// What the questions are written from. null when the visit isn't the user's or is over.
export const context = internalQuery({
  args: { id: v.id("visits"), userId: v.optional(v.id("users")) },
  handler: async (ctx, { id, userId }) => {
    const visit = await ctx.db.get(id);
    if (!visit || (userId && visit.userId !== userId) || visit.status !== "upcoming") return null;
    const user = await ctx.db.get(visit.userId);
    const today = localToday(user);
    const last = (
      await ctx.db
        .query("visits")
        .withIndex("by_user_and_start", (q) => q.eq("userId", visit.userId).lt("startsAt", visit.startsAt))
        .order("desc")
        .take(20)
    ).find((r) => r.status === "done");
    // Since the last visit (up to MAX_DAYS before this one), and always at least the last two weeks.
    const sinceMs = last ? Math.max(last.startsAt, visit.startsAt - MAX_DAYS * DAY_MS) : visit.startsAt - DEFAULT_DAYS * DAY_MS;
    const sinceDate = new Date(sinceMs).toISOString().slice(0, 10);
    const from = sinceDate < shiftDate(today, -14) ? sinceDate : shiftDate(today, -14);
    // Two weeks more for medication before/after.
    const input = await gatherInputs(ctx, visit.userId, shiftDate(from, -14), today);
    const recent = sliceInputs(input, from);
    const meds = await ctx.db.query("medications").withIndex("by_user_and_active", (q) => q.eq("userId", visit.userId)).take(100);
    const sideEffects = (await ctx.db.query("sideEffects").withIndex("by_user", (q) => q.eq("userId", visit.userId)).take(200)).filter((e) => e.date >= from);
    const changes = await medChanges(ctx, visit.userId, from);
    const clinician = visit.clinicianId ? (await ctx.db.get(visit.clinicianId))?.name : undefined;
    const facts = (await ctx.db.query("memoryFacts").withIndex("by_user", (q) => q.eq("userId", visit.userId)).take(50)).map((f) => f.text);
    const medName = new Map(meds.map((m) => [m._id, m.name]));
    const text = [
      `Appointment: ${visit.title} (${visit.kind.replace("_", " ")}${clinician ? ` with ${clinician}` : ""}) on ${new Date(visit.startsAt).toISOString().slice(0, 10)}.`,
      last ? `Last visit: ${last.title} on ${new Date(last.startsAt).toISOString().slice(0, 10)}${last.notes ? `. Their notes from it: ${last.notes}` : ""}.` : `Records from the last ${DEFAULT_DAYS} days.`,
      visit.prep && `Their own notes and questions for this visit (don't repeat these): ${visit.prep}`,
      facts.length && `Health facts: ${facts.join("; ")}`,
      meds.length && `Medications: ${meds.map((m) => `${m.name}${m.dose ? ` ${m.dose}` : ""}${m.active ? "" : " (stopped)"}`).join("; ")}`,
      changes.length && `Medication changes: ${changes.map((c) => `${c.date} ${c.kind === "started" ? "started" : "dose changed"} ${c.name}${c.note ? ` (${c.note})` : ""}`).join("; ")}`,
      sideEffects.length && `Side effects: ${sideEffects.map((e) => `${e.date} ${medName.get(e.medicationId) ?? ""}: ${e.effect}${e.severity !== undefined ? ` ${e.severity}/10` : ""}`).join("; ")}`,
      journalText([...recent.entries, ...painAsEntries(recent.trackers)], recent.health, recent.daily),
      trackersText(recent.trackers, user?.peakFlowBest),
      ...findPatterns(recent, dateList(from, today)).map((p) => `Pattern: ${patternText(p, "en")}`),
      ...medEffects(input, changes, dateList(shiftDate(from, -14), today), today).map((e) => `Medication before/after: ${medEffectText(e, "en")}`),
    ]
      .filter(Boolean)
      .join("\n\n");
    return { userId: visit.userId, language: LANGUAGES[langOf(user)].english, text };
  },
});

// The model's answer -> clean questions. Tolerates a code fence or words around the JSON.
export function parseQuestions(content: string | null): string[] {
  const m = content?.match(/\[[\s\S]*\]/);
  if (!m) return [];
  try {
    const arr = JSON.parse(m[0]);
    return Array.isArray(arr)
      ? arr.filter((q): q is string => typeof q === "string").map((q) => q.trim().slice(0, 300)).filter(Boolean).slice(0, MAX_QUESTIONS)
      : [];
  } catch {
    return [];
  }
}

async function write(ctx: ActionCtx, id: Id<"visits">, userId?: Id<"users">): Promise<string[]> {
  const c = await ctx.runQuery(internal.questions.context, { id, userId });
  if (!c) throw new Error("That appointment isn't coming up.");
  const { content } = await complete({
    model: CORE_MODEL(),
    messages: [
      { role: "system", content: `${PROMPT}\nWrite them in ${c.language}.` },
      { role: "user", content: c.text },
    ],
    maxTokens: 600,
  });
  const questions = parseQuestions(content);
  if (!questions.length) throw new Error("Couldn't write questions this time. Please try again.");
  await ctx.runMutation(internal.questions.save, { id, questions });
  return questions;
}

// The Visits tab's "Suggest questions" button.
export const suggest = action({
  args: { id: v.id("visits") },
  handler: async (ctx, { id }): Promise<string[]> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not signed in");
    return write(ctx, id, userId);
  },
});

// With the 2-hour reminder (convex/visits.ts), when the visit has no questions yet. Failures are only logged.
export const writeForReminder = internalAction({
  args: { id: v.id("visits") },
  handler: async (ctx, { id }) => {
    await write(ctx, id).catch((e) => console.error("visit questions failed", e));
  },
});

export const save = internalMutation({
  args: { id: v.id("visits"), questions: v.array(v.string()) },
  handler: async (ctx, { id, questions }) => {
    if (await ctx.db.get(id)) await ctx.db.patch(id, { questions });
  },
});

// Drop one suggestion the user doesn't want.
export const remove = mutation({
  args: { id: v.id("visits"), index: v.number() },
  handler: async (ctx, { id, index }) => {
    const userId = await getAuthUserId(ctx);
    const visit = await ctx.db.get(id);
    if (!userId || !visit || visit.userId !== userId) throw new Error("Not found");
    const questions = (visit.questions ?? []).filter((_, i) => i !== index);
    await ctx.db.patch(id, { questions: questions.length ? questions : undefined });
  },
});

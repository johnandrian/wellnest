// The agent's morning check: at 9 AM local time, the rules in convex/lib/agentRules.ts read the user's own logs and
// propose actions into the Action Inbox (convex/agent.ts), with a push notification when something new needs their OK.
// A very low or very high glucose reading is also checked the moment it's logged (convex/trackers.ts), so a red flag
// doesn't wait for the morning. Nothing runs without the user's approval.
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalMutation, MutationCtx } from "./_generated/server";
import { Doc, Id } from "./_generated/dataModel";
import { dateList, shiftDate, weekStats } from "./lib/insights";
import { GlucoseReading, highFastingRule, Proposal, urgentGlucoseRule, worseningRule } from "./lib/agentRules";
import { langOf } from "./lib/language";
import { zoneOffsetMin } from "./lib/reminders";
import { unitsOf } from "./lib/units";
import { localToday } from "./journal";
import { trackersSince } from "./trackers";
import { gatherInputs, medChanges } from "./insights";
import { insertProposal } from "./agent";
import { notify } from "./push";

const SCAN_HOUR = 9;
const BATCH = 100;
const MIN_GAP_MS = 20 * 3_600_000;

const isDue = (user: Doc<"users">, now: number) => {
  if (user.deleting || (user.agentScannedAt ?? 0) > now - MIN_GAP_MS) return false;
  const local = new Date(now + zoneOffsetMin(now, user.timeZone ?? "UTC", user.utcOffsetMin ?? 0) * 60_000);
  return local.getUTCHours() === SCAN_HOUR;
};

async function glucoseSince(ctx: MutationCtx, userId: Id<"users">, from: string): Promise<GlucoseReading[]> {
  return (await trackersSince(ctx, userId, from)).flatMap((e) =>
    e.tracker === "glucose" && e.glucose ? [{ date: e.date, at: e.at, value: e.glucose.value, context: e.glucose.context }] : [],
  );
}

// A visit or video visit booked from now on.
async function hasUpcomingVisit(ctx: MutationCtx, userId: Id<"users">, now: number) {
  const visit = await ctx.db.query("visits").withIndex("by_user_and_start", (q) => q.eq("userId", userId).gt("startsAt", now)).first();
  if (visit) return true;
  const appts = await ctx.db.query("appointments").withIndex("by_user", (q) => q.eq("userId", userId)).order("desc").take(20);
  return appts.some((a) => a.status === "booked" && (a.startsAt ?? 0) > now);
}

// Adds the proposals that pass their cooldown and pushes one notification for them. Returns how many were added.
async function proposeAll(ctx: MutationCtx, user: Doc<"users">, proposals: Proposal[]) {
  const added: Proposal[] = [];
  for (const p of proposals) if (await insertProposal(ctx, { userId: user._id, ...p })) added.push(p);
  if (!added.length) return 0;
  const lang = langOf(user);
  const urgent = added.find((p) => p.urgent);
  await notify(ctx, user._id, "agent", {
    title: urgent ? urgent.title : PUSH_TITLE[lang],
    body: urgent ? URGENT_BODY[lang] : added.map((p) => p.title).join("\n"),
    data: { open: "agent" },
  });
  return added.length;
}

const PUSH_TITLE = { en: "Something needs your OK", es: "Algo necesita tu permiso", el: "Κάτι θέλει την έγκρισή σου", zh: "有事项需要你同意" };
const URGENT_BODY = {
  en: "This could be serious. Call your care team now, or 911 if it's an emergency.",
  es: "Esto podría ser grave. Llama ahora a tu equipo de atención, o al 911 si es una emergencia.",
  el: "Αυτό μπορεί να είναι σοβαρό. Κάλεσε τώρα την ομάδα φροντίδας σου ή το 112 αν είναι επείγον.",
  zh: "这可能很严重。请立即联系你的医护团队，紧急情况请拨打 911。",
};

// Hourly, from crons.ts: finds the users whose morning it is and hands each to `check`.
export const scan = internalMutation({
  args: { cursor: v.optional(v.union(v.string(), v.null())) },
  handler: async (ctx, { cursor }) => {
    const now = Date.now();
    const page = await ctx.db.query("users").paginate({ numItems: BATCH, cursor: cursor ?? null });
    for (const user of page.page) if (isDue(user, now)) await ctx.scheduler.runAfter(0, internal.agentScan.check, { userId: user._id });
    if (!page.isDone) await ctx.scheduler.runAfter(0, internal.agentScan.scan, { cursor: page.continueCursor });
    return null;
  },
});

// Every rule for one user. `force` skips the time-of-day check (tests, `npx convex run agentScan:check`).
export const check = internalMutation({
  args: { userId: v.id("users"), force: v.optional(v.boolean()) },
  handler: async (ctx, { userId, force }) => {
    const user = await ctx.db.get(userId);
    const now = Date.now();
    if (!user || user.deleting || (!force && !isDue(user, now))) return 0;
    await ctx.db.patch(userId, { agentScannedAt: now });
    const today = localToday(user, now);
    const lang = langOf(user);
    const units = unitsOf(user);
    const readings = await glucoseSince(ctx, userId, shiftDate(today, -7));
    const from = shiftDate(today, -13);
    const stats = weekStats(await gatherInputs(ctx, userId, from, today), dateList(from, today), today);
    const proposals = [
      urgentGlucoseRule(readings, today, lang, units),
      highFastingRule(readings, today, await medChanges(ctx, userId, shiftDate(today, -45)), lang, units),
      worseningRule(stats, await hasUpcomingVisit(ctx, userId, now), lang),
    ].filter((p): p is Proposal => p !== null);
    return await proposeAll(ctx, user, proposals);
  },
});

// Right after a glucose reading is logged: only the red-flag rule, so a very low or very high reading is flagged at once.
export const afterGlucose = internalMutation({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    const user = await ctx.db.get(userId);
    if (!user || user.deleting) return 0;
    const today = localToday(user);
    const p = urgentGlucoseRule(await glucoseSince(ctx, userId, today), today, langOf(user), unitsOf(user));
    return p ? await proposeAll(ctx, user, [p]) : 0;
  },
});

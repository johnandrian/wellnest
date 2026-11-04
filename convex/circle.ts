// Care circle: someone invites family or carers with a one-time link. Members see the person's health at a glance,
// read only (today's doses, medications, this week's trends, tomorrow's flare forecast, emergency contacts and a
// full report), and get the alerts the person picked for each of them: missed doses and the evening flare forecast.
// The person can change a member's alerts or remove them; a member can leave. Invites expire after a week.
import { v } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";
import { mutation, MutationCtx, query, QueryCtx } from "./_generated/server";
import { Id } from "./_generated/dataModel";
import { CircleAlert, circleAlerts, personName } from "./lib/circle";
import { dateList, shiftDate, weekStats } from "./lib/insights";
import { forecastLine, weekStatLine } from "./lib/insightsText";
import { Lang, langOf, t } from "./lib/language";
import { appUrl, newToken } from "./lib/links";
import { plain } from "./lib/push";
import { buildReport, Section } from "./lib/report";
import { dateDaysAgo } from "./lib/health";
import { insertMessage } from "./lib/chats";
import { localToday } from "./journal";
import { gatherInputs, tomorrowMatches } from "./insights";
import { gather } from "./reports";
import { emergencyData } from "./emergency";
import { saveAssistantReply } from "./pipeline";
import { notify } from "./push";

const DAY_MS = 86_400_000;
const INVITE_DAYS = 7;
export const MAX_MEMBERS = 10; // members plus open invites
const REPORT_DAYS = 30;
const REPORT_SECTIONS: Section[] = ["facts", "medications", "journal", "trackers", "health", "appointments", "emergency"];
const MISSED_AFTER_MS = 2 * 60 * 60 * 1000; // a reminder unanswered this long counts as missed (as in reminders.ts)

const inviteUrl = (token: string) => `${appUrl()}/?join=${token}`;
const isToken = (s: string) => /^[A-Za-z0-9_-]{20,64}$/.test(s);

async function requireUser(ctx: QueryCtx) {
  const userId = await getAuthUserId(ctx);
  if (!userId) throw new Error("Not signed in");
  return userId;
}

const openInvites = async (ctx: QueryCtx, ownerId: Id<"users">, now: number) =>
  (await ctx.db.query("circleInvites").withIndex("by_owner", (q) => q.eq("ownerId", ownerId)).order("desc").take(50)).filter(
    (i) => !i.usedAt && !i.revokedAt && i.expiresAt > now,
  );

// ---------- The person: their members and invites ----------

export const mine = query({
  // The phone's clock, for which invites are still open (queries can't read it).
  args: { now: v.number() },
  handler: async (ctx, { now }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;
    const rows = await ctx.db.query("circleMembers").withIndex("by_owner", (q) => q.eq("ownerId", userId)).take(MAX_MEMBERS * 2);
    const members = [];
    for (const r of rows) {
      const member = await ctx.db.get(r.memberId);
      if (member && !member.deleting) members.push({ _id: r._id, name: personName(member), label: r.label ?? null, alerts: r.alerts, since: r._creationTime });
    }
    const invites = (await openInvites(ctx, userId, now)).map((i) => ({ _id: i._id, url: inviteUrl(i.token), label: i.label ?? null, alerts: i.alerts, expiresAt: i.expiresAt }));
    return { members, invites };
  },
});

export const invite = mutation({
  args: { label: v.optional(v.string()), alerts: circleAlerts },
  handler: async (ctx, { label, alerts }) => {
    const userId = await requireUser(ctx);
    const now = Date.now();
    const members = await ctx.db.query("circleMembers").withIndex("by_owner", (q) => q.eq("ownerId", userId)).take(MAX_MEMBERS * 2);
    if (members.length + (await openInvites(ctx, userId, now)).length >= MAX_MEMBERS) {
      throw new Error(`A Care Circle has up to ${MAX_MEMBERS} people. Remove someone or cancel an invite first.`);
    }
    const token = newToken();
    await ctx.db.insert("circleInvites", { ownerId: userId, token, label: label?.trim().slice(0, 60) || undefined, alerts, expiresAt: now + INVITE_DAYS * DAY_MS });
    return { url: inviteUrl(token) };
  },
});

export const cancelInvite = mutation({
  args: { id: v.id("circleInvites") },
  handler: async (ctx, { id }) => {
    const userId = await requireUser(ctx);
    const inv = await ctx.db.get(id);
    if (!inv || inv.ownerId !== userId) throw new Error("Not found");
    await ctx.db.patch(id, { revokedAt: Date.now() });
  },
});

export const setAlerts = mutation({
  args: { id: v.id("circleMembers"), alerts: circleAlerts },
  handler: async (ctx, { id, alerts }) => {
    const userId = await requireUser(ctx);
    const row = await ctx.db.get(id);
    if (!row || row.ownerId !== userId) throw new Error("Not found");
    await ctx.db.patch(id, { alerts });
  },
});

// The person removes a member, or a member leaves.
export const remove = mutation({
  args: { id: v.id("circleMembers") },
  handler: async (ctx, { id }) => {
    const userId = await requireUser(ctx);
    const row = await ctx.db.get(id);
    if (!row || (row.ownerId !== userId && row.memberId !== userId)) throw new Error("Not found");
    await ctx.db.delete(id);
  },
});

// ---------- Joining with an invite link ----------

async function findInvite(ctx: QueryCtx, token: string, now: number) {
  if (!isToken(token)) return null;
  const inv = await ctx.db.query("circleInvites").withIndex("by_token", (q) => q.eq("token", token)).unique();
  if (!inv || inv.usedAt || inv.revokedAt || inv.expiresAt <= now) return null;
  const owner = await ctx.db.get(inv.ownerId);
  if (!owner || owner.deleting) return null;
  return { inv, owner };
}

// Who an invite is from, for the welcome page and the join prompt. Anyone holding the link may see the name.
export const inviteInfo = query({
  args: { token: v.string(), now: v.number() },
  handler: async (ctx, { token, now }) => {
    const found = await findInvite(ctx, token, now);
    if (!found) return null;
    const userId = await getAuthUserId(ctx);
    return { name: personName(found.owner), own: userId === found.inv.ownerId };
  },
});

export const join = mutation({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    const userId = await requireUser(ctx);
    const found = await findInvite(ctx, token, Date.now());
    if (!found) throw new Error("This invite isn't available any more. It may have been used, cancelled or expired.");
    const { inv, owner } = found;
    if (inv.ownerId === userId) throw new Error("This is your own invite. Send it to the person you'd like to add.");
    await ctx.db.patch(inv._id, { usedAt: Date.now() });
    const existing = await ctx.db
      .query("circleMembers")
      .withIndex("by_owner_and_member", (q) => q.eq("ownerId", inv.ownerId).eq("memberId", userId))
      .unique();
    if (!existing) {
      await ctx.db.insert("circleMembers", { ownerId: inv.ownerId, memberId: userId, label: inv.label, alerts: inv.alerts });
      const who = inv.label ?? personName(await ctx.db.get(userId));
      await insertMessage(ctx, { userId: owner._id, role: "assistant", channel: "app", kind: "circle", text: t(langOf(owner), "circleJoined", who), urgent: false });
    }
    return { ownerId: inv.ownerId, name: personName(owner) };
  },
});

// ---------- The member: the people they care for ----------

export const caringFor = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];
    const rows = await ctx.db.query("circleMembers").withIndex("by_member", (q) => q.eq("memberId", userId)).take(50);
    const out = [];
    for (const r of rows) {
      const owner = await ctx.db.get(r.ownerId);
      if (owner && !owner.deleting) out.push({ _id: r._id, ownerId: r.ownerId, name: personName(owner), alerts: r.alerts });
    }
    return out;
  },
});

// The member's row in this person's circle (and the person), or null when they aren't in it.
async function membership(ctx: QueryCtx, ownerId: Id<"users">) {
  const userId = await getAuthUserId(ctx);
  if (!userId) return null;
  const row = await ctx.db
    .query("circleMembers")
    .withIndex("by_owner_and_member", (q) => q.eq("ownerId", ownerId).eq("memberId", userId))
    .unique();
  const owner = row && (await ctx.db.get(ownerId));
  if (!row || !owner || owner.deleting) return null;
  return { row, owner, viewer: await ctx.db.get(userId) };
}

// One person at a glance, in the member's language. `now`: the member's clock.
export const person = query({
  args: { ownerId: v.id("users"), now: v.number() },
  handler: async (ctx, { ownerId, now }) => {
    const m = await membership(ctx, ownerId);
    if (!m) return null;
    const { row, owner } = m;
    const lang: Lang = langOf(m.viewer);
    const today = localToday(owner, now);

    // Today's reminders (in the person's day) and what happened to each.
    const reminders = (
      await ctx.db
        .query("messages")
        .withIndex("by_user", (q) => q.eq("userId", ownerId).gte("_creationTime", now - DAY_MS))
        .take(300)
    ).filter((x) => x.kind === "reminder" && x.reminder && localToday(owner, x.reminder.dueAt) === today && x.reminder.dueAt <= now);
    const doses: { name: string; at: number; status: "taken" | "skipped" | "missed" | "due" }[] = [];
    for (const r of reminders) {
      const med = await ctx.db.get(r.reminder!.medicationId);
      if (!med) continue;
      const status = r.reminder!.status ?? (r.reminder!.dueAt < now - MISSED_AFTER_MS ? "missed" : "due");
      doses.push({ name: med.name, at: r.reminder!.dueAt, status });
    }

    const meds = (await ctx.db.query("medications").withIndex("by_user_and_active", (q) => q.eq("userId", ownerId).eq("active", true)).take(50)).map((x) => ({
      name: x.name,
      dose: x.dose ?? null,
      paused: !!x.pausedAt,
    }));

    const from = shiftDate(today, -13);
    const input = await gatherInputs(ctx, ownerId, from, today);
    const logged = [...input.entries, ...input.trackers, ...input.daily].map((x) => x.date).sort();
    const plan = await emergencyData(ctx, ownerId);

    return {
      name: personName(owner),
      alerts: row.alerts,
      doses: doses.sort((a, b) => a.at - b.at),
      meds,
      week: weekStats(input, dateList(from, today), today).map((s) => weekStatLine(s, lang)),
      lastLogged: logged[logged.length - 1] ?? null,
      forecast: (await tomorrowMatches(ctx, ownerId, today)).map((x) => forecastLine(x, lang)),
      contacts: plan?.contacts ?? [],
    };
  },
});

// The full report (the same page as the person's own PDF reports) for the last 30 days.
export const report = query({
  args: { ownerId: v.id("users"), now: v.number(), generated: v.string() },
  handler: async (ctx, { ownerId, now, generated }) => {
    const m = await membership(ctx, ownerId);
    if (!m) throw new Error("Not found");
    return buildReport(await gather(ctx, ownerId, dateDaysAgo(now, REPORT_DAYS - 1), dateDaysAgo(now, 0), REPORT_SECTIONS, generated.slice(0, 40)));
  },
});

// ---------- Alerts ----------

// Sends `alert` to every member of the person's circle who gets it: in their chat (and Telegram when linked) with a
// push. `message` words it in the member's language; `who` is the person's name.
export async function alertCircle(
  ctx: MutationCtx,
  ownerId: Id<"users">,
  alert: CircleAlert,
  message: (lang: Lang, who: string) => { text: string; title: string; body?: string },
) {
  const owner = await ctx.db.get(ownerId);
  if (!owner || owner.deleting) return;
  const rows = await ctx.db.query("circleMembers").withIndex("by_owner", (q) => q.eq("ownerId", ownerId)).take(MAX_MEMBERS * 2);
  for (const row of rows) {
    if (!row.alerts[alert]) continue;
    const member = await ctx.db.get(row.memberId);
    if (!member || member.deleting) continue;
    const { text, title, body } = message(langOf(member), personName(owner));
    await saveAssistantReply(ctx, { userId: member._id, text, channel: member.telegramChatId ? "telegram" : "app", urgent: false, kind: "circle" });
    await notify(ctx, member._id, "circle", { title, body: body ?? plain(text), data: { ownerId } });
  }
}

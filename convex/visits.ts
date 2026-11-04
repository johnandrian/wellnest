// Appointments of any kind (GP, specialist, physio, tests) with prep notes before and meeting notes after, plus the
// user's care team. A push reminder goes out 2 hours before. Telehealth video visits live in convex/telehealth.ts and
// show in the same list. The model can add both from chat (add_appointment, add_care_team_member).
import { v } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";
import { internalMutation, internalQuery, mutation, MutationCtx, query, QueryCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import { Doc, Id } from "./_generated/dataModel";
import { langOf, t, timeText } from "./lib/language";
import { normalizeTime, zonedTime } from "./lib/reminders";
import { isDate } from "./lib/health";
import { notify } from "./push";

export const visitKind = v.union(v.literal("in_person"), v.literal("video"), v.literal("phone"));
const REMIND_BEFORE_MS = 2 * 60 * 60 * 1000;
const MAX_TEAM = 50;
const clip = (s: string | undefined, n: number) => s?.trim().slice(0, n) || undefined;

async function me(ctx: MutationCtx | QueryCtx) {
  const userId = await getAuthUserId(ctx);
  if (!userId) throw new Error("Not signed in");
  return userId;
}

// ---------- Care team ----------

const memberFields = {
  name: v.string(),
  role: v.optional(v.string()),
  phone: v.optional(v.string()),
  email: v.optional(v.string()),
  clinic: v.optional(v.string()),
  address: v.optional(v.string()),
  notes: v.optional(v.string()),
};
type MemberArgs = { name: string; role?: string; phone?: string; email?: string; clinic?: string; address?: string; notes?: string };
const cleanMember = (m: MemberArgs) => ({
  name: m.name.trim().slice(0, 80),
  role: clip(m.role, 80),
  phone: clip(m.phone, 40),
  email: clip(m.email, 120),
  clinic: clip(m.clinic, 120),
  address: clip(m.address, 200),
  notes: clip(m.notes, 500),
});

async function addMember(ctx: MutationCtx, userId: Id<"users">, m: MemberArgs) {
  const clean = cleanMember(m);
  if (!clean.name) throw new Error("Give the person a name.");
  const team = await ctx.db.query("careTeam").withIndex("by_user", (q) => q.eq("userId", userId)).take(MAX_TEAM);
  if (team.length >= MAX_TEAM) throw new Error(`Up to ${MAX_TEAM} people in the care team.`);
  return await ctx.db.insert("careTeam", { userId, ...clean });
}

export const addTeamMember = mutation({ args: memberFields, handler: async (ctx, m) => addMember(ctx, await me(ctx), m) });

export const updateTeamMember = mutation({
  args: { id: v.id("careTeam"), ...memberFields },
  handler: async (ctx, { id, ...m }) => {
    const userId = await me(ctx);
    const row = await ctx.db.get(id);
    if (!row || row.userId !== userId) throw new Error("Not found");
    const clean = cleanMember(m);
    if (!clean.name) throw new Error("Give the person a name.");
    await ctx.db.replace(id, { userId, ...clean });
  },
});

export const removeTeamMember = mutation({
  args: { id: v.id("careTeam") },
  handler: async (ctx, { id }) => {
    const userId = await me(ctx);
    const row = await ctx.db.get(id);
    if (!row || row.userId !== userId) throw new Error("Not found");
    await ctx.db.delete(id);
  },
});

export const team = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];
    return (await ctx.db.query("careTeam").withIndex("by_user", (q) => q.eq("userId", userId)).take(MAX_TEAM)).map(({ userId: _, ...m }) => m);
  },
});

// ---------- Appointments ----------

type VisitArgs = {
  title: string;
  kind?: "in_person" | "video" | "phone";
  startsAt: number;
  clinicianId?: Id<"careTeam">;
  location?: string;
  prep?: string;
};

async function scheduleReminder(ctx: MutationCtx, id: Id<"visits">, startsAt: number) {
  const at = startsAt - REMIND_BEFORE_MS;
  return at > Date.now() ? await ctx.scheduler.runAt(at, internal.visits.remind, { id, startsAt }) : undefined;
}

async function addVisit(ctx: MutationCtx, userId: Id<"users">, a: VisitArgs) {
  const title = a.title.trim().slice(0, 120);
  if (!title) throw new Error("Give the appointment a title.");
  if (!Number.isFinite(a.startsAt)) throw new Error("Pick a date and time.");
  if (a.clinicianId) {
    const c = await ctx.db.get(a.clinicianId);
    if (!c || c.userId !== userId) throw new Error("Not found");
  }
  const id = await ctx.db.insert("visits", {
    userId,
    title,
    kind: a.kind ?? "in_person",
    startsAt: a.startsAt,
    clinicianId: a.clinicianId,
    location: clip(a.location, 200),
    prep: clip(a.prep, 2000),
    status: "upcoming",
  });
  const remindJobId = await scheduleReminder(ctx, id, a.startsAt);
  if (remindJobId) await ctx.db.patch(id, { remindJobId });
  return id;
}

export const add = mutation({
  args: { title: v.string(), kind: v.optional(visitKind), startsAt: v.number(), clinicianId: v.optional(v.id("careTeam")), location: v.optional(v.string()), prep: v.optional(v.string()) },
  handler: async (ctx, a) => addVisit(ctx, await me(ctx), a),
});

async function ownVisit(ctx: MutationCtx, id: Id<"visits">) {
  const userId = await me(ctx);
  const row = await ctx.db.get(id);
  if (!row || row.userId !== userId) throw new Error("Not found");
  return row;
}

export const update = mutation({
  args: {
    id: v.id("visits"),
    title: v.optional(v.string()),
    kind: v.optional(visitKind),
    startsAt: v.optional(v.number()),
    clinicianId: v.optional(v.union(v.id("careTeam"), v.null())),
    location: v.optional(v.string()),
    prep: v.optional(v.string()),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, { id, ...a }) => {
    const row = await ownVisit(ctx, id);
    const patch: Partial<Doc<"visits">> = {};
    if (a.title !== undefined) patch.title = a.title.trim().slice(0, 120) || row.title;
    if (a.kind) patch.kind = a.kind;
    if (a.location !== undefined) patch.location = clip(a.location, 200);
    if (a.prep !== undefined) patch.prep = clip(a.prep, 2000);
    if (a.notes !== undefined) patch.notes = clip(a.notes, 5000);
    if (a.clinicianId !== undefined) {
      if (a.clinicianId) {
        const c = await ctx.db.get(a.clinicianId);
        if (!c || c.userId !== row.userId) throw new Error("Not found");
      }
      patch.clinicianId = a.clinicianId ?? undefined;
    }
    if (a.startsAt !== undefined && a.startsAt !== row.startsAt) {
      if (row.remindJobId) await ctx.scheduler.cancel(row.remindJobId);
      patch.startsAt = a.startsAt;
      patch.remindJobId = row.status === "upcoming" ? await scheduleReminder(ctx, id, a.startsAt) : undefined;
    }
    await ctx.db.patch(id, patch);
  },
});

export const setStatus = mutation({
  args: { id: v.id("visits"), status: v.union(v.literal("upcoming"), v.literal("done"), v.literal("cancelled")) },
  handler: async (ctx, { id, status }) => {
    const row = await ownVisit(ctx, id);
    if (row.remindJobId) await ctx.scheduler.cancel(row.remindJobId);
    const remindJobId = status === "upcoming" ? await scheduleReminder(ctx, id, row.startsAt) : undefined;
    await ctx.db.patch(id, { status, remindJobId });
  },
});

export const remove = mutation({
  args: { id: v.id("visits") },
  handler: async (ctx, { id }) => {
    const row = await ownVisit(ctx, id);
    if (row.remindJobId) await ctx.scheduler.cancel(row.remindJobId);
    await ctx.db.delete(id);
  },
});

export const remind = internalMutation({
  args: { id: v.id("visits"), startsAt: v.number() },
  handler: async (ctx, { id, startsAt }) => {
    const row = await ctx.db.get(id);
    if (!row || row.status !== "upcoming" || row.startsAt !== startsAt) return;
    const user = await ctx.db.get(row.userId);
    const lang = langOf(user);
    const who = row.clinicianId ? (await ctx.db.get(row.clinicianId))?.name : undefined;
    // Questions to ask, ready by the time they open the app (convex/questions.ts).
    if (!row.questions?.length) await ctx.scheduler.runAfter(0, internal.questions.writeForReminder, { id });
    await notify(ctx, row.userId, "appointments", {
      title: t(lang, "visitReminderTitle", row.title),
      body: t(lang, "visitReminderBody", timeText(row.startsAt, user?.timeZone ?? "UTC", lang), [who, row.location].filter(Boolean).join(" · ")),
      data: { visitId: id },
    });
  },
});

// Upcoming and recent appointments (telehealth bookings included), for the Visits tab. `now` comes from the app.
// Ticks one item of the appointment prep checklist on or off (src/GuidesPanel.tsx).
export const setChecked = mutation({
  args: { id: v.id("visits"), item: v.string(), on: v.boolean() },
  handler: async (ctx, { id, item, on }) => {
    const row = await ownVisit(ctx, id);
    const key = item.slice(0, 40);
    if (on === (row.checked ?? []).includes(key)) return;
    const rest = (row.checked ?? []).filter((x) => x !== key);
    const checked = on ? [...rest, key].slice(-60) : rest;
    await ctx.db.patch(id, { checked: checked.length ? checked : undefined });
  },
});

export const list = query({
  args: { now: v.number() },
  handler: async (ctx, { now }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;
    const rows = await ctx.db
      .query("visits")
      .withIndex("by_user_and_start", (q) => q.eq("userId", userId).gte("startsAt", now - 180 * 24 * 3_600_000))
      .take(200);
    const team = new Map((await ctx.db.query("careTeam").withIndex("by_user", (q) => q.eq("userId", userId)).take(MAX_TEAM)).map((m) => [m._id, m]));
    const tele = (await ctx.db.query("appointments").withIndex("by_user", (q) => q.eq("userId", userId)).order("desc").take(20)).filter(
      (a) => a.status === "booked" && a.startsAt,
    );
    const items = [
      ...rows.map((r) => ({
        _id: r._id as string,
        source: "visit" as const,
        title: r.title,
        kind: r.kind,
        startsAt: r.startsAt,
        status: r.status,
        clinicianId: r.clinicianId ?? null,
        clinician: r.clinicianId ? (team.get(r.clinicianId)?.name ?? null) : null,
        phone: r.clinicianId ? (team.get(r.clinicianId)?.phone ?? null) : null,
        location: r.location ?? null,
        prep: r.prep ?? null,
        notes: r.notes ?? null,
        questions: r.questions ?? null,
        checked: r.checked ?? [],
        joinUrl: null as string | null,
      })),
      ...tele.map((a) => ({
        _id: a._id as string,
        source: "telehealth" as const,
        title: a.reason,
        kind: "video" as const,
        startsAt: a.startsAt!,
        status: a.startsAt! < now - 2 * 3_600_000 ? ("done" as const) : ("upcoming" as const),
        clinicianId: null,
        clinician: a.slots.find((s) => s.id === a.slotId)?.clinician ?? null,
        phone: null,
        location: a.providerName ?? null,
        prep: null,
        notes: null,
        questions: null as string[] | null,
        checked: [] as string[],
        joinUrl: a.joinUrl ?? null,
      })),
    ];
    const upcoming = items.filter((i) => i.status === "upcoming" && i.startsAt >= now - 2 * 3_600_000).sort((a, b) => a.startsAt - b.startsAt);
    const past = items.filter((i) => !upcoming.includes(i)).sort((a, b) => b.startsAt - a.startsAt).slice(0, 30);
    return { upcoming, past };
  },
});

// ---------- For the model, visit summaries and reports ----------

export async function visitsText(ctx: QueryCtx, userId: Id<"users">, from: number, to: number, timeZone = "UTC"): Promise<string> {
  const rows = await ctx.db
    .query("visits")
    .withIndex("by_user_and_start", (q) => q.eq("userId", userId).gte("startsAt", from).lte("startsAt", to))
    .take(100);
  const team = new Map((await ctx.db.query("careTeam").withIndex("by_user", (q) => q.eq("userId", userId)).take(MAX_TEAM)).map((m) => [m._id, m]));
  const day = (ms: number) => {
    try {
      return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(ms));
    } catch {
      return new Date(ms).toISOString().slice(0, 16).replace("T", " ");
    }
  };
  return rows
    .map((r) => {
      const who = r.clinicianId ? team.get(r.clinicianId) : undefined;
      return (
        `- ${day(r.startsAt)} ${r.title}${who ? ` with ${who.name}${who.role ? ` (${who.role})` : ""}` : ""}` +
        `${r.status !== "upcoming" ? ` [${r.status}]` : ""}${r.location ? `, ${r.location}` : ""}` +
        (r.prep ? `\n  To ask: ${r.prep.replace(/\s+/g, " ")}` : "") +
        (r.notes ? `\n  Notes from the visit: ${r.notes.replace(/\s+/g, " ")}` : "")
      );
    })
    .join("\n");
}

export async function teamText(ctx: QueryCtx, userId: Id<"users">): Promise<string> {
  const team = await ctx.db.query("careTeam").withIndex("by_user", (q) => q.eq("userId", userId)).take(MAX_TEAM);
  return team.map((m) => `- ${m.name}${m.role ? `, ${m.role}` : ""}${m.clinic ? `, ${m.clinic}` : ""}${m.phone ? `, ${m.phone}` : ""}`).join("\n");
}

export const textFor = internalQuery({
  args: { userId: v.id("users"), from: v.number(), to: v.number() },
  handler: async (ctx, { userId, from, to }) => {
    const user = await ctx.db.get(userId);
    return visitsText(ctx, userId, from, to, user?.timeZone ?? "UTC");
  },
});

// The model's context: the next few appointments and the care team.
export const contextFor = internalQuery({
  args: { userId: v.id("users"), now: v.number() },
  handler: async (ctx, { userId, now }) => {
    const user = await ctx.db.get(userId);
    return {
      upcoming: await visitsText(ctx, userId, now, now + 60 * 24 * 3_600_000, user?.timeZone ?? "UTC"),
      team: await teamText(ctx, userId),
    };
  },
});

export const addFromChat = internalMutation({
  args: {
    userId: v.id("users"),
    title: v.string(),
    date: v.string(),
    time: v.string(),
    kind: v.optional(visitKind),
    clinician: v.optional(v.string()),
    location: v.optional(v.string()),
  },
  handler: async (ctx, { userId, title, date, time, kind, clinician, location }) => {
    const hhmm = normalizeTime(time);
    if (!isDate(date) || !hhmm) return "Tool error: give date as YYYY-MM-DD and time as HH:MM (24h).";
    const user = await ctx.db.get(userId);
    const [y, m, d] = date.split("-").map(Number);
    const startsAt = zonedTime(y, m - 1, d, hhmm, user?.timeZone ?? "UTC", user?.utcOffsetMin ?? 0);
    let clinicianId: Id<"careTeam"> | undefined;
    if (clinician?.trim()) {
      const wanted = clinician.trim().toLowerCase();
      const team = await ctx.db.query("careTeam").withIndex("by_user", (q) => q.eq("userId", userId)).take(MAX_TEAM);
      clinicianId = team.find((c) => c.name.toLowerCase().includes(wanted) || wanted.includes(c.name.toLowerCase()))?._id;
      clinicianId ??= await addMember(ctx, userId, { name: clinician });
    }
    try {
      await addVisit(ctx, userId, { title, kind, startsAt, clinicianId, location });
    } catch (e) {
      return `Tool error: ${(e as Error).message}`;
    }
    return `Added "${title}" on ${date} at ${hhmm} to the user's appointments, with a reminder 2 hours before. They can add questions to ask, and notes afterwards, in the Visits tab.`;
  },
});

export const addMemberFromChat = internalMutation({
  args: { userId: v.id("users"), name: v.string(), role: v.optional(v.string()), phone: v.optional(v.string()), clinic: v.optional(v.string()) },
  handler: async (ctx, { userId, ...m }) => {
    try {
      await addMember(ctx, userId, m);
      return `Added ${m.name} to the user's care team.`;
    } catch (e) {
      return `Tool error: ${(e as Error).message}`;
    }
  },
});

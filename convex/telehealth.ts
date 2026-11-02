// Telehealth video visits (convex/lib/telehealth.ts). When a clinician is needed but it isn't an emergency, the model
// calls suggest_telehealth (or the user asks from the Care tab): Wellnest finds a few times and posts them in the
// chat. Nothing is booked until the user taps a time and confirms. Push notifications: suggested, booked,
// 15 minutes before, cancelled or failed.
import { v } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";
import { internalAction, internalMutation, internalQuery, mutation, MutationCtx, query } from "./_generated/server";
import { internal } from "./_generated/api";
import { Doc, Id } from "./_generated/dataModel";
import { provider, slot, Slot, urgency, Urgency } from "./lib/telehealth";
import { langOf, t, timeText } from "./lib/language";
import { notify } from "./push";

const DAY_MS = 24 * 60 * 60 * 1000;
const OFFER_TTL_MS = 2 * 60 * 60 * 1000; // offered times go stale
const REMIND_BEFORE_MS = 15 * 60 * 1000;
export const DAILY_REQUESTS = 3;
const ACTIVE = ["finding", "suggested", "booking", "booked"];

// Shared by the chat tool and the Care tab's button.
async function requestVisit(ctx: MutationCtx, userId: Id<"users">, reason: string, when: Urgency) {
  const recent = await ctx.db
    .query("appointments")
    .withIndex("by_user", (q) => q.eq("userId", userId).gte("_creationTime", Date.now() - DAY_MS))
    .take(20);
  const booked = recent.find((a) => a.status === "booked" && (a.startsAt ?? 0) > Date.now());
  if (booked) return { error: "You already have a video visit booked; it's in the Care tab." };
  if (recent.some((a) => a.status === "finding" || a.status === "suggested" || a.status === "booking")) {
    return { error: "Video visit times are already waiting in the chat." };
  }
  if (recent.length >= DAILY_REQUESTS) return { error: `That's today's ${DAILY_REQUESTS} video visit requests. Try again tomorrow.` };
  const id = await ctx.db.insert("appointments", {
    userId,
    status: "finding",
    reason: reason.trim().slice(0, 300) || "Health concern",
    urgency: when,
    provider: provider().id,
    slots: [],
  });
  await ctx.scheduler.runAfter(0, internal.telehealth.findSlots, { id });
  return { id };
}

export const suggestFromChat = internalMutation({
  args: { userId: v.id("users"), reason: v.string(), urgency },
  handler: async (ctx, { userId, reason, urgency: when }) => {
    const res = await requestVisit(ctx, userId, reason, when);
    if ("error" in res) return `Tool error: ${res.error}`;
    return (
      "Looking for video visit times now; they'll appear in the app chat as buttons in a moment. Tell the user briefly " +
      "why a clinician should look at this, that nothing is booked until they pick a time and confirm, and that they " +
      "should call 911 instead if it gets worse quickly."
    );
  },
});

export const request = mutation({
  args: { reason: v.string(), urgency },
  handler: async (ctx, { reason, urgency: when }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not signed in");
    const res = await requestVisit(ctx, userId, reason, when);
    if ("error" in res) throw new Error(res.error);
    return res.id;
  },
});

export const findSlots = internalAction({
  args: { id: v.id("appointments") },
  handler: async (ctx, { id }) => {
    const row: Doc<"appointments"> | null = await ctx.runQuery(internal.telehealth.getInternal, { id });
    if (!row || row.status !== "finding") return;
    const user: Doc<"users"> | null = await ctx.runQuery(internal.pipeline.getUser, { userId: row.userId });
    try {
      const slots = await provider().findSlots({ reason: row.reason, urgency: row.urgency, language: langOf(user), now: Date.now() });
      await ctx.runMutation(internal.telehealth.offer, { id, slots, providerName: provider().name });
    } catch (e) {
      console.error("telehealth slots failed", e);
      await ctx.runMutation(internal.telehealth.offer, { id, slots: [], providerName: provider().name });
    }
  },
});

// Posts the times in the chat (the app shows them as buttons) and sends a push.
export const offer = internalMutation({
  args: { id: v.id("appointments"), slots: v.array(slot), providerName: v.string() },
  handler: async (ctx, { id, slots, providerName }) => {
    const row = await ctx.db.get(id);
    if (!row || row.status !== "finding") return;
    const user = await ctx.db.get(row.userId);
    const lang = langOf(user);
    const zone = user?.timeZone ?? "UTC";
    if (!slots.length) {
      await ctx.db.patch(id, { status: "failed", error: "no times" });
      await ctx.db.insert("messages", { userId: row.userId, role: "assistant", channel: "app", text: t(lang, "visitNoSlots"), urgent: false });
      return;
    }
    const times = slots.map((s) => `${timeText(s.startsAt, zone, lang)} (${s.clinician})`).join(", ");
    const messageId = await ctx.db.insert("messages", {
      userId: row.userId,
      role: "assistant",
      channel: "app",
      kind: "appointment",
      appointmentId: id,
      text: t(lang, "visitSuggested", providerName, times),
      urgent: false,
    });
    await ctx.db.patch(id, { status: "suggested", slots, providerName, messageId });
    await ctx.scheduler.runAfter(OFFER_TTL_MS, internal.telehealth.expire, { id });
    await notify(ctx, row.userId, "appointments", {
      title: t(lang, "visitSuggestedTitle"),
      body: t(lang, "visitSuggestedBody", timeText(slots[0].startsAt, zone, lang)),
      data: { appointmentId: id },
    });
  },
});

export const expire = internalMutation({
  args: { id: v.id("appointments") },
  handler: async (ctx, { id }) => {
    const row = await ctx.db.get(id);
    if (row?.status === "suggested") await ctx.db.patch(id, { status: "expired" });
  },
});

async function own(ctx: MutationCtx, id: Id<"appointments">) {
  const userId = await getAuthUserId(ctx);
  if (!userId) throw new Error("Not signed in");
  const row = await ctx.db.get(id);
  if (!row || row.userId !== userId) throw new Error("Not found");
  return row;
}

// The user picked a time and confirmed: book it.
export const confirm = mutation({
  args: { id: v.id("appointments"), slotId: v.string() },
  handler: async (ctx, { id, slotId }) => {
    const row = await own(ctx, id);
    if (row.status !== "suggested") throw new Error(row.status === "expired" ? "Those times have expired. Ask for new ones." : "This visit can't be booked now.");
    const chosen = row.slots.find((s) => s.id === slotId);
    if (!chosen) throw new Error("That time isn't on offer.");
    if (chosen.startsAt < Date.now()) throw new Error("That time has passed. Ask for new times.");
    await ctx.db.patch(id, { status: "booking", slotId });
    await ctx.scheduler.runAfter(0, internal.telehealth.book, { id });
  },
});

export const book = internalAction({
  args: { id: v.id("appointments") },
  handler: async (ctx, { id }) => {
    const data: { row: Doc<"appointments">; user: Doc<"users"> | null; summary: string | null } | null = await ctx.runQuery(
      internal.telehealth.bookingInput,
      { id, now: Date.now() },
    );
    if (!data || data.row.status !== "booking" || !data.row.slotId) return;
    try {
      const booking = await provider().book({
        slotId: data.row.slotId,
        reason: data.row.reason,
        summary: data.summary ?? data.row.reason,
        language: langOf(data.user),
        patient: { email: data.user?.email, name: data.user?.name },
      });
      await ctx.runMutation(internal.telehealth.booked, { id, ...booking });
    } catch (e) {
      console.error("telehealth booking failed", e);
      await ctx.runMutation(internal.telehealth.bookingFailed, { id, error: (e as Error).message.slice(0, 300) });
    }
  },
});

// What goes to the provider: the reason, plus the latest visit summary if it was made in the last day.
export const bookingInput = internalQuery({
  args: { id: v.id("appointments"), now: v.number() },
  handler: async (ctx, { id, now }) => {
    const row = await ctx.db.get(id);
    if (!row) return null;
    const user = await ctx.db.get(row.userId);
    const latest = await ctx.db
      .query("visitSummaries")
      .withIndex("by_user", (q) => q.eq("userId", row.userId).gt("_creationTime", now - DAY_MS))
      .order("desc")
      .first();
    return { row, user, summary: latest?.status === "ready" && latest.text ? latest.text : null };
  },
});

export const booked = internalMutation({
  args: { id: v.id("appointments"), bookingId: v.string(), joinUrl: v.string(), startsAt: v.number() },
  handler: async (ctx, { id, bookingId, joinUrl, startsAt }) => {
    const row = await ctx.db.get(id);
    if (!row || row.status !== "booking") return;
    const remindAt = startsAt - REMIND_BEFORE_MS;
    const remindJobId = remindAt > Date.now() ? await ctx.scheduler.runAt(remindAt, internal.telehealth.remind, { id }) : undefined;
    await ctx.db.patch(id, { status: "booked", bookingId, joinUrl, startsAt, remindJobId });
    const user = await ctx.db.get(row.userId);
    const lang = langOf(user);
    const clinician = row.slots.find((s) => s.id === row.slotId)?.clinician ?? "";
    const when = timeText(startsAt, user?.timeZone ?? "UTC", lang);
    await notify(ctx, row.userId, "appointments", {
      title: t(lang, "visitBookedTitle"),
      body: t(lang, "visitBookedBody", clinician, when),
      data: { appointmentId: id },
    });
  },
});

export const bookingFailed = internalMutation({
  args: { id: v.id("appointments"), error: v.string() },
  handler: async (ctx, { id, error }) => {
    const row = await ctx.db.get(id);
    if (!row || row.status !== "booking") return;
    await ctx.db.patch(id, { status: "failed", error });
    const lang = langOf(await ctx.db.get(row.userId));
    await notify(ctx, row.userId, "appointments", { title: t(lang, "visitFailedTitle"), body: t(lang, "visitFailedBody"), data: { appointmentId: id } });
  },
});

export const remind = internalMutation({
  args: { id: v.id("appointments") },
  handler: async (ctx, { id }) => {
    const row = await ctx.db.get(id);
    if (row?.status !== "booked") return;
    const lang = langOf(await ctx.db.get(row.userId));
    await notify(ctx, row.userId, "appointments", {
      title: t(lang, "visitSoonTitle"),
      body: t(lang, "visitSoonBody"),
      data: { appointmentId: id, url: row.joinUrl ?? "" },
    });
  },
});

// Not now (on offered times) or cancel (a booked visit, also cancelled with the provider).
export const cancel = mutation({
  args: { id: v.id("appointments") },
  handler: async (ctx, { id }) => {
    const row = await own(ctx, id);
    if (row.status === "suggested" || row.status === "finding") {
      await ctx.db.patch(id, { status: "dismissed" });
      return;
    }
    if (row.status !== "booked") throw new Error("This visit can't be cancelled now.");
    if (row.remindJobId) await ctx.scheduler.cancel(row.remindJobId);
    await ctx.db.patch(id, { status: "cancelling", remindJobId: undefined });
    await ctx.scheduler.runAfter(0, internal.telehealth.cancelWithProvider, { id });
  },
});

export const cancelWithProvider = internalAction({
  args: { id: v.id("appointments") },
  handler: async (ctx, { id }) => {
    const row: Doc<"appointments"> | null = await ctx.runQuery(internal.telehealth.getInternal, { id });
    if (!row || row.status !== "cancelling" || !row.bookingId) return;
    let ok = true;
    try {
      await provider().cancel(row.bookingId);
    } catch (e) {
      console.error("telehealth cancel failed", e);
      ok = false;
    }
    await ctx.runMutation(internal.telehealth.cancelled, { id, ok });
  },
});

export const cancelled = internalMutation({
  args: { id: v.id("appointments"), ok: v.boolean() },
  handler: async (ctx, { id, ok }) => {
    const row = await ctx.db.get(id);
    if (!row || row.status !== "cancelling") return;
    // If the provider didn't confirm, keep it booked so the user can try again (or cancel with the provider).
    await ctx.db.patch(id, ok ? { status: "cancelled" } : { status: "booked", error: "cancel failed" });
    const lang = langOf(await ctx.db.get(row.userId));
    await notify(ctx, row.userId, "appointments", {
      title: t(lang, ok ? "visitCancelledTitle" : "visitCancelFailedTitle"),
      body: t(lang, ok ? "visitCancelledBody" : "visitCancelFailedBody"),
      data: { appointmentId: id },
    });
  },
});

export const getInternal = internalQuery({
  args: { id: v.id("appointments") },
  handler: (ctx, { id }) => ctx.db.get(id),
});

const view = (a: Doc<"appointments">) => ({
  _id: a._id,
  status: a.status,
  reason: a.reason,
  urgency: a.urgency,
  providerName: a.providerName ?? null,
  testProvider: a.provider === "test",
  slots: a.slots as Slot[],
  slotId: a.slotId ?? null,
  startsAt: a.startsAt ?? null,
  joinUrl: a.status === "booked" ? (a.joinUrl ?? null) : null,
  createdAt: a._creationTime,
});

// The appointment card in the chat.
export const get = query({
  args: { id: v.id("appointments") },
  handler: async (ctx, { id }) => {
    const userId = await getAuthUserId(ctx);
    const row = userId ? await ctx.db.get(id) : null;
    return row && row.userId === userId ? view(row) : null;
  },
});

// The Care tab: the latest active or booked visit.
export const current = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;
    const rows = await ctx.db.query("appointments").withIndex("by_user", (q) => q.eq("userId", userId)).order("desc").take(10);
    const row = rows.find((a) => ACTIVE.includes(a.status));
    return row ? view(row) : null;
  },
});

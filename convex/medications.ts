// Medication details (convex/lib/meds.ts) on top of reminders (convex/reminders.ts): generic name, form, prescriber,
// per-time doses, pause / resume / stop with a dated history, side effects, refill supply and an eScript photo.
import { v } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";
import { internalMutation, mutation, MutationCtx, query } from "./_generated/server";
import { internal } from "./_generated/api";
import { Doc, Id } from "./_generated/dataModel";
import { daysLeft, medEventKind, medForm, statusOf, timeDose } from "./lib/meds";
import { checkSchedule, nextDue, normalizeTime } from "./lib/reminders";
import { clampSeverity } from "./lib/journal";
import { lookupSoon } from "./drugs";

const MAX_SIDE_EFFECTS = 200;

async function own(ctx: MutationCtx, id: Id<"medications">) {
  const userId = await getAuthUserId(ctx);
  if (!userId) throw new Error("Not signed in");
  const med = await ctx.db.get(id);
  if (!med || med.userId !== userId) throw new Error("Not found");
  return med;
}

export async function logEvent(
  ctx: MutationCtx,
  med: Doc<"medications">,
  kind: "started" | "paused" | "resumed" | "stopped" | "dose_changed" | "refilled",
  note?: string,
) {
  await ctx.db.insert("medicationEvents", { userId: med.userId, medicationId: med._id, kind, at: Date.now(), note });
}

export async function pauseMed(ctx: MutationCtx, med: Doc<"medications">) {
  if (!med.active) return;
  if (med.jobId) await ctx.scheduler.cancel(med.jobId);
  await ctx.db.patch(med._id, { active: false, nextAt: undefined, jobId: undefined, pausedAt: Date.now() });
  await logEvent(ctx, med, "paused");
}

export async function resumeMed(ctx: MutationCtx, med: Doc<"medications">) {
  if (med.active || med.stoppedAt) return;
  const at = nextDue(med.schedule, Date.now(), med.timeZone, med.utcOffsetMin);
  const jobId = await ctx.scheduler.runAt(at, internal.reminders.fire, { id: med._id, dueAt: at });
  await ctx.db.patch(med._id, { active: true, pausedAt: undefined, nextAt: at, jobId });
  await logEvent(ctx, med, "resumed");
}

export async function changeDose(ctx: MutationCtx, med: Doc<"medications">, dose: string) {
  const clean = dose.trim().slice(0, 80);
  if (!clean || clean === med.dose) return;
  await ctx.db.patch(med._id, { dose: clean });
  await logEvent(ctx, med, "dose_changed", `${med.dose ?? "?"} → ${clean}`);
}

export async function addSideEffectTo(ctx: MutationCtx, med: Doc<"medications">, effect: string, severity?: number, date?: string) {
  const clean = effect.trim().slice(0, 200);
  if (!clean) throw new Error("Describe the side effect.");
  const count = await ctx.db.query("sideEffects").withIndex("by_medication", (q) => q.eq("medicationId", med._id)).take(MAX_SIDE_EFFECTS);
  if (count.length >= MAX_SIDE_EFFECTS) throw new Error("That's a lot of side effects for one medication; remove some first.");
  const day = date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : new Date().toISOString().slice(0, 10);
  await ctx.db.insert("sideEffects", { userId: med.userId, medicationId: med._id, date: day, effect: clean, severity: clampSeverity(severity) });
}

export async function refillMed(ctx: MutationCtx, med: Doc<"medications">, amount?: number) {
  if (!med.supply) return;
  const left = amount !== undefined && amount > 0 ? med.supply.left + amount : med.supply.left;
  await ctx.db.patch(med._id, { supply: { ...med.supply, left, warnedAt: undefined, refilledAt: Date.now() } });
  await logEvent(ctx, med, "refilled", amount ? `+${amount}` : undefined);
}

// The details form, and account setup's edit (name, dose and daily times; new times reschedule the next reminder).
export const update = mutation({
  args: {
    id: v.id("medications"),
    name: v.optional(v.string()),
    times: v.optional(v.array(v.string())),
    directions: v.optional(v.string()),
    genericName: v.optional(v.string()),
    form: v.optional(medForm),
    prescriber: v.optional(v.string()),
    notes: v.optional(v.string()),
    dose: v.optional(v.string()),
    timeDoses: v.optional(v.array(timeDose)),
  },
  handler: async (ctx, { id, dose, timeDoses, name, times, ...fields }) => {
    let med = await own(ctx, id);
    const patch: Partial<Doc<"medications">> = {};
    if (name !== undefined) {
      const clean = name.trim().slice(0, 80);
      if (!clean) throw new Error("Give the medication a name.");
      patch.name = clean;
    }
    if (times !== undefined) {
      const checked = checkSchedule({ kind: "daily", times });
      if ("error" in checked) throw new Error(checked.error);
      patch.schedule = checked.schedule;
      const kept = checked.schedule.kind === "daily" ? checked.schedule.times : [];
      patch.timeDoses = (med.timeDoses ?? []).filter((t) => kept.includes(t.time));
      if (med.active) {
        if (med.jobId) await ctx.scheduler.cancel(med.jobId);
        const at = nextDue(checked.schedule, Date.now(), med.timeZone, med.utcOffsetMin);
        patch.nextAt = at;
        patch.jobId = await ctx.scheduler.runAt(at, internal.reminders.fire, { id, dueAt: at });
      }
    }
    if (fields.directions !== undefined) patch.directions = fields.directions.trim().slice(0, 200) || undefined;
    if (fields.genericName !== undefined) patch.genericName = fields.genericName.trim().slice(0, 80) || undefined;
    if (fields.prescriber !== undefined) patch.prescriber = fields.prescriber.trim().slice(0, 80) || undefined;
    if (fields.notes !== undefined) patch.notes = fields.notes.trim().slice(0, 500) || undefined;
    if (fields.form !== undefined) patch.form = fields.form;
    if (timeDoses !== undefined) {
      const times = med.schedule.kind === "daily" ? med.schedule.times : [];
      patch.timeDoses = timeDoses
        .map((t) => ({ time: normalizeTime(t.time) ?? "", dose: t.dose.trim().slice(0, 80) }))
        .filter((t) => t.dose && times.includes(t.time));
    }
    await ctx.db.patch(id, patch);
    const before = med;
    med = { ...med, ...patch };
    if (dose !== undefined) await changeDose(ctx, med, dose);
    if ((patch.name && patch.name !== before.name) || ("genericName" in patch && patch.genericName !== before.genericName)) await lookupSoon(ctx, med, true);
  },
});

export const pause = mutation({ args: { id: v.id("medications") }, handler: async (ctx, { id }) => pauseMed(ctx, await own(ctx, id)) });
export const resume = mutation({ args: { id: v.id("medications") }, handler: async (ctx, { id }) => resumeMed(ctx, await own(ctx, id)) });

export const addSideEffect = mutation({
  args: { id: v.id("medications"), effect: v.string(), severity: v.optional(v.number()), date: v.optional(v.string()) },
  handler: async (ctx, { id, effect, severity, date }) => addSideEffectTo(ctx, await own(ctx, id), effect, severity, date),
});

export const removeSideEffect = mutation({
  args: { id: v.id("sideEffects") },
  handler: async (ctx, { id }) => {
    const userId = await getAuthUserId(ctx);
    const row = await ctx.db.get(id);
    if (!userId || !row || row.userId !== userId) throw new Error("Not found");
    await ctx.db.delete(id);
  },
});

// Units on hand and per dose; Wellnest warns (push + chat note) when it'll run out within `warnDays`.
export const setSupply = mutation({
  args: { id: v.id("medications"), left: v.number(), perDose: v.number(), warnDays: v.optional(v.number()) },
  handler: async (ctx, { id, left, perDose, warnDays }) => {
    await own(ctx, id);
    if (!(left >= 0) || !(perDose > 0)) throw new Error("Enter how many you have and how many per dose.");
    await ctx.db.patch(id, {
      supply: { left: Math.round(left * 4) / 4, perDose: Math.round(perDose * 4) / 4, warnDays: Math.min(60, Math.max(1, Math.round(warnDays ?? 7))) },
    });
  },
});

export const clearSupply = mutation({ args: { id: v.id("medications") }, handler: async (ctx, { id }) => (await own(ctx, id), ctx.db.patch(id, { supply: undefined })) });

export const refill = mutation({
  args: { id: v.id("medications"), amount: v.optional(v.number()) },
  handler: async (ctx, { id, amount }) => refillMed(ctx, await own(ctx, id), amount),
});

// The eScript QR code (or prescription label) as a photo the user uploaded and claimed (convex/chat.ts claimUpload).
export const setScript = mutation({
  args: { id: v.id("medications"), storageId: v.union(v.id("_storage"), v.null()) },
  handler: async (ctx, { id, storageId }) => {
    const med = await own(ctx, id);
    if (storageId) {
      const upload = await ctx.db.query("photoUploads").withIndex("by_storage", (q) => q.eq("storageId", storageId)).unique();
      const file = await ctx.db.system.get("_storage", storageId);
      if (!upload || upload.userId !== med.userId || upload.messageId || upload.usedFor || !file?.contentType?.startsWith("image/")) {
        throw new Error("That photo didn't upload. Please try again.");
      }
      await ctx.db.patch(upload._id, { usedFor: "script" });
    }
    if (med.scriptImage) await ctx.storage.delete(med.scriptImage).catch(() => {});
    await ctx.db.patch(id, { scriptImage: storageId ?? undefined });
  },
});

// Every medication, active first, then paused, then stopped (most recent first).
export const all = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];
    const meds = await ctx.db.query("medications").withIndex("by_user_and_active", (q) => q.eq("userId", userId)).take(100);
    const order = { active: 0, paused: 1, stopped: 2 } as const;
    return meds
      .map((m) => ({
        _id: m._id,
        name: m.name,
        dose: m.dose ?? null,
        status: statusOf(m),
        rule: m.schedule.kind === "daily" ? m.schedule : { kind: "interval" as const, everyHours: m.schedule.everyHours },
        nextAt: m.nextAt ?? null,
        daysLeft: daysLeft(m.schedule, m.supply),
        changedAt: m.stoppedAt ?? m.pausedAt ?? m._creationTime,
        // For the printable medication list.
        form: m.form ?? null,
        notes: m.notes ?? null,
        directions: m.directions ?? null,
        timeDoses: m.timeDoses ?? [],
      }))
      .sort((a, b) => order[a.status] - order[b.status] || b.changedAt - a.changedAt);
  },
});

export const detail = query({
  args: { id: v.id("medications") },
  handler: async (ctx, { id }) => {
    const userId = await getAuthUserId(ctx);
    const m = userId ? await ctx.db.get(id) : null;
    if (!m || m.userId !== userId) return null;
    const events = await ctx.db.query("medicationEvents").withIndex("by_medication", (q) => q.eq("medicationId", id)).order("desc").take(50);
    const effects = await ctx.db.query("sideEffects").withIndex("by_medication", (q) => q.eq("medicationId", id)).order("desc").take(50);
    return {
      _id: m._id,
      name: m.name,
      dose: m.dose ?? null,
      genericName: m.genericName ?? null,
      form: m.form ?? null,
      prescriber: m.prescriber ?? null,
      notes: m.notes ?? null,
      directions: m.directions ?? null,
      status: statusOf(m),
      rule: m.schedule.kind === "daily" ? m.schedule : { kind: "interval" as const, everyHours: m.schedule.everyHours },
      timeDoses: m.timeDoses ?? [],
      supply: m.supply ? { left: m.supply.left, perDose: m.supply.perDose, warnDays: m.supply.warnDays } : null,
      daysLeft: daysLeft(m.schedule, m.supply),
      scriptUrl: m.scriptImage ? await ctx.storage.getUrl(m.scriptImage) : null,
      startedAt: m._creationTime,
      events: events.map((e) => ({ _id: e._id, kind: e.kind, at: e.at, note: e.note ?? null })),
      sideEffects: effects.map((e) => ({ _id: e._id, date: e.date, effect: e.effect, severity: e.severity ?? null })),
    };
  },
});

// The model's update_medication tool.
export const updateFromChat = internalMutation({
  args: {
    userId: v.id("users"),
    name: v.string(),
    action: v.union(v.literal("pause"), v.literal("resume"), v.literal("stop"), v.literal("change_dose"), v.literal("side_effect"), v.literal("refilled")),
    dose: v.optional(v.string()),
    sideEffect: v.optional(v.string()),
    severity: v.optional(v.number()),
    amount: v.optional(v.number()),
  },
  handler: async (ctx, { userId, name, action, dose, sideEffect, severity, amount }) => {
    const wanted = name.trim().toLowerCase();
    if (!wanted) return "Tool error: say which medication.";
    const meds = (await ctx.db.query("medications").withIndex("by_user_and_active", (q) => q.eq("userId", userId)).take(100)).filter(
      (m) => !m.stoppedAt && (m.name.toLowerCase().includes(wanted) || wanted.includes(m.name.toLowerCase()) || m.genericName?.toLowerCase() === wanted),
    );
    if (!meds.length) return `Tool error: no current medication matches "${name}". The user can add it in the Medications tab, or you can set a reminder.`;
    const med = meds[0];
    try {
      switch (action) {
        case "pause":
          await pauseMed(ctx, med);
          return `Paused ${med.name}; reminders are off until it's resumed.`;
        case "resume":
          await resumeMed(ctx, med);
          return `Resumed ${med.name}; reminders are back on.`;
        case "stop":
          if (med.jobId) await ctx.scheduler.cancel(med.jobId);
          await ctx.db.patch(med._id, { active: false, nextAt: undefined, jobId: undefined, stoppedAt: Date.now() });
          await logEvent(ctx, med, "stopped");
          return `Stopped ${med.name}. It stays in the medication history.`;
        case "change_dose":
          if (!dose) return "Tool error: give the new dose.";
          await changeDose(ctx, med, dose);
          return `Changed ${med.name} to ${dose}; the change is in its history.`;
        case "side_effect":
          if (!sideEffect) return "Tool error: describe the side effect.";
          await addSideEffectTo(ctx, med, sideEffect, severity);
          return `Logged a side effect for ${med.name}: ${sideEffect}.`;
        case "refilled":
          if (!med.supply) return `Noted. ${med.name} has no supply count set; the user can add one in the Medications tab.`;
          await refillMed(ctx, med, amount);
          return `Logged a refill of ${med.name}${amount ? ` (+${amount})` : ""}.`;
      }
    } catch (e) {
      return `Tool error: ${(e as Error).message}`;
    }
  },
});

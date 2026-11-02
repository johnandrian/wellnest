// Emergency action plans: the user's own steps for a seizure, an asthma attack or a bad flare, emergency contacts,
// and the asthma action plan their doctor gave them. Shown full screen in the Care tab, shared with carers through a
// share link (convex/share.ts, the "emergency" section), included in reports, and given to the model on urgent
// messages. Wellnest stores the plan; it doesn't write medical advice into it.
import { v } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";
import { internalQuery, mutation, query, QueryCtx } from "./_generated/server";
import { Id } from "./_generated/dataModel";
import type { EmergencyPlanData } from "./lib/report";
import { asthmaPlan, contact, planSection } from "./lib/emergency";

const clip = (s: string | undefined, n: number) => s?.trim().slice(0, n) || undefined;

export const get = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;
    const plan = await ctx.db.query("emergencyPlans").withIndex("by_user", (q) => q.eq("userId", userId)).unique();
    if (!plan) return { exists: false as const };
    const { _id, _creationTime, userId: _, ...rest } = plan;
    return { exists: true as const, ...rest };
  },
});

export const save = mutation({
  args: {
    sections: v.array(planSection),
    contacts: v.array(contact),
    asthma: v.optional(asthmaPlan),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, a) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not signed in");
    const sections = a.sections
      .slice(0, 10)
      .map((s) => ({ title: s.title.trim().slice(0, 80), steps: s.steps.map((x) => x.trim().slice(0, 300)).filter(Boolean).slice(0, 20) }))
      .filter((s) => s.title || s.steps.length);
    const contacts = a.contacts
      .slice(0, 10)
      .map((c) => ({ name: c.name.trim().slice(0, 80), relation: clip(c.relation, 40), phone: c.phone.trim().slice(0, 40) }))
      .filter((c) => c.name && /\d{3,}/.test(c.phone));
    const asthma = a.asthma && {
      preventer: clip(a.asthma.preventer, 200),
      reliever: clip(a.asthma.reliever, 200),
      green: clip(a.asthma.green, 1000),
      yellow: clip(a.asthma.yellow, 1000),
      red: clip(a.asthma.red, 1000),
      best: a.asthma.best && a.asthma.best >= 50 && a.asthma.best <= 900 ? Math.round(a.asthma.best) : undefined,
    };
    const doc = {
      userId,
      sections,
      contacts,
      asthma: asthma && Object.values(asthma).some((x) => x !== undefined) ? asthma : undefined,
      notes: clip(a.notes, 2000),
    };
    const existing = await ctx.db.query("emergencyPlans").withIndex("by_user", (q) => q.eq("userId", userId)).unique();
    if (existing) await ctx.db.replace(existing._id, doc);
    else await ctx.db.insert("emergencyPlans", doc);
  },
});

export const remove = mutation({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not signed in");
    const existing = await ctx.db.query("emergencyPlans").withIndex("by_user", (q) => q.eq("userId", userId)).unique();
    if (existing) await ctx.db.delete(existing._id);
  },
});

export async function emergencyData(ctx: QueryCtx, userId: Id<"users">): Promise<EmergencyPlanData | null> {
  const plan = await ctx.db.query("emergencyPlans").withIndex("by_user", (q) => q.eq("userId", userId)).unique();
  if (!plan) return null;
  return { sections: plan.sections, contacts: plan.contacts, asthma: plan.asthma, notes: plan.notes };
}

// Plain text for the model on urgent messages.
export function emergencyText(p: EmergencyPlanData): string {
  return [
    ...p.sections.map((s) => `${s.title}:\n${s.steps.map((x, i) => `${i + 1}. ${x}`).join("\n")}`),
    p.asthma?.red && `Asthma action plan, emergency: ${p.asthma.red}`,
    p.asthma?.reliever && `Reliever: ${p.asthma.reliever}`,
    p.contacts.length && `Emergency contacts: ${p.contacts.map((c) => `${c.name}${c.relation ? ` (${c.relation})` : ""} ${c.phone}`).join(", ")}`,
  ]
    .filter(Boolean)
    .join("\n");
}

export const textFor = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    const plan = await emergencyData(ctx, userId);
    return plan ? emergencyText(plan) : "";
  },
});

// Account setup: a few questions after someone first signs in (src/Onboarding.tsx), each one skippable. Language,
// city, medications and the check-in switches reuse their own functions; this file keeps the rest: what to call
// them, their age range and sex, what they use Wellnest for, conditions and allergies (saved as facts), one emergency
// contact, and finishing, which posts a welcome in the chat the first time. Existing accounts see it once too.
import { v } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";
import { mutation, MutationCtx, query } from "./_generated/server";
import { ageRange, FACT_PREFIX, focus, sex, welcomeText } from "./lib/onboarding";
import { langOf } from "./lib/language";
import { insertFact } from "./me";
import { saveAssistantReply } from "./pipeline";

const MAX_ITEMS = 15;
const clip = (s: string | undefined, n: number) => s?.replace(/\s+/g, " ").trim().slice(0, n) || undefined;

async function me(ctx: MutationCtx) {
  const userId = await getAuthUserId(ctx);
  if (!userId) throw new Error("Not signed in");
  return userId;
}

// What's already known, so the steps start filled in (an existing account may have a city, facts or a plan).
export const state = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;
    const user = await ctx.db.get(userId);
    if (!user) return null;
    const plan = await ctx.db.query("emergencyPlans").withIndex("by_user", (q) => q.eq("userId", userId)).unique();
    const meds = await ctx.db.query("medications").withIndex("by_user_and_active", (q) => q.eq("userId", userId).eq("active", true)).take(20);
    return {
      done: !!user.onboardedAt,
      name: user.profile?.name ?? "",
      ageRange: user.profile?.ageRange ?? null,
      sex: user.profile?.sex ?? null,
      focus: user.focus ?? [],
      location: user.location ?? "",
      facts: (await ctx.db.query("memoryFacts").withIndex("by_user", (q) => q.eq("userId", userId)).take(50)).map((f) => f.text),
      // Set up here as one daily reminder each; the step lists them to edit or remove.
      meds: meds.map((m) => ({
        _id: m._id,
        name: m.name,
        dose: m.dose ?? "",
        times: m.schedule.kind === "daily" ? m.schedule.times : [],
      })),
      contact: plan?.contacts[0] ?? null,
      checkins: user.checkins ?? true,
      weeklySummary: user.weeklySummary ?? true,
    };
  },
});

export const saveProfile = mutation({
  args: { name: v.optional(v.string()), ageRange: v.optional(v.union(ageRange, v.null())), sex: v.optional(v.union(sex, v.null())) },
  handler: async (ctx, args) => {
    const userId = await me(ctx);
    const user = await ctx.db.get(userId);
    const profile = { ...user?.profile };
    if (args.name !== undefined) profile.name = clip(args.name, 60);
    if (args.ageRange !== undefined) profile.ageRange = args.ageRange ?? undefined;
    if (args.sex !== undefined) profile.sex = args.sex ?? undefined;
    await ctx.db.patch(userId, { profile });
  },
});

export const setFocus = mutation({
  args: { focus: v.array(focus) },
  handler: async (ctx, args) => {
    const userId = await me(ctx);
    await ctx.db.patch(userId, { focus: [...new Set(args.focus)] });
  },
});

// "Condition: asthma", "Allergy: penicillin", in the user's language. Repeats are skipped.
export const addFacts = mutation({
  args: { conditions: v.array(v.string()), allergies: v.array(v.string()) },
  handler: async (ctx, { conditions, allergies }) => {
    const userId = await me(ctx);
    const words = FACT_PREFIX[langOf(await ctx.db.get(userId))];
    const items = [
      ...conditions.slice(0, MAX_ITEMS).map((c) => [words.condition, clip(c, 120)] as const),
      ...allergies.slice(0, MAX_ITEMS).map((a) => [words.allergy, clip(a, 120)] as const),
    ];
    for (const [label, text] of items) {
      if (!text) continue;
      const res = await insertFact(ctx, userId, `${label}: ${text}`, "user");
      if ("error" in res) throw new Error(res.error);
    }
  },
});

// One emergency contact, kept as the first contact of the emergency plan (made if there's none yet).
export const setContact = mutation({
  args: { name: v.string(), relation: v.optional(v.string()), phone: v.string() },
  handler: async (ctx, args) => {
    const userId = await me(ctx);
    const contact = { name: clip(args.name, 80) ?? "", relation: clip(args.relation, 40), phone: args.phone.trim().slice(0, 40) };
    if (!contact.name) throw new Error("Add their name.");
    if (!/\d{3,}/.test(contact.phone)) throw new Error("Add a phone number.");
    const plan = await ctx.db.query("emergencyPlans").withIndex("by_user", (q) => q.eq("userId", userId)).unique();
    if (!plan) {
      await ctx.db.insert("emergencyPlans", { userId, sections: [], contacts: [contact] });
      return;
    }
    const others = plan.contacts.filter((c) => c.name.toLowerCase() !== contact.name.toLowerCase());
    await ctx.db.patch(plan._id, { contacts: [contact, ...others].slice(0, 10) });
  },
});

// Done (or "finish later"). The welcome goes in the chat only the first time.
export const finish = mutation({
  args: {},
  handler: async (ctx) => {
    const userId = await me(ctx);
    const user = await ctx.db.get(userId);
    if (!user) return;
    if (!user.onboardedAt) {
      await saveAssistantReply(ctx, { userId, text: welcomeText(langOf(user), user.profile?.name, user.focus ?? []), channel: "app", urgent: false }, false);
    }
    await ctx.db.patch(userId, { onboardedAt: Date.now() });
  },
});

// The first-time tour (src/Tour.tsx) was finished or skipped; it can be watched again from Settings.
export const tourDone = mutation({
  args: {},
  handler: async (ctx) => {
    const userId = await me(ctx);
    await ctx.db.patch(userId, { touredAt: Date.now() });
  },
});

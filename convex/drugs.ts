// Medication safety: possible interactions between the user's medications, from the US FDA labels (openFDA), with
// RxNorm turning brand names and misspellings into ingredients. Each name is looked up once and shared (public
// data), refreshed after 30 days. A new interaction is also said once in chat, in the user's language.
// This is the label's wording, not a judgement: the app says to ask a pharmacist.
import { v } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";
import { internalAction, internalMutation, mutation, MutationCtx, query, QueryCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { DrugInfo, drugKey, findInteractions } from "./lib/drugs";
import { insertMessage } from "./lib/chats";
import { langOf, t } from "./lib/language";

const FRESH_MS = 30 * 86_400_000;
const MAX_TEXT = 30_000;
const RXNAV = "https://rxnav.nlm.nih.gov/REST";
const OPENFDA = "https://api.fda.gov/drug/label.json";

const keyOf = (m: Pick<Doc<"medications">, "name" | "genericName">) => drugKey(m.genericName || m.name);

// Medications that count: taking now or paused (not stopped).
async function current(ctx: QueryCtx, userId: Id<"users">) {
  return (await ctx.db.query("medications").withIndex("by_user_and_active", (q) => q.eq("userId", userId)).take(100)).filter((m) => !m.stoppedAt);
}

async function infoFor(ctx: QueryCtx, key: string) {
  return key ? await ctx.db.query("drugInfo").withIndex("by_key", (q) => q.eq("key", key)).unique() : null;
}

async function interactionsFor(ctx: QueryCtx, userId: Id<"users">) {
  const meds = await current(ctx, userId);
  const withInfo = await Promise.all(
    meds.map(async (m) => {
      const info = await infoFor(ctx, keyOf(m));
      return { med: m, name: m.name, info: info?.found ? (info as DrugInfo) : null, pending: !info };
    }),
  );
  return { meds: withInfo, interactions: findInteractions(withInfo) };
}

// The Medications tab's safety card.
export const view = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;
    const { meds, interactions } = await interactionsFor(ctx, userId);
    return {
      interactions,
      boxed: meds.flatMap((m) => (m.info && (m.info as Doc<"drugInfo">).boxedWarning ? [{ name: m.name, text: (m.info as Doc<"drugInfo">).boxedWarning! }] : [])),
      checked: meds.filter((m) => m.info).length,
      unknown: meds.filter((m) => !m.info && !m.pending).map((m) => m.name),
      pending: meds.some((m) => m.pending),
      total: meds.length,
    };
  },
});

// Looks up any of the user's medications not looked up yet (or not lately). The tab calls it when it opens.
export const ensure = mutation({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return;
    for (const m of await current(ctx, userId)) await lookupSoon(ctx, m);
  },
});

// After adding or renaming a medication. `alert`: say a new interaction in chat once the lookup is done.
export async function lookupSoon(ctx: MutationCtx, med: Pick<Doc<"medications">, "_id" | "name" | "genericName">, alert = false) {
  const key = keyOf(med);
  if (!key) return;
  const info = await infoFor(ctx, key);
  if (info && info.fetchedAt > Date.now() - FRESH_MS) {
    if (alert && info.found) await ctx.scheduler.runAfter(0, internal.drugs.alert, { medicationId: med._id });
    return;
  }
  // A placeholder stops a second lookup while this one runs.
  if (!info) await ctx.db.insert("drugInfo", { key, found: false, ingredients: [], brands: [], classes: [], interactions: "", fetchedAt: Date.now() });
  else await ctx.db.patch(info._id, { fetchedAt: Date.now() });
  await ctx.scheduler.runAfter(0, internal.drugs.lookup, { key, ...(alert && { medicationId: med._id }) });
}

async function getJson(url: string): Promise<any> {
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (res.status === 404) return null; // openFDA: no match
  if (!res.ok) throw new Error(`${new URL(url).host} ${res.status}`);
  return res.json();
}

const names = (group: any, tty: string): string[] =>
  (group?.relatedGroup?.conceptGroup ?? []).filter((g: any) => g.tty === tty).flatMap((g: any) => (g.conceptProperties ?? []).map((p: any) => String(p.name).toLowerCase()));

export const lookup = internalAction({
  args: { key: v.string(), medicationId: v.optional(v.id("medications")) },
  handler: async (ctx, { key, medicationId }) => {
    let ingredients: string[] = [];
    let brands: string[] = [];
    try {
      const rxcui = (await getJson(`${RXNAV}/approximateTerm.json?term=${encodeURIComponent(key)}&maxEntries=1`))?.approximateGroup?.candidate?.[0]?.rxcui;
      if (rxcui) {
        const own = (await getJson(`${RXNAV}/rxcui/${rxcui}/properties.json`))?.properties;
        const related = await getJson(`${RXNAV}/rxcui/${rxcui}/related.json?tty=IN+MIN+BN`);
        ingredients = [...new Set([...(own?.tty === "IN" ? [String(own.name).toLowerCase()] : []), ...names(related, "IN")])];
        brands = [...new Set([...(own?.tty === "BN" ? [String(own.name).toLowerCase()] : []), ...names(related, "BN")])].slice(0, 10);
      }
    } catch (e) {
      console.error("RxNorm lookup failed", key, e);
    }
    const generic = ingredients[0] ?? key;
    let label: any = null;
    try {
      label = (await getJson(`${OPENFDA}?search=openfda.generic_name:"${encodeURIComponent(generic)}"&limit=1`))?.results?.[0] ?? null;
      if (!label) label = (await getJson(`${OPENFDA}?search=openfda.brand_name:"${encodeURIComponent(key)}"&limit=1`))?.results?.[0] ?? null;
    } catch (e) {
      console.error("openFDA lookup failed", key, e);
    }
    const sections = ["boxed_warning", "contraindications", "drug_interactions", "warnings", "do_not_use", "ask_doctor_or_pharmacist", "stop_use"];
    const text = label ? sections.flatMap((s) => label[s] ?? []).join("\n").slice(0, MAX_TEXT) : "";
    if (!ingredients.length && label?.openfda?.generic_name?.[0]) ingredients = String(label.openfda.generic_name[0]).toLowerCase().split(/\s+and\s+|,\s*/);
    await ctx.runMutation(internal.drugs.save, {
      key,
      found: !!label || ingredients.length > 0,
      ingredients,
      brands: [...new Set([...brands, ...(label?.openfda?.brand_name ?? []).map((b: string) => b.toLowerCase())])].slice(0, 10),
      classes: label?.openfda?.pharm_class_epc ?? [],
      interactions: text,
      boxedWarning: label?.boxed_warning?.[0]?.replace(/\s+/g, " ").slice(0, 600),
      medicationId,
    });
  },
});

export const save = internalMutation({
  args: {
    key: v.string(),
    found: v.boolean(),
    ingredients: v.array(v.string()),
    brands: v.array(v.string()),
    classes: v.array(v.string()),
    interactions: v.string(),
    boxedWarning: v.optional(v.string()),
    medicationId: v.optional(v.id("medications")),
  },
  handler: async (ctx, { medicationId, ...info }) => {
    const row = await infoFor(ctx, info.key);
    const doc = { ...info, fetchedAt: Date.now() };
    if (row) await ctx.db.replace(row._id, doc);
    else await ctx.db.insert("drugInfo", doc);
    if (medicationId) await ctx.scheduler.runAfter(0, internal.drugs.alert, { medicationId });
  },
});

// Says in chat, once per pair, any interaction that involves this medication.
export const alert = internalMutation({
  args: { medicationId: v.id("medications") },
  handler: async (ctx, { medicationId }) => {
    const med = await ctx.db.get(medicationId);
    if (!med || med.stoppedAt) return;
    const { meds, interactions } = await interactionsFor(ctx, med.userId);
    const pairOf = (i: { a: string; b: string }) => [i.a, i.b].sort().join("|");
    // Either medication's lookup can finish last, so a pair is marked said on both.
    const said = new Set(meds.flatMap((m) => m.med.interactionAlerts ?? []));
    const fresh = interactions.filter((i) => (i.a === med.name || i.b === med.name) && !said.has(pairOf(i)));
    if (!fresh.length) return;
    const lang = langOf(await ctx.db.get(med.userId));
    for (const i of fresh) {
      await insertMessage(ctx, { userId: med.userId, role: "assistant", channel: "app", text: t(lang, "interactionAlert", i.a, i.term, i.b, i.excerpt), urgent: false });
      for (const m of meds.filter((m) => m.name === i.a || m.name === i.b)) {
        const row = await ctx.db.get(m.med._id);
        await ctx.db.patch(m.med._id, { interactionAlerts: [...new Set([...(row?.interactionAlerts ?? []), pairOf(i)])] });
      }
    }
  },
});

// For the model's context, under the medication list (convex/reminders.ts medicationsText).
export async function interactionsText(ctx: QueryCtx, userId: Id<"users">): Promise<string> {
  const { interactions } = await interactionsFor(ctx, userId);
  return interactions.length
    ? `Possible interactions on the FDA labels (label wording, not a clinical judgement; suggest checking with a pharmacist, never stopping a drug):\n${interactions.map((i) => `- ${i.a} label mentions ${i.term} (${i.b}): "${i.excerpt}"`).join("\n")}`
    : "";
}

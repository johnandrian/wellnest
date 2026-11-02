// Health reports (convex/lib/report.ts): gathers one user's records for a date range and builds the HTML.
// The app prints it to PDF; share links (convex/share.ts) serve the same page read-only.
import { v } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";
import { query, QueryCtx } from "./_generated/server";
import { Id } from "./_generated/dataModel";
import { buildReport, ReportMed, Section, section } from "./lib/report";
import { isDate } from "./lib/health";
import { langOf } from "./lib/language";
import { describeSchedule } from "./lib/reminders";
import { statusOf } from "./lib/meds";
import { painAsEntries } from "./lib/trackers";
import { dailySince } from "./journal";
import { trackersSince } from "./trackers";
import { adherence } from "./exercises";
import { visitsText } from "./visits";
import { emergencyData } from "./emergency";

const DAY_MS = 86_400_000;
const TITLES = { en: "Health report", es: "Informe de salud", el: "Αναφορά υγείας" } as const;

async function medsFor(ctx: QueryCtx, userId: Id<"users">, fromMs: number, toMs: number): Promise<ReportMed[]> {
  const meds = (await ctx.db.query("medications").withIndex("by_user_and_active", (q) => q.eq("userId", userId)).take(100)).filter(
    (m) => m._creationTime <= toMs + DAY_MS && (!m.stoppedAt || m.stoppedAt >= fromMs),
  );
  const out: ReportMed[] = [];
  for (const m of meds) {
    const logs = await ctx.db
      .query("doseLogs")
      .withIndex("by_medication_and_due", (q) => q.eq("medicationId", m._id).gte("dueAt", fromMs).lte("dueAt", toMs + DAY_MS))
      .take(1000);
    const events = await ctx.db.query("medicationEvents").withIndex("by_medication", (q) => q.eq("medicationId", m._id)).take(50);
    const effects = await ctx.db.query("sideEffects").withIndex("by_medication", (q) => q.eq("medicationId", m._id)).take(50);
    const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);
    out.push({
      name: m.name,
      dose: [m.dose, ...(m.timeDoses ?? []).map((t) => `${t.time}: ${t.dose}`)].filter(Boolean).join("; ") || undefined,
      genericName: m.genericName,
      form: m.form,
      schedule: describeSchedule(m.schedule),
      status: statusOf(m),
      prescriber: m.prescriber,
      adherence: logs.length ? { taken: logs.filter((l) => l.status === "taken").length, total: logs.length } : undefined,
      sideEffects: effects.map((e) => `${e.date} ${e.effect}${e.severity !== undefined ? ` (${e.severity}/10)` : ""}`),
      changes: events.filter((e) => e.kind !== "started").map((e) => `${day(e.at)} ${e.kind.replace("_", " ")}${e.note ? ` ${e.note}` : ""}`),
    });
  }
  return out;
}

// Everything the report shows. `generated` is a display string from the caller (queries can't read the clock).
export async function gather(ctx: QueryCtx, userId: Id<"users">, from: string, to: string, sections: Section[], generated: string) {
  const user = await ctx.db.get(userId);
  const fromMs = Date.parse(`${from}T00:00:00Z`);
  const toMs = Date.parse(`${to}T23:59:59Z`);
  const want = (s: Section) => sections.includes(s);
  const trackers = want("trackers") || want("journal") ? await trackersSince(ctx, userId, from).then((t) => t.filter((e) => e.date <= to)) : [];
  const entries = want("journal")
    ? [
        ...(await ctx.db.query("symptomEntries").withIndex("by_user_and_date", (q) => q.eq("userId", userId).gte("date", from).lte("date", to)).take(1000)).map(
          ({ date, symptom, severity, note }) => ({ date, symptom, severity, note }),
        ),
        ...painAsEntries(trackers),
      ]
    : [];
  const health =
    want("health") || want("journal")
      ? (await ctx.db.query("healthDays").withIndex("by_user_and_date", (q) => q.eq("userId", userId).gte("date", from).lte("date", to)).take(400)).map(
          ({ date, metrics }) => ({ date, metrics }),
        )
      : [];
  return {
    title: TITLES[langOf(user)] as string,
    person: user?.name ?? user?.email ?? null,
    from,
    to,
    generated,
    lang: langOf(user),
    sections,
    facts: want("facts") ? (await ctx.db.query("memoryFacts").withIndex("by_user", (q) => q.eq("userId", userId)).take(50)).map((f) => f.text) : [],
    meds: want("medications") ? await medsFor(ctx, userId, fromMs, toMs) : [],
    entries,
    daily: want("journal") ? (await dailySince(ctx, userId, from)).filter((d) => d.date <= to) : [],
    trackers: want("trackers") ? trackers : [],
    peakFlowBest: user?.peakFlowBest,
    exercises: want("exercises") ? (await adherence(ctx, userId, from, to)).text : "",
    health: want("health") ? health : [],
    appointments: want("appointments") ? await visitsText(ctx, userId, fromMs, toMs + 60 * DAY_MS, user?.timeZone ?? "UTC") : "",
    team: want("appointments")
      ? (await ctx.db.query("careTeam").withIndex("by_user", (q) => q.eq("userId", userId)).take(50)).map(({ name, role, clinic, phone, email }) => ({ name, role, clinic, phone, email }))
      : [],
    emergency: want("emergency") ? await emergencyData(ctx, userId) : null,
  };
}

export const MAX_DAYS = 366;

export function checkRange(from: string, to: string) {
  if (!isDate(from) || !isDate(to) || from > to) throw new Error("Pick a start date before the end date.");
  if ((Date.parse(to) - Date.parse(from)) / DAY_MS > MAX_DAYS) throw new Error("Reports cover up to a year.");
}

export const html = query({
  args: { from: v.string(), to: v.string(), sections: v.array(section), generated: v.string() },
  handler: async (ctx, { from, to, sections, generated }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not signed in");
    checkRange(from, to);
    if (!sections.length) throw new Error("Pick at least one section.");
    return buildReport(await gather(ctx, userId, from, to, sections, generated.slice(0, 40)));
  },
});

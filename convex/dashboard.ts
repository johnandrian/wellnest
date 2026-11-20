// The Health tools home (src/HomePanel.tsx): four weeks of charts for what the user tracks, picked by their setup
// focus and what they've logged, plus what's next (a dose, an appointment), this week's logging and doses, and the
// days moved in the last four weeks.
import { v } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";
import { query, QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { ChartMetric, chartMarks, chartSeries, dateList, shiftDate } from "./lib/insights";
import { chartName } from "./lib/insightsText";
import { isDate } from "./lib/health";
import { Lang, langOf } from "./lib/language";
import { daysLeft } from "./lib/meds";
import { dueTimes, isTimed } from "./lib/reminders";
import { unitsOf } from "./lib/units";
import { gatherInputs, medChanges } from "./insights";
import { scheduledOn } from "./exercises";
import { profileMissing } from "./onboarding";

const DAYS = 28;
const MAX_CHARTS = 4;
const WEEK_MS = 7 * 86_400_000;
// A dose counts as overdue once it's an hour past due and unanswered, for the 12 hours after (the Today list's window).
const LATE_MS = 60 * 60_000;
const OVERDUE_WINDOW_MS = 12 * 60 * 60_000;

// What to chart first for each setup focus; the rest fill in from whatever has data.
const BY_FOCUS: Record<string, ChartMetric[]> = {
  pain: ["pain"],
  asthma: ["peakFlow", "reliever"],
  seizures: ["seizures"],
  diabetes: ["glucose", "weightKg"],
  symptoms: ["symptom"],
  mood: ["mood", "sleepQuality"],
  wellness: ["steps", "sleepHours"],
};
const FALLBACK: ChartMetric[] = ["symptom", "pain", "glucose", "mood", "sleepHours", "energy", "steps", "peakFlow", "seizures", "bp", "weightKg", "bodyTemp", "restingHeartRate", "sleepQuality"];

const avg = (xs: number[]) => (xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10 : null);

// Up to four 28-day trend charts for someone, in `lang` (the viewer's language: the user, or a Care Circle member)
// and in that person's own units. Also returns what was gathered, for the dashboard's other cards.
export async function trendCharts(ctx: QueryCtx, user: Doc<"users">, today: string, lang: Lang) {
  const units = unitsOf(user);
  const from = shiftDate(today, -(DAYS - 1));
  const dates = dateList(from, today);
  const input = await gatherInputs(ctx, user._id, from, today);

  // The most-rated symptom stands in for "symptom".
  const counts = new Map<string, number>();
  for (const e of input.entries) if (e.severity !== undefined) counts.set(e.symptom, (counts.get(e.symptom) ?? 0) + 1);
  const topSymptom = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];

  // Medication starts and dose changes, marked on every chart.
  const marks = chartMarks(await medChanges(ctx, user._id, from), from, today);
  const order = [...new Set([...(user.focus ?? []).flatMap((f) => BY_FOCUS[f] ?? []), ...FALLBACK])];
  const weekStart = shiftDate(today, -6);
  const prevStart = shiftDate(today, -13);
  const charts = [];
  for (const metric of order) {
    if (charts.length >= MAX_CHARTS) break;
    if (metric === "symptom" && !topSymptom) continue;
    const series = chartSeries(input, metric, dates, topSymptom, units);
    if (!series.points.length) continue;
    const week = series.points.filter((p) => p.date >= weekStart).map((p) => p.value);
    const prev = series.points.filter((p) => p.date >= prevStart && p.date < weekStart).map((p) => p.value);
    // Glucose in mg/dL reads as a whole number, like the readings themselves.
    const whole = (n: number | null) => (n !== null && metric === "glucose" && units.glucose === "mg/dL" ? Math.round(n) : n);
    charts.push({
      metric,
      ...chartName(metric, lang, topSymptom, units),
      from,
      to: today,
      ...series,
      meds: marks,
      latest: series.points[series.points.length - 1],
      week: whole(avg(week)),
      prevWeek: week.length >= 2 && prev.length >= 2 ? whole(avg(prev)) : null,
    });
  }
  return { charts, input, weekStart };
}

// Active medications, the ones running low on supply, and how many doses are over an hour past due and unanswered
// (for the dashboard and the notifications bell).
async function medAlerts(ctx: QueryCtx, userId: Id<"users">, now: number) {
  const meds = await ctx.db
    .query("medications")
    .withIndex("by_user_and_active", (q) => q.eq("userId", userId).eq("active", true))
    .take(50);
  const lowSupply = meds.filter((m) => {
    const left = daysLeft(m.schedule, m.supply);
    return left !== null && left <= (m.supply?.warnDays ?? 7);
  });
  const recent = await ctx.db
    .query("doseLogs")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .order("desc")
    .take(300);
  let overdue = 0;
  for (const m of meds) {
    if (m.pausedAt || !isTimed(m.schedule)) continue;
    const from = Math.max(now - OVERDUE_WINDOW_MS, m._creationTime);
    const due = dueTimes(m.schedule, from, now - LATE_MS, m.timeZone, m.utcOffsetMin, 24);
    if (!due.length) continue;
    const answered = new Set(recent.filter((d) => d.medicationId === m._id).map((d) => d.dueAt));
    overdue += due.filter((at) => !answered.has(at)).length;
  }
  return { meds, lowSupply, overdue };
}

// The notifications bell (src/NotificationsButton.tsx): actions waiting for an OK, doses past due, and refills
// running low.
export const alerts = query({
  args: { now: v.number() },
  handler: async (ctx, { now }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;
    const actions = await ctx.db
      .query("agentActions")
      .withIndex("by_user_and_status", (q) => q.eq("userId", userId).eq("status", "proposed"))
      .take(20);
    const { lowSupply, overdue } = await medAlerts(ctx, userId, now);
    return {
      actions: actions.map((a) => ({ _id: a._id, title: a.title, urgent: a.urgent })),
      overdue,
      lowSupply: lowSupply.map((m) => m.name),
    };
  },
});

export const view = query({
  // The phone's local date and clock (queries can't read the clock).
  args: { today: v.string(), now: v.number() },
  handler: async (ctx, { today, now }) => {
    const userId = await getAuthUserId(ctx);
    const user = userId ? await ctx.db.get(userId) : null;
    if (!user || !isDate(today)) return null;
    const { charts, input, weekStart } = await trendCharts(ctx, user, today, langOf(user));

    // Days this week with anything in the journal.
    const logged = new Set(
      [...input.entries, ...input.trackers, ...input.daily].map((x) => x.date).filter((d) => d >= weekStart),
    ).size;

    const { meds, lowSupply, overdue } = await medAlerts(ctx, user._id, now);
    const next = meds
      .filter((m) => m.nextAt && !m.pausedAt)
      .sort((a, b) => a.nextAt! - b.nextAt!)[0];
    const doses = (await ctx.db.query("doseLogs").withIndex("by_user", (q) => q.eq("userId", user._id)).order("desc").take(300)).filter(
      (d) => d.dueAt >= now - WEEK_MS && d.dueAt <= now,
    );

    // The movement card's streak: days in the last 4 weeks with an exercise done, and today's exercises.
    const exLogs = await ctx.db
      .query("exerciseLogs")
      .withIndex("by_user_and_date", (q) => q.eq("userId", user._id).gte("date", shiftDate(today, -(DAYS - 1))).lte("date", today))
      .take(1000);
    const exercises = await ctx.db
      .query("exercises")
      .withIndex("by_user_and_active", (q) => q.eq("userId", user._id).eq("active", true))
      .take(30);
    const dueToday = exercises.filter((e) => scheduledOn(e, today));
    const doneToday = new Set(exLogs.filter((l) => l.date === today).map((l) => l.exerciseId));

    const visit = (
      await ctx.db
        .query("visits")
        .withIndex("by_user_and_start", (q) => q.eq("userId", user._id).gte("startsAt", now))
        .take(10)
    ).find((r) => r.status === "upcoming");

    return {
      name: user.profile?.name ?? null,
      // The parts of setup still to do, for the "Finish your profile" card.
      finishProfile: await profileMissing(ctx, user),
      charts,
      logged,
      meds: {
        count: meds.length,
        next: next ? { name: next.name, at: next.nextAt! } : null,
        taken: doses.filter((d) => d.status === "taken").length,
        answered: doses.length,
        lowSupply: lowSupply.length,
        overdue,
      },
      move: {
        from: shiftDate(today, -(DAYS - 1)),
        days: [...new Set(exLogs.map((l) => l.date))].sort(),
        exercises: exercises.length,
        dueToday: dueToday.length,
        doneToday: dueToday.filter((e) => doneToday.has(e._id)).length,
      },
      // With its suggested questions (convex/questions.ts), shown on the dashboard in the week before.
      visit: visit ? { _id: visit._id, title: visit.title, startsAt: visit.startsAt, kind: visit.kind, questions: visit.questions ?? [] } : null,
    };
  },
});

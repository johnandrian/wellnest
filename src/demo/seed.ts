// The example dashboard's made-up person, Alex, who has rheumatoid arthritis: the welcome page's first story
// (src/landing.ts STORIES[0]). Four weeks of joint pain that flares on the days the air pressure drops and eases after
// the methotrexate dose goes up, with the check-ins, doses, exercises, appointments, records, and plans around it.
// Rows go straight into the in-memory database (./db.ts) in the shape of convex/schema.ts; the app's own queries then
// work out the charts, patterns, and summaries from them, as they would for a real account.
import { dueTimes, nextDue, type Schedule } from "../../convex/lib/reminders";
import { drugKey } from "../../convex/lib/drugs";
import { testKey } from "../../convex/lib/records";
import { STORIES } from "../landing";
import type { Lang } from "../i18n";
import { DEMO_CONTENT } from "./content";
import type { MemoryDb } from "./db";

const DAYS = 28;
const DAY = 86_400_000;
const HOUR = 3_600_000;

// The same numbers on every visit: a small seeded generator, not Math.random.
function seeded(seed: number) {
  let x = seed;
  return () => {
    x = (x * 1103515245 + 12345) % 2147483648;
    return x / 2147483648;
  };
}

const pad = (n: number) => String(n).padStart(2, "0");
const isoDate = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const clamp = (lo: number, hi: number, x: number) => Math.max(lo, Math.min(hi, Math.round(x)));
// A local time on a day `daysFromToday` away.
function at(now: number, daysFromToday: number, hh: number, mm = 0) {
  const d = new Date(now + daysFromToday * DAY);
  d.setHours(hh, mm, 0, 0);
  return d.getTime();
}

export function seedDemo(db: MemoryDb, now: number, lang: Lang): string {
  const c = DEMO_CONTENT[lang];
  const rand = seeded(7);
  const story = STORIES[0];
  const pain = story.values.slice(-DAYS);
  // dates[i] is i days after four weeks ago; dates[27] is today, dates[28..30] the next three days (forecast).
  const dates = Array.from({ length: DAYS + 3 }, (_, i) => isoDate(new Date(now - (DAYS - 1 - i) * DAY)));
  const dayAt = (i: number, hh: number, mm = 0) => at(now, i - (DAYS - 1), hh, mm);
  // Two days without any answer, as in real life.
  const skip = (i: number) => i === 5 || i === 16;
  const flare = (i: number) => pain[i] >= 7;
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  const utcOffsetMin = -new Date(now).getTimezoneOffset();
  const longAgo = now - 400 * DAY;
  const metric = lang !== "en";

  const userId = db.seed(
    "users",
    {
      name: c.name,
      email: "alex@example.com",
      profile: { name: c.name, ageRange: "30_44", sex: "unspecified" },
      focus: ["pain", "medications", "mood"],
      language: lang,
      units: metric ? { glucose: "mmol/L", weight: "kg", temperature: "C" } : { glucose: "mg/dL", weight: "lb", temperature: "F" },
      location: c.location,
      locationPoint: { lat: 45.5152, lon: -122.6784, for: c.location, place: c.place, country: "US" },
      timeZone,
      utcOffsetMin,
      onboardedAt: longAgo,
      profileDoneAt: longAgo,
      touredAt: longAgo,
    },
    longAgo,
  );
  const member = db.seed("users", { name: c.circle.member, email: "jordan@example.com", profile: { name: c.circle.member }, language: lang, timeZone, utcOffsetMin }, longAgo);

  // ---------- Journal: the pain tracker, two symptoms, and the daily check-in ----------

  for (let i = 0; i < DAYS; i++) {
    if (skip(i)) continue;
    const date = dates[i];
    db.seed(
      "trackerEntries",
      {
        userId,
        date,
        at: dayAt(i, 9, 15),
        tracker: "pain",
        pain: {
          severity: pain[i],
          locations: flare(i) ? ["left_hand", "right_hand", "left_leg", "right_leg"] : ["left_hand", "right_hand"],
          types: flare(i) ? ["aching", "throbbing"] : ["aching"],
          flare: flare(i) || undefined,
          swelling: flare(i) || undefined,
          ...(i === DAYS - 8 && { triggers: c.painNote, helped: c.painHelped }),
        },
        ...(flare(i) && i > DAYS - 10 && { note: c.painNote }),
        source: "manual",
      },
      dayAt(i, 9, 15),
    );
    // Stiff mornings most days, worse on flare days; fatigue on the worst days.
    if (i % 4 !== 2) {
      db.seed("symptomEntries", { userId, date, symptom: c.stiffness, severity: clamp(1, 10, pain[i] - 1 + (rand() - 0.5) * 2), time: "08:00", source: "manual" }, dayAt(i, 8, 5));
    }
    if (flare(i)) db.seed("symptomEntries", { userId, date, symptom: c.fatigue, severity: clamp(1, 10, pain[i] - 1), source: "manual" }, dayAt(i, 19, 30));
  }

  // A flare costs some sleep, and mood and energy dip with pain. Today: mood and sleep so far.
  for (let i = 0; i < DAYS; i++) {
    if (skip(i)) continue;
    // Loosely, so joint pain and the air pressure stay the clearest pattern, as in the story.
    const sleepQuality = clamp(1, 5, 3.9 - (pain[i] - 4) / 6 + (rand() - 0.5) * 2.4);
    const mood = clamp(1, 5, 3.6 - (pain[i] - 4) / 4 + (rand() - 0.5) * 2.2);
    const energy = clamp(1, 5, 3.4 - (pain[i] - 4) / 4 + (rand() - 0.5) * 2.2);
    const today = i === DAYS - 1;
    db.seed(
      "dailyLogs",
      {
        userId,
        date: dates[i],
        mood: today ? 4 : mood,
        sleepQuality: today ? 3 : sleepQuality,
        ...(!today && { energy }),
        ...(!today && { foods: i % 3 === 0 ? ["dairy"] : i % 5 === 0 ? ["late_meal"] : [], caffeine: 1 + (i % 2) }),
        source: "card",
      },
      dayAt(i, 21),
    );
  }

  // Vitals now and then.
  for (const i of [2, 9, 16, 23]) {
    db.seed("trackerEntries", { userId, date: dates[i], at: dayAt(i, 7, 30), tracker: "weight", weight: { kg: 68.4 - i * 0.03 + (rand() - 0.5) * 0.4 }, source: "manual" }, dayAt(i, 7, 30));
  }
  for (const i of [4, 13, 22]) {
    db.seed("trackerEntries", { userId, date: dates[i], at: dayAt(i, 7, 40), tracker: "bp", bp: { systolic: 118 + Math.round(rand() * 8), diastolic: 76 + Math.round(rand() * 5), pulse: 68 + Math.round(rand() * 8) }, source: "manual" }, dayAt(i, 7, 40));
  }

  // ---------- Weather: the air pressure drops on the marked days, and again tomorrow ----------

  const RAIN = [1, 3, 7, 12, 18, 20, 24, 29];
  let pressure = 1018;
  for (let i = 0; i < DAYS + 3; i++) {
    const drop = story.marked.includes(i) || i === DAYS;
    // A drop is 3 hPa or more on the day before (convex/lib/insights.ts); other days drift by less.
    pressure = drop ? pressure - 7 : Math.min(1024, pressure + (pressure < 1014 ? 4 : (rand() - 0.5) * 2.4));
    db.seed(
      "weatherDays",
      {
        userId,
        date: dates[i],
        tempMax: Math.round(19 + (rand() - 0.5) * 4 - (drop ? 3 : 0)),
        tempMin: Math.round(11 + (rand() - 0.5) * 3),
        humidity: Math.round(60 + rand() * 25),
        pressure: Math.round(pressure * 10) / 10,
        // Rain on some days of each kind, so it's the pressure, not the rain, that goes with the flares.
        precip: RAIN.includes(i) ? 4 + Math.round(rand() * 8) : 0,
        aqi: Math.round(30 + rand() * 15),
      },
      dayAt(Math.min(i, DAYS - 1), 6),
    );
  }

  // ---------- Medications, with four weeks of doses ----------

  const started = now - 120 * DAY;
  // Methotrexate is weekly, two days from today, so it shows as coming up.
  const mtxDay = (new Date(now).getDay() + 2) % 7;
  const meds: { key: keyof typeof c.meds; dose: string; schedule: Schedule; directions?: string; supply: { left: number; perDose: number; warnDays: number } }[] = [
    { key: "mtx", dose: "20 mg", schedule: { kind: "daily", times: ["20:00"], weekdays: [mtxDay] }, directions: c.weekly, supply: { left: 32, perDose: 8, warnDays: 7 } },
    { key: "folic", dose: "1 mg", schedule: { kind: "daily", times: ["08:00"] }, supply: { left: 64, perDose: 1, warnDays: 7 } },
    // Running low, for the refill reminder.
    { key: "hcq", dose: "200 mg", schedule: { kind: "daily", times: ["08:00", "20:00"] }, directions: c.withFood, supply: { left: 7, perDose: 1, warnDays: 7 } },
    { key: "ibu", dose: "400 mg", schedule: { kind: "asNeeded" }, directions: c.withFood, supply: { left: 40, perDose: 1, warnDays: 5 } },
  ];
  const medIds: Record<string, string> = {};
  for (const m of meds) {
    const name = c.meds[m.key];
    const id = db.seed(
      "medications",
      {
        userId,
        name,
        dose: m.dose,
        schedule: m.schedule,
        timeZone,
        utcOffsetMin,
        active: true,
        ...(m.schedule.kind !== "asNeeded" && { nextAt: nextDue(m.schedule, now, timeZone, utcOffsetMin) }),
        form: "tablet",
        prescriber: c.team.rheum,
        directions: m.directions,
        supply: m.supply,
      },
      started,
    );
    medIds[m.key] = id;
    db.seed("medicationEvents", { userId, medicationId: id, kind: "started", at: started }, started);
    // Answers to every reminder in the last four weeks, a few skipped; doses due in the last hour wait for an answer.
    if (m.schedule.kind === "asNeeded") continue;
    for (const due of dueTimes(m.schedule, now - DAYS * DAY, now - HOUR, timeZone, utcOffsetMin)) {
      const missed = rand() < 0.05;
      db.seed("doseLogs", { userId, medicationId: id, dueAt: due, status: missed ? "skipped" : "taken", ...(!missed && { takenAt: due + Math.round(rand() * 40) * 60_000 }) }, due);
    }
  }
  // The dose change two weeks ago, marked on every chart.
  db.seed("medicationEvents", { userId, medicationId: medIds.mtx, kind: "dose_changed", at: dayAt(story.med, 11), note: c.doseChange }, dayAt(story.med, 11));
  // Ibuprofen on flare days.
  for (let i = 0; i < DAYS; i++) {
    if (!flare(i) || skip(i)) continue;
    const t = dayAt(i, 13, 10);
    db.seed("doseLogs", { userId, medicationId: medIds.ibu, dueAt: t, status: "taken", takenAt: t }, t);
  }
  db.seed("sideEffects", { userId, medicationId: medIds.mtx, date: dates[story.med + 1], effect: c.nausea, severity: 3 }, dayAt(story.med + 1, 9));
  db.seed("sideEffects", { userId, medicationId: medIds.mtx, date: dates[story.med + 8], effect: c.nausea, severity: 2 }, dayAt(story.med + 8, 9));

  // What the medication safety check knows (convex/drugs.ts), so it doesn't need the internet.
  const looked = now - DAY;
  const info = (name: string, classes: string[], interactions: string, boxedWarning?: string) =>
    db.seed("drugInfo", { key: drugKey(name), found: true, ingredients: [drugKey(name)], brands: [], classes, interactions, ...(boxedWarning && { boxedWarning }), fetchedAt: looked }, looked);
  info(
    c.meds.mtx,
    ["Folate Analog Metabolic Inhibitor"],
    "Nonsteroidal anti-inflammatory drugs (NSAIDs) such as ibuprofen may raise methotrexate levels in the blood.",
    "Methotrexate can cause serious side effects. Take it once a week, not every day, and have regular blood tests.",
  );
  info(c.meds.folic, ["Vitamin"], "");
  info(c.meds.hcq, ["Antimalarial"], "");
  info(c.meds.ibu, ["Nonsteroidal Anti-inflammatory Drug"], "Ibuprofen may raise methotrexate levels.");

  // ---------- Exercises ----------

  const exercises: { name: string; minutes?: number; sets?: number; reps?: number; days: number[]; notes?: string; rate: number }[] = [
    { name: c.exercises.hands, minutes: 10, days: [], notes: c.exercises.handsNotes, rate: 0.85 },
    { name: c.exercises.walk, minutes: 20, days: [1, 3, 5], rate: 0.7 },
    { name: c.exercises.knees, sets: 2, reps: 10, days: [2, 4, 6], rate: 0.6 },
  ];
  for (const { rate, ...e } of exercises) {
    const id = db.seed("exercises", { userId, ...e, active: true }, started);
    for (let i = 0; i < DAYS - 1; i++) {
      const weekday = new Date(`${dates[i]}T12:00:00`).getDay();
      if ((e.days.length && !e.days.includes(weekday)) || flare(i) || rand() > rate) continue;
      db.seed("exerciseLogs", { userId, exerciseId: id, date: dates[i] }, dayAt(i, 18));
    }
  }

  // ---------- Care team and appointments ----------

  const rheum = db.seed("careTeam", { userId, name: c.team.rheum, role: c.roles.rheum, phone: "+1 503 555 0199", clinic: c.team.clinic }, started);
  const pt = db.seed("careTeam", { userId, name: c.team.pt, role: c.roles.pt, phone: "+1 503 555 0174", clinic: c.team.ptClinic }, started);
  const pcp = db.seed("careTeam", { userId, name: c.team.pcp, role: c.roles.pcp, phone: "+1 503 555 0123", clinic: c.team.pcpClinic }, started);
  const visit = (title: string, startsAt: number, clinicianId: string, extra: Record<string, unknown>) =>
    db.seed("visits", { userId, title, kind: "in_person", startsAt, clinicianId, ...extra }, Math.min(startsAt, now) - 7 * DAY);
  visit(c.visits.rheum, at(now, 3, 10, 30), rheum, { status: "upcoming", location: c.team.clinic, questions: c.questions, checked: [] });
  visit(c.visits.pt, at(now, 9, 16), pt, { status: "upcoming", location: c.team.ptClinic, prep: c.visits.ptPrep });
  const pastRheum = visit(c.visits.rheum, dayAt(story.med, 10, 30), rheum, { status: "done", location: c.team.clinic, notes: c.visits.rheumNotes });
  visit(c.visits.labs, at(now, -1, 8, 15), rheum, { status: "done", notes: c.visits.labsNotes });
  visit(c.visits.physical, at(now, -60, 9), pcp, { status: "done", notes: c.visits.physicalNotes });

  // ---------- Records: two blood tests and the letter about the dose change ----------

  const labs = (date: string, createdAt: number, summary: string, values: { crp: number; esr: number; alt: number; wbc: number }) => {
    const recordId = db.seed("records", { userId, status: "done", fileType: "pdf", kind: "lab", title: c.records.labs, date, source: c.records.lab, summary }, createdAt);
    const row = (test: string, value: number, unit: string, low: number, high: number, explanation: string) =>
      db.seed(
        "labResults",
        { userId, recordId, date, test, key: testKey(test), value, unit, low, high, flag: value < low ? "low" : value > high ? "high" : "normal", explanation },
        createdAt,
      );
    row("C-reactive protein (CRP)", values.crp, "mg/L", 0, 10, c.labs.crp);
    row("Erythrocyte sedimentation rate (ESR)", values.esr, "mm/h", 0, 20, c.labs.esr);
    row("Alanine aminotransferase (ALT)", values.alt, "U/L", 7, 56, c.labs.alt);
    row("White blood cell count", values.wbc, "K/uL", 4, 11, c.labs.wbc);
  };
  labs(isoDate(new Date(now - 70 * DAY)), now - 70 * DAY, c.records.summaryOld, { crp: 21, esr: 34, alt: 24, wbc: 7.2 });
  labs(isoDate(new Date(now - 30 * DAY)), now - 30 * DAY, c.records.summaryOld, { crp: 16, esr: 29, alt: 27, wbc: 6.8 });
  labs(dates[DAYS - 2], dayAt(DAYS - 2, 15), c.records.summaryNew, { crp: 7, esr: 18, alt: 31, wbc: 6.1 });
  db.seed("records", { userId, status: "done", fileType: "pdf", kind: "letter", title: c.records.letter, date: dates[story.med], source: c.team.clinic, summary: c.records.letterSummary }, dayAt(story.med, 16));

  // ---------- Sharing: a ready visit summary and a link for the rheumatologist ----------

  db.seed("visitSummaries", { userId, reason: c.visits.rheum, days: 30, status: "ready", text: c.visitSummary, visitId: pastRheum }, dayAt(story.med - 1, 18));
  db.seed(
    "shareLinks",
    { userId, token: "demo-example-share-link-0000", label: c.share, sections: ["medications", "journal", "trackers", "appointments"], rangeDays: 30, opens: 2, lastOpenedAt: now - DAY },
    now - 10 * DAY,
  );

  // ---------- Care: the emergency plan and the Care Circle ----------

  db.seed(
    "emergencyPlans",
    {
      userId,
      sections: [
        { title: c.emergency.flare, steps: c.emergency.flareSteps },
        { title: c.emergency.meds, steps: c.emergency.medsSteps },
      ],
      contacts: [
        { name: c.circle.member, relation: c.emergency.partner, phone: "+1 503 555 0142" },
        { name: c.team.rheum, relation: c.emergency.doctor, phone: "+1 503 555 0199" },
      ],
      notes: c.emergency.notes,
    },
    started,
  );
  db.seed("circleMembers", { ownerId: userId, memberId: member, label: c.emergency.partner, alerts: { missedDoses: true, forecast: true, urgent: true, quiet: false } }, now - 40 * DAY);
  db.seed("circleInvites", { ownerId: userId, token: "demo-example-invite-0000", label: c.circle.invite, alerts: { missedDoses: true, forecast: false, urgent: true, quiet: true }, expiresAt: now + 5 * DAY }, now - 2 * DAY);

  // ---------- Actions: one waiting for an OK, one done ----------

  const onDrop = story.marked.filter((i) => !skip(i)).map((i) => pain[i]);
  const offDrop = pain.filter((_, i) => !skip(i) && !story.marked.includes(i));
  const avg = (xs: number[]) => (Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10).toLocaleString(lang);
  db.seed(
    "agentActions",
    {
      userId,
      status: "proposed",
      title: c.agent.title,
      reason: c.agent.reason,
      evidence: [
        { label: c.agent.pain, value: `${avg(onDrop)}/10` },
        { label: c.agent.pressure, value: `${avg(offDrop)}/10` },
      ],
      details: { kind: "message_doctor", to: c.team.rheum, subject: c.agent.subject, body: c.agent.body },
      urgent: false,
    },
    now - 3 * HOUR,
  );
  db.seed(
    "agentActions",
    {
      userId,
      status: "done",
      title: c.agent.doneTitle,
      reason: c.agent.doneReason,
      evidence: [],
      details: { kind: "set_reminder", text: c.agent.doneTitle, at: dayAt(story.med + 2, 9) },
      urgent: false,
      result: c.agent.doneResult,
      decidedAt: dayAt(story.med + 1, 12),
    },
    dayAt(story.med + 1, 9),
  );

  // ---------- What Wellnest knows ----------

  for (const text of c.facts) db.seed("memoryFacts", { userId, text, source: "user" }, longAgo);

  return userId;
}

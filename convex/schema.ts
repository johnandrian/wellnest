import { defineSchema, defineTable } from "convex/server";
import { authTables } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { units } from "./lib/units";
import { healthMetrics, healthSource } from "./lib/health";
import { schedule } from "./lib/reminders";
import { language } from "./lib/language";
import { entrySource } from "./lib/journal";
import { slot, urgency as visitUrgency } from "./lib/telehealth";
import { medEventKind, medForm, supply, timeDose } from "./lib/meds";
import { asthmaDetails, glucoseDetails, painDetails, seizureDetails, tracker } from "./lib/trackers";
import { section } from "./lib/report";
import { asthmaPlan, contact, planSection } from "./lib/emergency";
import { chartValidator } from "./lib/insights";
import { focus, profile } from "./lib/onboarding";
import { appearance } from "./lib/appearance";
import { labFlag, recordKind } from "./lib/records";
import { circleAlerts } from "./lib/circle";

// jina-embeddings-v3 default output size.
export const EMBEDDING_DIMS = 1024;

export const channel = v.union(v.literal("app"), v.literal("telegram"));
export const role = v.union(v.literal("user"), v.literal("assistant"));

// Form fields of the CREAO symptom analyzer agent (creao/config.yaml).
export const creaoInputs = v.object({
  symptoms: v.string(),
  symptom_duration: v.optional(v.string()),
  age: v.optional(v.number()),
  sex: v.optional(v.union(v.literal("female"), v.literal("male"), v.literal("other"), v.literal("unspecified"))),
  chronic_conditions: v.optional(v.string()),
  biosensor_data: v.optional(v.string()),
  cycle_data: v.optional(v.string()),
  last_period_start: v.optional(v.string()),
});

// "starting" is ours (before CREAO accepts the run); the rest are CREAO's run states.
export const creaoRunStatus = v.union(
  v.literal("starting"),
  v.literal("pending"),
  v.literal("running"),
  v.literal("completed"),
  v.literal("failed"),
  v.literal("cancelled"),
);

// Health Supply Shopper (convex/shop.ts).
export const urgency = v.union(v.literal("asap"), v.literal("today"), v.literal("standard"));
const cartLine = v.object({
  itemKey: v.string(),
  itemLabel: v.string(),
  sku: v.string(),
  productName: v.string(),
  qty: v.number(),
  unitPriceCents: v.number(),
  merchantId: v.string(),
});
// Legacy: a cart priced by the removed headless browser service.
export const realStore = v.object({
  store: v.string(),
  storeName: v.string(),
  canFillCart: v.boolean(),
  products: v.array(v.object({ sku: v.string(), id: v.string(), url: v.string(), title: v.string() })),
});
const cartMerchant = v.object({
  merchantId: v.string(),
  name: v.string(),
  deliveryFeeCents: v.number(),
  deliveryMinutes: v.number(),
});

export default defineSchema({
  ...authTables,
  // Override Convex Auth's users table to add our own fields.
  users: defineTable({
    name: v.optional(v.string()),
    image: v.optional(v.string()),
    email: v.optional(v.string()),
    emailVerificationTime: v.optional(v.number()),
    phone: v.optional(v.string()),
    phoneVerificationTime: v.optional(v.number()),
    isAnonymous: v.optional(v.boolean()),
    telegramChatId: v.optional(v.string()),
    voiceMode: v.optional(v.boolean()), // legacy: the removed voice mode switch; the mic is always on now
    // Free text ("Berkeley, CA 94704") or "lat,lon" from a shared Telegram location.
    location: v.optional(v.string()),
    // Asthma: the personal best peak flow (L/min) readings are compared with (convex/trackers.ts).
    peakFlowBest: v.optional(v.number()),
    // Coordinates of `location`, geocoded once for finding care nearby (convex/care.ts).
    // `place`: a short name for it ("Berkeley, California") shown with the weather; "" when the map has none.
    locationPoint: v.optional(v.object({ lat: v.number(), lon: v.number(), for: v.string(), place: v.optional(v.string()) })),
    // Routing state (convex/pipeline.ts): an analysis offer waiting for a yes.
    analysisOfferedAt: v.optional(v.number()),
    // "Clear chat": messages before this time are hidden and left out of the model's context and memory.
    // They aren't deleted, so the daily message limit still counts them.
    chatClearedAt: v.optional(v.number()),
    // The chat new messages go into (convex/chats.ts); unset until they start a second chat.
    chatId: v.optional(v.id("chats")),
    // Light or dark (or follow the phone) and text size, from Settings → Appearance; the system look at 100% when unset.
    appearance: v.optional(appearance),
    // Reply and voice language (convex/lib/language.ts); English when unset.
    language: v.optional(language),
    // Units shown for glucose and weight (convex/lib/units.ts); mg/dL and lb when unset.
    units: v.optional(units),
    // Proactive check-ins from Apple Health changes (convex/checkins.ts); on when unset.
    checkins: v.optional(v.boolean()),
    // Account setup (convex/onboarding.ts): when it was finished, what to call them, and what they use Wellnest for.
    onboardedAt: v.optional(v.number()),
    // The first-time tour of the app (src/Tour.tsx): when it was finished or skipped.
    touredAt: v.optional(v.number()),
    profile: v.optional(profile),
    focus: v.optional(v.array(focus)),
    // The Sunday evening summary of the week (convex/weekly.ts); on when unset. `weeklySentAt` stops a second one.
    weeklySummary: v.optional(v.boolean()),
    weeklySentAt: v.optional(v.number()),
    // The evening flare forecast (convex/forecast.ts); on when unset. `forecastSentAt` stops a second one that day.
    flareForecast: v.optional(v.boolean()),
    forecastSentAt: v.optional(v.number()),
    // Which kinds of push notification the user wants (convex/push.ts); both on when unset.
    notifications: v.optional(v.object({ reminders: v.boolean(), appointments: v.boolean() })),
    // Set while "Delete everything" runs (convex/me.ts).
    deleting: v.optional(v.boolean()),
    // IANA zone from the app (e.g. "America/Los_Angeles"), for medication reminder times; the offset is a fallback.
    timeZone: v.optional(v.string()),
    utcOffsetMin: v.optional(v.number()),
    // Apple Health link (convex/health.ts). Set on the first sync; removed on disconnect.
    health: v.optional(
      v.object({
        connectedAt: v.number(),
        syncedAt: v.number(),
        source: v.optional(healthSource), // missing on links made before Android support: Apple Health
        // The user's OK to include their Apple Health summaries in CREAO symptom analyses.
        shareWithAnalysis: v.boolean(),
      }),
    ),
  })
    .index("email", ["email"])
    .index("phone", ["phone"])
    .index("by_telegram", ["telegramChatId"]),

  // The user's chats, newest first in the history list (convex/chats.ts). `title` is the first thing they wrote.
  // `legacy`: the first chat, whose messages have no chatId.
  chats: defineTable({
    userId: v.id("users"),
    title: v.optional(v.string()),
    lastAt: v.number(),
    legacy: v.optional(v.boolean()),
  }).index("by_user_and_last", ["userId", "lastAt"]),

  messages: defineTable({
    userId: v.id("users"),
    // Which chat it's in (convex/lib/chats.ts); unset in the user's first chat.
    chatId: v.optional(v.id("chats")),
    role,
    text: v.string(),
    channel,
    embedding: v.optional(v.array(v.float64())),
    urgent: v.optional(v.boolean()),
    // "links": the shopper's store links under a reply. "reminder": a medication reminder (convex/reminders.ts).
    // Both are shown but never read aloud in voice mode.
    // "checkin": a proactive question about a change in the user's health data (convex/checkins.ts).
    // "appointment": offered video visit times, shown as buttons (convex/telehealth.ts).
    // "summary": the weekly summary (convex/weekly.ts).
    kind: v.optional(v.union(v.literal("links"), v.literal("reminder"), v.literal("checkin"), v.literal("appointment"), v.literal("summary"), v.literal("forecast"), v.literal("circle"))),
    // Charts the model drew with show_chart, shown under the reply (convex/insights.ts).
    charts: v.optional(v.array(chartValidator)),
    appointmentId: v.optional(v.id("appointments")),
    // On a reminder: which dose, and the user's Taken / Skip.
    reminder: v.optional(
      v.object({
        medicationId: v.id("medications"),
        dueAt: v.number(),
        status: v.optional(v.union(v.literal("taken"), v.literal("skipped"))),
      }),
    ),
    // A user message that was spoken: a Telegram voice note or the app's mic (text is the transcript). The reply
    // is spoken too.
    voice: v.optional(v.boolean()),
    // A photo the user sent with the message (app upload or Telegram), in file storage.
    image: v.optional(v.id("_storage")),
  })
    .index("by_user", ["userId"])
    .index("by_user_and_chat", ["userId", "chatId"])
    // The chat history's search box (convex/chats.ts).
    .searchIndex("search_text", { searchField: "text", filterFields: ["userId"] })
    .vectorIndex("by_embedding", {
      vectorField: "embedding",
      dimensions: EMBEDDING_DIMS,
      filterFields: ["userId"],
    }),

  // Local weather, air quality and pollen per day at the user's saved location (convex/weather.ts).
  weatherDays: defineTable({
    userId: v.id("users"),
    date: v.string(), // YYYY-MM-DD, local to the location
    tempMax: v.optional(v.number()),
    tempMin: v.optional(v.number()),
    humidity: v.optional(v.number()),
    pressure: v.optional(v.number()),
    precip: v.optional(v.number()),
    aqi: v.optional(v.number()),
    pollen: v.optional(v.number()),
  }).index("by_user_and_date", ["userId", "date"]),

  // One summary per user per local calendar day, sent by the phone from Apple Health (convex/health.ts).
  healthDays: defineTable({
    userId: v.id("users"),
    date: v.string(), // YYYY-MM-DD, the phone's local date
    source: healthSource,
    metrics: healthMetrics,
  }).index("by_user_and_date", ["userId", "date"]),

  // Expo push tokens, one per phone the user is signed in on (convex/push.ts).
  pushTokens: defineTable({
    userId: v.id("users"),
    token: v.string(),
    platform: v.string(),
  })
    .index("by_user", ["userId"])
    .index("by_token", ["token"]),

  // Telehealth video visits (convex/telehealth.ts): offered times, then a booking once the user confirms.
  appointments: defineTable({
    userId: v.id("users"),
    status: v.union(
      v.literal("finding"),
      v.literal("suggested"),
      v.literal("booking"),
      v.literal("booked"),
      v.literal("cancelling"),
      v.literal("cancelled"),
      v.literal("dismissed"),
      v.literal("expired"),
      v.literal("failed"),
    ),
    reason: v.string(),
    urgency: visitUrgency,
    provider: v.string(), // "test" or "http" (convex/lib/telehealth.ts)
    providerName: v.optional(v.string()),
    slots: v.array(slot),
    slotId: v.optional(v.string()),
    bookingId: v.optional(v.string()),
    joinUrl: v.optional(v.string()),
    startsAt: v.optional(v.number()),
    remindJobId: v.optional(v.id("_scheduled_functions")),
    messageId: v.optional(v.id("messages")),
    error: v.optional(v.string()),
  }).index("by_user", ["userId"]),

  // Proactive check-ins sent, for the once-a-day and same-kind limits (convex/checkins.ts).
  checkins: defineTable({
    userId: v.id("users"),
    kind: v.string(),
    messageId: v.id("messages"),
  }).index("by_user", ["userId"]),

  // Symptom journal (convex/journal.ts): one entry per symptom per local day.
  symptomEntries: defineTable({
    userId: v.id("users"),
    date: v.string(), // YYYY-MM-DD in the user's time zone
    symptom: v.string(), // normalized: lower case, singular ("headache")
    severity: v.optional(v.number()), // 0-10
    note: v.optional(v.string()),
    source: entrySource,
  }).index("by_user_and_date", ["userId", "date"]),

  // The user's care team: doctors, nurses, therapists, pharmacists (convex/visits.ts).
  careTeam: defineTable({
    userId: v.id("users"),
    name: v.string(),
    role: v.optional(v.string()),
    phone: v.optional(v.string()),
    email: v.optional(v.string()),
    clinic: v.optional(v.string()),
    address: v.optional(v.string()),
    notes: v.optional(v.string()),
  }).index("by_user", ["userId"]),

  // Appointments of any kind, with prep notes and meeting notes (convex/visits.ts).
  visits: defineTable({
    userId: v.id("users"),
    title: v.string(),
    kind: v.union(v.literal("in_person"), v.literal("video"), v.literal("phone")),
    startsAt: v.number(),
    clinicianId: v.optional(v.id("careTeam")),
    location: v.optional(v.string()),
    prep: v.optional(v.string()), // questions and things to bring
    notes: v.optional(v.string()), // what was said, written afterwards
    questions: v.optional(v.array(v.string())), // suggested questions to ask, from what changed (convex/visits.ts)
    checked: v.optional(v.array(v.string())), // ticked items of the appointment prep checklist (src/GuidesPanel.tsx)
    status: v.union(v.literal("upcoming"), v.literal("done"), v.literal("cancelled")),
    remindJobId: v.optional(v.id("_scheduled_functions")),
  }).index("by_user_and_start", ["userId", "startsAt"]),

  // The user's emergency action plan, one per user (convex/emergency.ts).
  emergencyPlans: defineTable({
    userId: v.id("users"),
    sections: v.array(planSection),
    contacts: v.array(contact),
    asthma: v.optional(asthmaPlan),
    notes: v.optional(v.string()),
  }).index("by_user", ["userId"]),

  // Read-only share links for carers and doctors (convex/share.ts).
  shareLinks: defineTable({
    userId: v.id("users"),
    token: v.string(), // 24 random bytes, base64url
    label: v.optional(v.string()), // who it's for
    sections: v.array(section),
    rangeDays: v.number(), // the page shows the last N days whenever it's opened
    expiresAt: v.optional(v.number()),
    revokedAt: v.optional(v.number()),
    opens: v.number(),
    lastOpenedAt: v.optional(v.number()),
  })
    .index("by_token", ["token"])
    .index("by_user", ["userId"]),

  // Care circle (convex/circle.ts): people who see someone's health summary (read only) and get the alerts the
  // person picked for them. `ownerId` is the person being cared for; `label` is what they call the member.
  circleMembers: defineTable({
    ownerId: v.id("users"),
    memberId: v.id("users"),
    label: v.optional(v.string()),
    alerts: circleAlerts,
  })
    .index("by_owner", ["ownerId"])
    .index("by_member", ["memberId"])
    .index("by_owner_and_member", ["ownerId", "memberId"]),

  // One-time invite links into someone's care circle. The member row takes the label and alerts when it's used.
  circleInvites: defineTable({
    ownerId: v.id("users"),
    token: v.string(), // 24 random bytes, base64url
    label: v.optional(v.string()),
    alerts: circleAlerts,
    expiresAt: v.number(),
    usedAt: v.optional(v.number()),
    revokedAt: v.optional(v.number()),
  })
    .index("by_token", ["token"])
    .index("by_owner", ["ownerId"]),

  // Condition tracker entries: pain / CRPS, asthma, seizures (convex/trackers.ts). Several a day are fine.
  trackerEntries: defineTable({
    userId: v.id("users"),
    date: v.string(), // YYYY-MM-DD in the user's time zone
    at: v.number(),
    tracker,
    pain: v.optional(painDetails),
    asthma: v.optional(asthmaDetails),
    seizure: v.optional(seizureDetails),
    glucose: v.optional(glucoseDetails),
    note: v.optional(v.string()),
    source: v.union(v.literal("manual"), v.literal("chat")),
  }).index("by_user_and_date", ["userId", "date"]),

  // Exercises and physio routines (convex/exercises.ts). Stopped ones stay for the history.
  exercises: defineTable({
    userId: v.id("users"),
    name: v.string(),
    sets: v.optional(v.number()),
    reps: v.optional(v.number()),
    minutes: v.optional(v.number()),
    days: v.array(v.number()), // weekdays, 0 = Sunday; empty = every day
    notes: v.optional(v.string()),
    active: v.boolean(),
  }).index("by_user_and_active", ["userId", "active"]),

  // One row per exercise per day it was done.
  exerciseLogs: defineTable({
    userId: v.id("users"),
    exerciseId: v.id("exercises"),
    date: v.string(),
  })
    .index("by_exercise_and_date", ["exerciseId", "date"])
    .index("by_user_and_date", ["userId", "date"]),

  // The daily check-in: mood, energy and sleep quality, 1-5 (convex/daily.ts).
  dailyLogs: defineTable({
    userId: v.id("users"),
    date: v.string(), // YYYY-MM-DD in the user's time zone
    mood: v.optional(v.number()),
    energy: v.optional(v.number()),
    sleepQuality: v.optional(v.number()),
    note: v.optional(v.string()),
    skipped: v.optional(v.boolean()), // "Not today" on the card
    source: v.union(v.literal("card"), v.literal("chat")),
  }).index("by_user_and_date", ["userId", "date"]),

  // Medication reminders (convex/reminders.ts). Stopped ones are kept (active false) for the dose history.
  medications: defineTable({
    userId: v.id("users"),
    name: v.string(),
    dose: v.optional(v.string()),
    schedule,
    timeZone: v.string(),
    utcOffsetMin: v.number(),
    active: v.boolean(),
    nextAt: v.optional(v.number()),
    jobId: v.optional(v.id("_scheduled_functions")),
    endsAt: v.optional(v.number()), // a course of N days
    stoppedAt: v.optional(v.number()),
    pausedAt: v.optional(v.number()), // reminders off for now; resume brings them back (convex/medications.ts)
    genericName: v.optional(v.string()),
    form: v.optional(medForm),
    prescriber: v.optional(v.string()),
    notes: v.optional(v.string()),
    directions: v.optional(v.string()), // how to take it ("with food", "under the tongue"), for the medication list
    timeDoses: v.optional(v.array(timeDose)), // a different dose at some daily times
    supply: v.optional(supply), // refill tracking
    scriptImage: v.optional(v.id("_storage")), // eScript QR code or prescription label
    // Medication safety (convex/drugs.ts): interactions already told about in chat ("A|B"), and the last
    // missed-doses nudge (convex/reminders.ts).
    interactionAlerts: v.optional(v.array(v.string())),
    nudgedAt: v.optional(v.number()),
  }).index("by_user_and_active", ["userId", "active"]),

  // Lab reports and clinic letters the user added as a photo or PDF (convex/records.ts). The model reads them into a
  // plain-language summary and, for labs, one labResults row per test. `file` is the original, kept to view again.
  records: defineTable({
    userId: v.id("users"),
    status: v.union(v.literal("reading"), v.literal("done"), v.literal("failed")),
    file: v.optional(v.id("_storage")),
    fileType: v.union(v.literal("image"), v.literal("pdf")),
    kind: v.optional(recordKind),
    title: v.optional(v.string()),
    date: v.optional(v.string()), // YYYY-MM-DD on the record; else the day it was added
    source: v.optional(v.string()),
    summary: v.optional(v.string()),
    error: v.optional(v.string()),
  }).index("by_user", ["userId"]),

  labResults: defineTable({
    userId: v.id("users"),
    recordId: v.id("records"),
    date: v.string(),
    test: v.string(),
    key: v.string(), // testKey(test): lines the same test up across reports
    value: v.optional(v.number()),
    text: v.optional(v.string()),
    unit: v.optional(v.string()),
    low: v.optional(v.number()),
    high: v.optional(v.number()),
    flag: v.optional(labFlag),
    explanation: v.string(),
  })
    .index("by_record", ["recordId"])
    .index("by_user_and_key_and_date", ["userId", "key", "date"])
    .index("by_user_and_date", ["userId", "date"]),

  // What RxNorm and the FDA label say about a medication name, shared by everyone who takes it (public data).
  // `found` is false when neither knew the name; `fetchedAt` is when it was looked up (refreshed after 30 days).
  drugInfo: defineTable({
    key: v.string(), // convex/lib/drugs.ts drugKey
    found: v.boolean(),
    ingredients: v.array(v.string()),
    brands: v.array(v.string()),
    classes: v.array(v.string()),
    interactions: v.string(),
    boxedWarning: v.optional(v.string()),
    fetchedAt: v.number(),
  }).index("by_key", ["key"]),

  // A medication's dated history: started, paused, resumed, stopped, dose changes, refills.
  medicationEvents: defineTable({
    userId: v.id("users"),
    medicationId: v.id("medications"),
    kind: medEventKind,
    at: v.number(),
    note: v.optional(v.string()),
  })
    .index("by_medication", ["medicationId"])
    .index("by_user", ["userId"]),

  sideEffects: defineTable({
    userId: v.id("users"),
    medicationId: v.id("medications"),
    date: v.string(), // YYYY-MM-DD
    effect: v.string(),
    severity: v.optional(v.number()), // 0-10
  })
    .index("by_medication", ["medicationId"])
    .index("by_user", ["userId"]),

  // Taken / Skip answers to reminders.
  doseLogs: defineTable({
    userId: v.id("users"),
    medicationId: v.id("medications"),
    dueAt: v.number(),
    status: v.union(v.literal("taken"), v.literal("skipped")),
  })
    .index("by_medication_and_due", ["medicationId", "dueAt"])
    .index("by_user", ["userId"]),

  // Photos uploaded from the app: who uploaded each file, and the message that used it (convex/chat.ts).
  photoUploads: defineTable({
    userId: v.id("users"),
    storageId: v.id("_storage"),
    messageId: v.optional(v.id("messages")),
    usedFor: v.optional(v.union(v.literal("script"), v.literal("record"))), // attached to a medication or a health record instead of a message
  })
    .index("by_storage", ["storageId"])
    .index("by_user", ["userId"]),

  // Facts the assistant keeps in mind on every turn (allergies, conditions...). Saved by the user or by the
  // model's remember_fact tool; listed, editable and deletable on the "What Wellnest knows" page (convex/me.ts).
  memoryFacts: defineTable({
    userId: v.id("users"),
    text: v.string(),
    source: v.union(v.literal("user"), v.literal("assistant")),
  }).index("by_user", ["userId"]),

  // Doctor-visit summaries (convex/visit.ts).
  visitSummaries: defineTable({
    userId: v.id("users"),
    reason: v.optional(v.string()),
    days: v.number(), // period covered, ending when it was made
    status: v.union(v.literal("generating"), v.literal("ready"), v.literal("failed")),
    text: v.optional(v.string()), // Markdown
    error: v.optional(v.string()),
    // Asked for in chat: where to announce it when it's done.
    notify: v.optional(channel),
  }).index("by_user", ["userId"]),

  // One-time codes for t.me/<bot>?start=<code> account linking.
  telegramLinks: defineTable({
    code: v.string(),
    userId: v.id("users"),
    expiresAt: v.number(),
    // Telegram chat that pressed Start with this code and is being asked to confirm.
    pendingChatId: v.optional(v.string()),
  })
    .index("by_code", ["code"])
    .index("by_expires", ["expiresAt"]),

  // Detailed symptom analyses run by the CREAO agent (convex/creao.ts).
  creaoRuns: defineTable({
    userId: v.id("users"),
    channel,
    inputs: creaoInputs,
    status: creaoRunStatus,
    runId: v.optional(v.string()), // CREAO's run id, once it accepts the run
    polls: v.number(),
    delivered: v.boolean(), // the user has been sent the report (or the failure notice)
    report: v.optional(v.string()),
    errorCode: v.optional(v.string()),
  })
    .index("by_user", ["userId"])
    .index("by_run", ["runId"]),

  // Legacy, no longer written: orders from the removed approve-then-fill-a-cart flow. Kept because the dev deployment still has rows.
  carts: defineTable({
    userId: v.id("users"),
    status: v.union(v.literal("pending"), v.literal("approved"), v.literal("cancelled")),
    expiresAt: v.number(),
    kitKey: v.string(),
    kitLabel: v.string(),
    urgency,
    budgetCapCents: v.number(),
    lines: v.array(cartLine),
    merchants: v.array(cartMerchant),
    dropped: v.array(v.string()),
    unavailable: v.array(v.string()),
    notes: v.array(v.string()),
    rxRefused: v.array(v.string()),
    singleStoreTotals: v.array(v.object({ name: v.string(), totalCents: v.number() })),
    real: v.optional(realStore), // always set on new carts; missing only on old simulated-store carts
  }).index("by_user_status", ["userId", "status"]),

  // Legacy, no longer written: the removed simulated card network. Kept because the dev deployment still has rows.
  cardAuths: defineTable({
    authId: v.string(),
    amountCents: v.number(),
    merchantId: v.string(),
    reference: v.string(),
    status: v.union(v.literal("authorized"), v.literal("captured"), v.literal("voided")),
  }).index("by_auth", ["authId"]),

  // Legacy, no longer written: orders from the removed simulated merchants. Kept because the dev deployment still has rows.
  shopOrders: defineTable({
    userId: v.id("users"),
    cartId: v.id("carts"),
    merchantId: v.string(),
    merchant: v.string(),
    orderId: v.string(),
    status: v.union(v.literal("paid"), v.literal("failed")),
    authId: v.optional(v.string()),
    amountCents: v.optional(v.number()),
    etaMinutes: v.optional(v.number()),
    items: v.optional(v.array(v.string())),
    reason: v.optional(v.string()),
  }).index("by_user", ["userId"]),
});

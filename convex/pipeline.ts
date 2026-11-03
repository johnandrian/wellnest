// The shared message pipeline for every channel (app + Telegram):
// Jev routes + triages -> embed -> vector search memory -> proactive shopper -> core model with tools -> reply.
import { v } from "convex/values";
import { ActionCtx, internalAction, internalMutation, internalQuery, MutationCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import { Doc, Id } from "./_generated/dataModel";
import { ChatMessage, complete, CORE_MODEL, imageDataUrl, VISION_MODEL } from "./lib/cortex";
import { embed } from "./lib/jina";
import { analyzeSymptomsTool, factTools, findCareTool, healthDataTool, insightTools, journalTools, reminderTools, runTool, saveLocationTool, telehealthTool, toolDefs, visitSummaryTool, visitTools } from "./lib/tools";
import { careForModel } from "./care";
import { refreshSoon } from "./weather";
import { Chart, chartValidator } from "./lib/insights";
import { aboutUserText } from "./lib/onboarding";
import { localToday } from "./journal";
import { exercisePatterns, journalText } from "./lib/journal";
import { painAsEntries, trackersText } from "./lib/trackers";
import { biosensorText, cycleSummary, dateDaysAgo, HealthDay, healthReport } from "./lib/health";
import { parseInputs } from "./lib/creao";
import { NO_ROUTE, Route, route } from "./lib/jev";
import { shopTurn } from "./shop";
import { sendChatAction, sendTelegram, sendTyping, sendVoice } from "./lib/telegram";
import { synthesizeMp3 } from "./lib/cartesia";
import { toSpeech } from "./lib/speech";
import { channel } from "./schema";
import { Lang, langOf, languagePrompt, t } from "./lib/language";
import { chatMessages, currentChatKey, insertMessage } from "./lib/chats";

const MAX_TOOL_ROUNDS = 5;
const HISTORY_LIMIT = 12;
const OFFER_TTL_MS = 30 * 60 * 1000; // how long an analysis offer waits for a yes

const SYSTEM_PROMPT = `You are a careful, friendly AI health assistant.
- Give clear, practical, evidence-based answers in plain words. Keep replies short unless asked for detail.
- You are not a doctor; for anything serious, recommend seeing a clinician.
- Use tools when you need current or specific info: web_search, read_page, bio_research (PubMed). Cite sources as links.
- Use the "Relevant past messages" to remember what the user told you before.
- If the user tells you where they are (city, zip, address), call save_location so you remember it.
- Format with simple Markdown only: **bold**, *italic*, bullet lists, [links](url). No tables.`;

const URGENT_PROMPT = `TRIAGE FLAGGED THIS AS URGENT.
Start your reply with a clear warning: tell the user to seek care now and to call 911 (or local emergency number) if it could be life-threatening.
Then help them find nearby urgent care or an ER: if you know their location, call find_care (kind "er" for anything life-threatening, otherwise "urgent_care") and list the closest few with their call and directions links; if not, ask for their city/zip (and save it with save_location).`;

const OFFER_ANALYSIS_PROMPT = `Answer briefly, then offer a detailed symptom analysis by the CREAO symptom analyzer: it ranks the most likely conditions with reasoning and care guidance, takes a few minutes, and sends what the user has told you to that service. Ask them to reply yes if they want it. Don't run it yourself.`;

const PHOTO_PROMPT = `The user attached a photo. Look at it carefully and say briefly what you see before answering.
- Labels, pill bottles, prescriptions, lab results: read the text exactly; if part is unreadable, say so rather than guessing a name or dose.
- Skin, rashes, wounds, eyes, swelling: describe what's visible, but you can't diagnose from a photo. Say what would make it urgent (spreading redness, fever, severe pain, trouble breathing...) and when to see a clinician.
- Never try to identify people in photos.`;

const HEALTH_PROMPT = `The user connected their phone's health data (Apple Health or Health Connect). When their metrics could help (tiredness, sleep, possible illness, heart rate, their cycle), call get_health_data and mention the specific numbers that matter. Don't recite numbers that aren't relevant, and don't diagnose from them.`;

const HEALTH_IN_ANALYSIS_PROMPT = `The user has agreed to include their health data summaries in symptom analyses; they're added to it automatically.`;

const RUN_ANALYSIS_PROMPT = `The user agreed to a detailed symptom analysis. Call analyze_symptoms now with every symptom detail they've given in this conversation (plus any health-app data or cycle info), then tell them the report will arrive in a few minutes.`;

const LINKS_PROMPT = `After your reply, the app shows the user Amazon and Walmart links for their approved supplies, with one-tap cart links; they check out themselves. End your reply with one short sentence like "Here are links for what I'd get you:". Don't list items, prices or links, don't say you placed an order, and don't quote these instructions.`;

type Analysis = "none" | "offer" | "run";

export const respond = internalAction({
  args: { messageId: v.id("messages") },
  handler: async (ctx, { messageId }) => {
    const message = await ctx.runQuery(internal.pipeline.getMessage, { messageId });
    if (!message) return;
    const { userId } = message;
    const user = await ctx.runQuery(internal.pipeline.getUser, { userId });
    // Telegram shows "typing…" for ~5s per call; re-sent before each slow step.
    const typing = () => {
      if (message.channel === "telegram" && user?.telegramChatId) {
        void sendTyping(user.telegramChatId).catch(() => {});
      }
    };
    typing();

    let reply: string;
    let links: string | undefined; // the shopper's store links, saved as their own message after the reply
    const charts: Chart[] = []; // drawn with show_chart, shown under the reply
    let urgent = false;
    try {
      // 1. Recent chat goes to the model as-is.
      const history = await ctx.runQuery(internal.pipeline.recent, { userId, limit: HISTORY_LIMIT });
      const now = Date.now();
      const analysisOffered = (user?.analysisOfferedAt ?? 0) > now - OFFER_TTL_MS;

      // 2. Jev routes: emergency triage, shopping, the symptom analyzer (only with the user's OK), or the regular assistant.
      const routed = await runRoute({
        text: message.text || "(sent a photo)",
        lastAssistant: history.findLast((m) => m.role === "assistant")?.text,
        analysisOffered,
      });

      // 3. Embed + vector search for memory. Memory is only for older messages:
      // anything in the recent chat window, or newer than its oldest message, is skipped.
      let memory: Doc<"messages">[] = [];
      try {
        const vector = await embed(message.text || "(photo)");
        await ctx.runMutation(internal.pipeline.setEmbedding, { messageId, embedding: vector });
        const hits = await ctx.vectorSearch("messages", "by_embedding", {
          vector,
          limit: 8,
          filter: (q) => q.eq("userId", userId),
        });
        const ids = hits.filter((h) => h._id !== messageId && h._score > 0.5).map((h) => h._id);
        const windowStart = history[0]?._creationTime ?? message._creationTime;
        const inHistory = new Set(history.map((m) => m._id));
        memory = (await ctx.runQuery(internal.pipeline.getMessages, { ids })).filter(
          (m) => !inHistory.has(m._id) && m._creationTime < windowStart && m._creationTime > (user?.chatClearedAt ?? 0),
        );
      } catch (e) {
        console.error("memory step failed", e);
      }

      const medications: string = await ctx.runQuery(internal.reminders.activeText, { userId, now });
      const records: string = await ctx.runQuery(internal.records.forModel, { userId });
      const facts: string[] = await ctx.runQuery(internal.me.factsFor, { userId });
      const care: { upcoming: string; team: string } = await ctx.runQuery(internal.visits.contextFor, { userId, now });
      const emergencyPlan: string = routed.urgent ? await ctx.runQuery(internal.emergency.textFor, { userId }) : "";

      // 4. Triage: Jev's emergency answer from step 2.
      urgent = routed.urgent;

      // 5. Proactive shopping: store links for the approved supplies; the user buys them. Never for emergencies.
      if (routed.needsSupplies && !urgent) {
        typing();
        const result = await runShopper(message.text);
        if (result?.kind === "links") links = result.text;
      }

      // 6. The analyzer runs only once the user asks for it or says yes to an offer.
      const analysis: Analysis =
        routed.consent && (routed.wantsAnalysis || analysisOffered) ? "run" : routed.wantsAnalysis ? "offer" : "none";
      if (analysis === "offer" || analysisOffered) {
        await ctx.runMutation(internal.pipeline.setFlow, {
          userId,
          analysisOfferedAt: analysis === "offer" ? now : null,
        });
      }

      // 7. Core model with tools. A photo goes along as an image (only with this message, not in history).
      let image: string | undefined;
      if (message.image) {
        const blob = await ctx.storage.get(message.image);
        if (blob) image = await imageDataUrl(blob);
      }
      reply = await runCore({
        message,
        image,
        memory,
        history,
        urgent,
        analysis,
        linksShown: !!links,
        location: user?.location,
        language: langOf(user),
        typing,
        saveLocation: (location) =>
          ctx.runMutation(internal.pipeline.saveLocation, { userId, location }),
        medications,
        records,
        facts,
        about: aboutUserText(user?.profile, user?.focus),
        care,
        emergencyPlan,
        today: localToday(user),
        visit: (name, rawArgs) => {
          const args = parseArgs(rawArgs);
          const str = (k: string) => (typeof args[k] === "string" ? (args[k] as string) : undefined);
          if (name === "add_care_team_member") {
            return ctx.runMutation(internal.visits.addMemberFromChat, { userId, name: str("name") ?? "", role: str("role"), phone: str("phone"), clinic: str("clinic") });
          }
          const kind = str("kind");
          return ctx.runMutation(internal.visits.addFromChat, {
            userId,
            title: str("title") ?? "",
            date: str("date") ?? "",
            time: str("time") ?? "",
            kind: kind === "video" || kind === "phone" || kind === "in_person" ? kind : undefined,
            clinician: str("clinician"),
            location: str("location"),
          });
        },
        telehealth: (rawArgs) => {
          const args = parseArgs(rawArgs);
          return ctx.runMutation(internal.telehealth.suggestFromChat, {
            userId,
            reason: String(args.reason ?? ""),
            urgency: args.urgency === "today" ? "today" : "soon",
          });
        },
        findCare: (rawArgs) => {
          const kind = String(parseArgs(rawArgs).kind ?? "");
          return kind === "er" || kind === "urgent_care" || kind === "pharmacy" || kind === "doctor"
            ? careForModel(ctx, userId, kind)
            : Promise.resolve('Tool error: kind must be "er", "urgent_care", "pharmacy" or "doctor".');
        },
        journal: async (name, rawArgs) => {
          const args = parseArgs(rawArgs);
          if (name === "add_exercise") {
            const a = args as Record<string, any>;
            return ctx.runMutation(internal.exercises.addFromChat, {
              userId,
              name: String(a.name ?? ""),
              sets: typeof a.sets === "number" ? a.sets : undefined,
              reps: typeof a.reps === "number" ? a.reps : undefined,
              minutes: typeof a.minutes === "number" ? a.minutes : undefined,
              days: Array.isArray(a.days) ? a.days.filter((d: unknown): d is number => typeof d === "number") : undefined,
              notes: typeof a.notes === "string" ? a.notes : undefined,
            });
          }
          if (name === "log_exercise_done") {
            return ctx.runMutation(internal.exercises.doneFromChat, {
              userId,
              name: String(args.name ?? ""),
              date: typeof args.date === "string" ? args.date : undefined,
            });
          }
          if (name === "log_condition_event") {
            const tracker = args.tracker === "pain" || args.tracker === "asthma" || args.tracker === "seizure" ? args.tracker : null;
            if (!tracker) return Promise.resolve('Tool error: tracker must be "pain", "asthma" or "seizure".');
            const a = args as Record<string, any>;
            return ctx.runMutation(internal.trackers.fromChat, {
              userId,
              tracker,
              date: typeof a.date === "string" ? a.date : undefined,
              note: typeof a.note === "string" ? a.note : undefined,
              pain: tracker === "pain" ? {
                severity: a.severity, locations: a.locations, types: a.types, durationMin: a.duration_min, flare: a.flare,
                swelling: a.swelling, colourChange: a.colour_change, temperatureChange: a.temperature_change,
                touchSensitive: a.touch_sensitive, triggers: a.triggers, helped: a.helped,
              } : undefined,
              asthma: tracker === "asthma" ? {
                peakFlow: a.peak_flow, reliever: a.reliever_puffs, preventer: a.preventer_taken, symptoms: a.symptoms,
                night: a.night, attack: a.attack, triggers: a.triggers,
              } : undefined,
              seizure: tracker === "seizure" ? {
                type: a.seizure_type, durationSec: a.duration_seconds, aura: a.aura, triggers: a.triggers,
                rescueMed: a.rescue_med, recoveryMin: a.recovery_min, witness: a.witness,
              } : undefined,
            });
          }
          if (name === "log_how_i_feel") {
            return ctx.runMutation(internal.daily.fromChat, {
              userId,
              mood: typeof args.mood === "number" ? args.mood : undefined,
              energy: typeof args.energy === "number" ? args.energy : undefined,
              sleepQuality: typeof args.sleep_quality === "number" ? args.sleep_quality : undefined,
              note: typeof args.note === "string" ? args.note : undefined,
            });
          }
          if (name === "log_symptom") {
            return ctx.runMutation(internal.journal.logFromChat, {
              userId,
              symptom: String(args.symptom ?? ""),
              severity: typeof args.severity === "number" ? args.severity : undefined,
              note: typeof args.note === "string" ? args.note : undefined,
              date: typeof args.date === "string" ? args.date : undefined,
            });
          }
          const days = Math.min(180, Math.max(1, Math.round(Number(args.days ?? 30)) || 30));
          const since = dateDaysAgo(Date.now(), days - 1);
          const entries = await ctx.runQuery(internal.journal.since, { userId, since });
          const daily = await ctx.runQuery(internal.journal.dailyFrom, { userId, since });
          const tracked = await ctx.runQuery(internal.trackers.since, { userId, since });
          const text = journalText([...entries, ...painAsEntries(tracked.entries)], await healthDays(ctx, userId, Math.min(days, 90)), daily);
          const conditions = trackersText(tracked.entries, tracked.peakFlowBest);
          const ex = await ctx.runQuery(internal.exercises.adherenceFor, { userId, from: since, to: dateDaysAgo(Date.now(), 0) });
          const found = exercisePatterns([...entries, ...painAsEntries(tracked.entries)], ex.doneDates, ex.missedDates);
          return [
            text,
            conditions && `Condition trackers:\n${conditions}`,
            ex.text && `Exercises:\n${ex.text}`,
            found.length ? `Exercise patterns (associations, not causes):\n${found.join("\n")}` : "",
          ]
            .filter(Boolean)
            .join("\n\n");
        },
        fact: (name, rawArgs) => {
          const text = String(parseArgs(rawArgs).fact ?? "");
          return name === "remember_fact"
            ? ctx.runMutation(internal.me.rememberFromChat, { userId, text })
            : ctx.runMutation(internal.me.forgetFromChat, { userId, text });
        },
        reminder: (name, rawArgs) => {
          const args = parseArgs(rawArgs);
          const medName = typeof args.name === "string" ? args.name : "";
          if (name === "update_medication") {
            const action = String(args.action ?? "");
            if (!["pause", "resume", "stop", "change_dose", "side_effect", "refilled"].includes(action)) {
              return Promise.resolve("Tool error: unknown action.");
            }
            return ctx.runMutation(internal.medications.updateFromChat, {
              userId,
              name: medName,
              action: action as "pause",
              dose: typeof args.dose === "string" ? args.dose : undefined,
              sideEffect: typeof args.side_effect === "string" ? args.side_effect : undefined,
              severity: typeof args.severity === "number" ? args.severity : undefined,
              amount: typeof args.amount === "number" ? args.amount : undefined,
            });
          }
          if (name === "cancel_medication_reminder") {
            return ctx.runMutation(internal.reminders.cancelFromChat, { userId, name: medName });
          }
          const times = Array.isArray(args.times) ? args.times.filter((t): t is string => typeof t === "string") : [];
          const everyHours = Number(args.every_hours);
          if (!times.length && !(everyHours > 0)) return Promise.resolve("Tool error: give times or every_hours.");
          return ctx.runMutation(internal.reminders.addFromChat, {
            userId,
            name: medName,
            dose: typeof args.dose === "string" ? args.dose : undefined,
            days: typeof args.days === "number" ? args.days : undefined,
            schedule: times.length
              ? { kind: "daily", times }
              : { kind: "interval", everyHours, firstAt: Date.now() + everyHours * 3_600_000 },
          });
        },
        prepareVisit: (rawArgs) => {
          const args = parseArgs(rawArgs);
          return ctx.runMutation(internal.visit.request, {
            userId,
            channel: message.channel,
            reason: typeof args.reason === "string" ? args.reason : undefined,
            days: typeof args.days === "number" ? args.days : undefined,
          });
        },
        insights: () => ctx.runQuery(internal.insights.forModel, { userId }),
        chart: async (rawArgs) => {
          const args = parseArgs(rawArgs);
          const chart = await ctx.runQuery(internal.insights.chartFor, {
            userId,
            metric: String(args.metric ?? ""),
            symptom: typeof args.symptom === "string" ? args.symptom : undefined,
            days: typeof args.days === "number" ? args.days : 30,
          });
          if ("error" in chart) return `Tool error: ${chart.error}`;
          if (charts.length >= MAX_CHARTS) return `Tool error: at most ${MAX_CHARTS} charts per reply.`;
          charts.push(chart);
          return chartSummary(chart);
        },
        healthConnected: !!user?.health,
        healthInAnalysis: !!user?.health?.shareWithAnalysis,
        getHealthData: async (days) => healthReport(await healthDays(ctx, userId, days), dateDaysAgo(Date.now(), 0)),
        analyzeSymptoms: async (rawArgs) => {
          const parsed = parseInputs(rawArgs);
          if ("error" in parsed) return `Tool error: ${parsed.error}`;
          const inputs = parsed.inputs;
          // With the user's OK, the analyzer gets their Apple Health summaries where the model left the fields empty.
          if (user?.health?.shareWithAnalysis) {
            const days = await healthDays(ctx, userId, 90);
            const cycle = cycleSummary(days, dateDaysAgo(Date.now(), 0));
            inputs.biosensor_data ??= biosensorText(days.slice(-14));
            if (cycle) {
              inputs.cycle_data ??= cycle.text;
              inputs.last_period_start ??= cycle.lastPeriodStart;
            }
          }
          return ctx.runMutation(internal.creao.request, { userId, channel: message.channel, inputs });
        },
      });
    } catch (e) {
      console.error("pipeline failed", e);
      reply = t(langOf(user), "failed");
    }

    await ctx.runMutation(internal.pipeline.saveReply, {
      userId,
      text: reply,
      extra: links,
      charts: charts.length ? charts : undefined,
      channel: message.channel,
      urgent,
      heard: message.voice && message.channel === "telegram" ? message.text : undefined,
    });
  },
});

async function healthDays(ctx: ActionCtx, userId: Id<"users">, days: number): Promise<HealthDay[]> {
  return ctx.runQuery(internal.health.daysSince, { userId, since: dateDaysAgo(Date.now(), days - 1) });
}

async function runRoute(opts: Parameters<typeof route>[0]): Promise<Route> {
  try {
    return await route(opts);
  } catch (e) {
    console.error("routing failed", e);
    return NO_ROUTE;
  }
}

async function runShopper(text: string) {
  try {
    return await shopTurn(text);
  } catch (e) {
    console.error("shopper failed", e);
    return null;
  }
}

async function runCore(opts: {
  message: Doc<"messages">;
  image?: string; // data: URL of the photo sent with this message
  memory: Doc<"messages">[];
  history: Doc<"messages">[];
  urgent: boolean;
  analysis: Analysis;
  linksShown: boolean;
  location?: string;
  language: Lang;
  typing: () => void;
  saveLocation: (location: string) => Promise<null>;
  medications: string;
  records: string;
  facts: string[];
  about: string;
  care: { upcoming: string; team: string };
  emergencyPlan: string;
  today: string;
  visit: (name: string, rawArgs: string) => Promise<string>;
  findCare: (rawArgs: string) => Promise<string>;
  telehealth: (rawArgs: string) => Promise<string>;
  fact: (name: string, rawArgs: string) => Promise<string>;
  journal: (name: string, rawArgs: string) => Promise<string>;
  reminder: (name: string, rawArgs: string) => Promise<string>;
  prepareVisit: (rawArgs: string) => Promise<string>;
  healthConnected: boolean;
  healthInAnalysis: boolean;
  getHealthData: (days: number) => Promise<string>;
  insights: () => Promise<string>;
  chart: (rawArgs: string) => Promise<string>;
  analyzeSymptoms: (rawArgs: string) => Promise<string>;
}): Promise<string> {
  const { message, memory, history, urgent, analysis, location } = opts;
  const system = [SYSTEM_PROMPT];
  const langLine = languagePrompt(opts.language);
  if (langLine) system.push(langLine);
  if (location) system.push(`User's saved location: ${location}`);
  system.push(
    opts.facts.length
      ? `Saved facts about the user (they can edit these; call forget_fact if one turns out wrong):\n${opts.facts.map((f) => `- ${f}`).join("\n")}`
      : "No saved facts about the user yet. When they mention a lasting health fact (allergy, condition, regular medication), call remember_fact.",
  );
  if (opts.about) system.push(opts.about);
  system.push(`Today is ${opts.today} (the user's local date).`);
  if (opts.care.upcoming) system.push(`The user's upcoming appointments:\n${opts.care.upcoming}`);
  if (opts.care.team) system.push(`The user's care team:\n${opts.care.team}`);
  if (opts.medications) system.push(`Medication reminders the user has set up:
${opts.medications}`);
  if (opts.records) system.push(`${opts.records}
Explain results in plain words when asked; don't diagnose. The user adds records in Health tools > Records.`);
  if (memory.length) {
    system.push(
      "Relevant past messages:\n" + memory.map((m) => `- [${m.role}] ${m.text}`).join("\n"),
    );
  }
  if (opts.healthConnected) system.push(HEALTH_PROMPT);
  if (opts.image) system.push(PHOTO_PROMPT);
  if (urgent) system.push(URGENT_PROMPT);
  if (urgent && opts.emergencyPlan) {
    system.push(`The user's own emergency plan (written with their doctors; point them to the relevant steps):
${opts.emergencyPlan}`);
  }
  if (analysis === "offer") system.push(OFFER_ANALYSIS_PROMPT);
  if (analysis !== "none" && opts.healthInAnalysis) system.push(HEALTH_IN_ANALYSIS_PROMPT);
  if (analysis === "run") system.push(RUN_ANALYSIS_PROMPT);
  if (opts.linksShown) system.push(LINKS_PROMPT);
  const tools = [
    ...toolDefs,
    saveLocationTool,
    findCareTool,
    ...(urgent ? [] : [telehealthTool]),
    visitSummaryTool,
    ...reminderTools,
    ...visitTools,
    ...factTools,
    ...journalTools,
    ...insightTools,
    ...(opts.healthConnected ? [healthDataTool] : []),
    ...(analysis === "run" ? [analyzeSymptomsTool] : []),
  ];

  const messages: ChatMessage[] = [
    { role: "system", content: system.join("\n\n") },
    ...history
      .filter((m) => m._id !== message._id)
      .map((m) => ({ role: m.role, content: m.image ? `[sent a photo] ${m.text}`.trim() : m.text }) as ChatMessage),
    {
      role: "user",
      content: opts.image
        ? [
            { type: "text", text: message.text || "(no message, just the photo)" },
            { type: "image_url", image_url: { url: opts.image } },
          ]
        : message.text,
    },
  ];
  const model = opts.image ? VISION_MODEL() : CORE_MODEL();

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const { content, toolCalls } = await complete({ model, messages, tools });
    if (!toolCalls.length) return content?.trim() || "Sorry, I don't have an answer for that.";
    opts.typing();
    messages.push({ role: "assistant", content, tool_calls: toolCalls });
    for (const call of toolCalls) {
      let result: string;
      if (call.function.name === "save_location") {
        result = await runSaveLocation(call.function.arguments, opts.saveLocation);
      } else if (call.function.name === "suggest_telehealth") {
        result = urgent
          ? "Tool error: this is an emergency; send the user to 911 or the ER, not a video visit."
          : await opts.telehealth(call.function.arguments).catch((e) => `Tool error: ${(e as Error).message}`);
      } else if (call.function.name === "add_appointment" || call.function.name === "add_care_team_member") {
        result = await opts.visit(call.function.name, call.function.arguments).catch((e) => `Tool error: ${(e as Error).message}`);
      } else if (call.function.name === "find_care") {
        result = await opts.findCare(call.function.arguments);
      } else if (["log_symptom", "get_symptom_journal", "log_how_i_feel", "log_condition_event", "add_exercise", "log_exercise_done"].includes(call.function.name)) {
        result = await opts.journal(call.function.name, call.function.arguments).catch((e) => `Tool error: ${(e as Error).message}`);
      } else if (call.function.name === "remember_fact" || call.function.name === "forget_fact") {
        result = await opts.fact(call.function.name, call.function.arguments).catch((e) => `Tool error: ${(e as Error).message}`);
      } else if (["set_medication_reminder", "cancel_medication_reminder", "update_medication"].includes(call.function.name)) {
        result = await opts.reminder(call.function.name, call.function.arguments).catch((e) => `Tool error: ${(e as Error).message}`);
      } else if (call.function.name === "prepare_visit_summary") {
        result = await opts.prepareVisit(call.function.arguments).catch((e) => `Tool error: ${(e as Error).message}`);
      } else if (call.function.name === "find_patterns") {
        result = await opts.insights().catch((e) => `Tool error: ${(e as Error).message}`);
      } else if (call.function.name === "show_chart") {
        result = await opts.chart(call.function.arguments).catch((e) => `Tool error: ${(e as Error).message}`);
      } else if (call.function.name === "get_health_data") {
        result = !opts.healthConnected
          ? "Tool error: the user hasn't connected their health data."
          : await opts.getHealthData(healthDaysArg(call.function.arguments)).catch((e) => `Tool error: ${(e as Error).message}`);
      } else if (call.function.name === "analyze_symptoms") {
        result =
          analysis !== "run"
            ? "Tool error: the user hasn't agreed to a detailed analysis. Offer it and wait for their yes."
            : await opts.analyzeSymptoms(call.function.arguments).catch((e) => `Tool error: ${(e as Error).message}`);
      } else {
        result = await runTool(call.function.name, call.function.arguments);
      }
      messages.push({ role: "tool", tool_call_id: call.id, content: result });
    }
  }
  // Out of tool rounds: ask for a final answer without tools.
  const { content } = await complete({ model, messages });
  return content?.trim() || "Sorry, I couldn't finish researching that.";
}

const MAX_CHARTS = 3;

// What the model reads back after drawing a chart: enough to describe the trend in a sentence.
export function chartSummary(c: Chart): string {
  const vals = c.points.map((p) => p.value);
  const avg = Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 10) / 10;
  const lo = c.points.reduce((a, b) => (b.value < a.value ? b : a));
  const hi = c.points.reduce((a, b) => (b.value > a.value ? b : a));
  const half = Math.floor(c.points.length / 2);
  const mean = (xs: number[]) => Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10;
  const trend = c.points.length >= 6 ? ` First half average ${mean(vals.slice(0, half))}, second half ${mean(vals.slice(half))}.` : "";
  return (
    `Chart shown to the user: ${c.title}${c.unit ? ` (${c.unit})` : ""}, ${c.from} to ${c.to}, ${c.points.length} days with data. ` +
    `Average ${avg}, lowest ${lo.value} on ${lo.date}, highest ${hi.value} on ${hi.date}.${trend}`
  );
}

function parseArgs(rawArgs: string): Record<string, unknown> {
  try {
    const args = JSON.parse(rawArgs || "{}");
    return args && typeof args === "object" ? args : {};
  } catch {
    return {};
  }
}

function healthDaysArg(rawArgs: string) {
  const days = Math.round(Number(parseArgs(rawArgs).days ?? 14));
  return Number.isFinite(days) ? Math.min(90, Math.max(1, days)) : 14;
}

async function runSaveLocation(rawArgs: string, save: (location: string) => Promise<null>) {
  try {
    const location = String(JSON.parse(rawArgs || "{}").location ?? "").trim().slice(0, 200);
    if (!location) return "Tool error: location is empty";
    await save(location);
    return `Saved location: ${location}`;
  } catch (e) {
    return `Tool error: ${(e as Error).message}`;
  }
}

export const saveLocation = internalMutation({
  args: { userId: v.id("users"), location: v.string() },
  handler: async (ctx, { userId, location }) => {
    await ctx.db.patch(userId, { location });
    await refreshSoon(ctx, userId);
    return null;
  },
});

export const getMessage = internalQuery({
  args: { messageId: v.id("messages") },
  handler: (ctx, { messageId }) => ctx.db.get(messageId),
});

export const getMessages = internalQuery({
  args: { ids: v.array(v.id("messages")) },
  handler: async (ctx, { ids }) =>
    (await Promise.all(ids.map((id) => ctx.db.get(id)))).filter((m) => m !== null),
});

export const recent = internalQuery({
  args: { userId: v.id("users"), limit: v.number() },
  handler: async (ctx, { userId, limit }) => {
    const user = await ctx.db.get(userId);
    if (!user) return [];
    return (await chatMessages(ctx, user, await currentChatKey(ctx, user)).order("desc").take(limit)).reverse();
  },
});

export const setEmbedding = internalMutation({
  args: { messageId: v.id("messages"), embedding: v.array(v.float64()) },
  handler: (ctx, { messageId, embedding }) => ctx.db.patch(messageId, { embedding }),
});

export const saveReply = internalMutation({
  args: {
    userId: v.id("users"),
    text: v.string(),
    extra: v.optional(v.string()),
    charts: v.optional(v.array(chartValidator)),
    channel,
    urgent: v.boolean(),
    heard: v.optional(v.string()), // the transcript, when the user asked by Telegram voice note
  },
  handler: async (ctx, { extra, heard, charts, ...args }) => {
    // Two messages in the app; one Telegram message so they can't arrive out of order.
    await saveAssistantReply(ctx, { ...args, charts }, false);
    if (extra) await saveAssistantReply(ctx, { ...args, text: extra, urgent: false, kind: "links" }, false);
    if (args.channel === "telegram") {
      await ctx.scheduler.runAfter(0, internal.pipeline.deliverTelegram, {
        userId: args.userId,
        text: extra ? `${args.text}\n\n${extra}` : args.text,
        // A voice note gets a spoken answer too (the reply only, not the store links).
        ...(heard !== undefined && { voice: { heard, speak: args.text } }),
      });
    }
  },
});

// Routing state on the user: an analysis offer waiting for a yes. null clears it.
export const setFlow = internalMutation({
  args: { userId: v.id("users"), analysisOfferedAt: v.union(v.number(), v.null()) },
  handler: (ctx, { userId, analysisOfferedAt }) => ctx.db.patch(userId, { analysisOfferedAt: analysisOfferedAt ?? undefined }),
});

// Store an assistant message, embed it, and send it on Telegram if that's where the user is.
// Also used for replies that arrive later, like CREAO analysis reports.
export async function saveAssistantReply(
  ctx: MutationCtx,
  args: { userId: Id<"users">; text: string; channel: "app" | "telegram"; urgent: boolean; kind?: "links" | "summary"; charts?: Chart[] },
  deliver = true,
) {
  const messageId = await insertMessage(ctx, { ...args, role: "assistant" });
  await ctx.scheduler.runAfter(0, internal.pipeline.embedReply, { messageId });
  if (deliver && args.channel === "telegram") {
    await ctx.scheduler.runAfter(0, internal.pipeline.deliverTelegram, {
      userId: args.userId,
      text: args.text,
    });
  }
}

// Store an embedding for assistant replies too, so they show up in memory search.
export const embedReply = internalAction({
  args: { messageId: v.id("messages") },
  handler: async (ctx, { messageId }) => {
    const message = await ctx.runQuery(internal.pipeline.getMessage, { messageId });
    if (!message) return;
    const embedding = await embed(message.text);
    await ctx.runMutation(internal.pipeline.setEmbedding, { messageId, embedding });
  },
});

export const deliverTelegram = internalAction({
  args: { userId: v.id("users"), text: v.string(), voice: v.optional(v.object({ heard: v.string(), speak: v.string() })) },
  handler: async (ctx, { userId, text, voice }): Promise<void> => {
    const user: Doc<"users"> | null = await ctx.runQuery(internal.pipeline.getUser, { userId });
    const chatId = user?.telegramChatId;
    if (!chatId) return;
    if (!voice) {
      await sendTelegram(chatId, text);
      return;
    }
    // Quote what we heard, so a mistranscription is easy to spot, then follow the text with a voice note.
    await sendTelegram(chatId, `${heardLine(voice.heard)}\n\n${text}`);
    await sendSpokenReply(chatId, voice.speak, langOf(user));
  },
});

function heardLine(heard: string) {
  const quote = heard.length > 300 ? `${heard.slice(0, 300).trimEnd()}…` : heard;
  return `🎙️ _“${quote.replace(/[_*`]/g, "")}”_`;
}

// Cartesia speaks the reply and it goes out as a Telegram voice note. The text is already sent, so a failure
// here only costs the audio.
async function sendSpokenReply(chatId: string, markdown: string, language: Lang) {
  const transcript = toSpeech(markdown, undefined, language);
  if (!transcript) return;
  try {
    void sendChatAction(chatId, "record_voice").catch(() => {});
    const mp3 = await (await synthesizeMp3(transcript, language)).arrayBuffer();
    // At 128 kbps, 16,000 bytes is one second.
    await sendVoice(chatId, new Blob([mp3], { type: "audio/mpeg" }), Math.max(1, Math.round(mp3.byteLength / 16_000)));
  } catch (e) {
    console.error("voice reply failed", e);
  }
}

export const getUser = internalQuery({
  args: { userId: v.id("users") },
  handler: (ctx, { userId }) => ctx.db.get(userId),
});

// Per-user cap on messages to the model (app + Telegram combined), over a rolling 24 hours.
export const DAILY_LIMIT = 100;
const DAY_MS = 24 * 60 * 60 * 1000;
export const LIMIT_REPLY = t("en", "limit", DAILY_LIMIT);
export const limitReply = (lang: Lang) => t(lang, "limit", DAILY_LIMIT);

export async function overDailyLimit(ctx: MutationCtx, userId: Id<"users">) {
  const recent = await ctx.db
    .query("messages")
    .withIndex("by_user", (q) => q.eq("userId", userId).gte("_creationTime", Date.now() - DAY_MS))
    .filter((q) => q.eq(q.field("role"), "user"))
    .take(DAILY_LIMIT);
  return recent.length >= DAILY_LIMIT;
}

// Insert a user message and kick off the pipeline. Shared by app + Telegram entry points.
// Returns null (and stores nothing) when the user is over the daily limit.
export async function enqueueUserMessage(
  ctx: MutationCtx,
  userId: Id<"users">,
  text: string,
  ch: "app" | "telegram",
  voice = false, // a transcribed Telegram voice note
  image?: Id<"_storage">, // a photo sent with it
) {
  if (await overDailyLimit(ctx, userId)) return null;
  const messageId = await insertMessage(ctx, {
    userId,
    role: "user",
    text,
    channel: ch,
    ...(voice && { voice }),
    ...(image && { image }),
  });
  await ctx.scheduler.runAfter(0, internal.pipeline.respond, { messageId });
  return messageId;
}

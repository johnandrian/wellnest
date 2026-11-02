// The shared message pipeline for every channel (app + Telegram):
// Jev routes + triages -> embed -> vector search memory -> proactive shopper -> core model with tools -> reply.
import { v } from "convex/values";
import { ActionCtx, internalAction, internalMutation, internalQuery, MutationCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import { Doc, Id } from "./_generated/dataModel";
import { ChatMessage, complete, CORE_MODEL, imageDataUrl, VISION_MODEL } from "./lib/cortex";
import { embed } from "./lib/jina";
import { analyzeSymptomsTool, factTools, healthDataTool, journalTools, reminderTools, runTool, saveLocationTool, toolDefs, visitSummaryTool } from "./lib/tools";
import { journalText } from "./lib/journal";
import { biosensorText, cycleSummary, dateDaysAgo, HealthDay, healthReport } from "./lib/health";
import { parseInputs } from "./lib/creao";
import { NO_ROUTE, Route, route } from "./lib/jev";
import { shopTurn } from "./shop";
import { sendChatAction, sendTelegram, sendTyping, sendVoice } from "./lib/telegram";
import { synthesizeMp3 } from "./lib/cartesia";
import { toSpeech } from "./lib/speech";
import { channel } from "./schema";
import { Lang, langOf, languagePrompt, t } from "./lib/language";

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
Then help them find nearby urgent care or an ER: if you know their location, use web_search to list a few nearby options; if not, ask for their city/zip (and save it with save_location).`;

const OFFER_ANALYSIS_PROMPT = `Answer briefly, then offer a detailed symptom analysis by the CREAO symptom analyzer: it ranks the most likely conditions with reasoning and care guidance, takes a few minutes, and sends what the user has told you to that service. Ask them to reply yes if they want it. Don't run it yourself.`;

const PHOTO_PROMPT = `The user attached a photo. Look at it carefully and say briefly what you see before answering.
- Labels, pill bottles, prescriptions, lab results: read the text exactly; if part is unreadable, say so rather than guessing a name or dose.
- Skin, rashes, wounds, eyes, swelling: describe what's visible, but you can't diagnose from a photo. Say what would make it urgent (spreading redness, fever, severe pain, trouble breathing...) and when to see a clinician.
- Never try to identify people in photos.`;

const HEALTH_PROMPT = `The user connected Apple Health. When their metrics could help (tiredness, sleep, possible illness, heart rate, their cycle), call get_health_data and mention the specific numbers that matter. Don't recite numbers that aren't relevant, and don't diagnose from them.`;

const HEALTH_IN_ANALYSIS_PROMPT = `The user has agreed to include their Apple Health summaries in symptom analyses; they're added to it automatically.`;

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
      const facts: string[] = await ctx.runQuery(internal.me.factsFor, { userId });

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
        facts,
        journal: async (name, rawArgs) => {
          const args = parseArgs(rawArgs);
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
          return journalText(entries, await healthDays(ctx, userId, Math.min(days, 90)));
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
  facts: string[];
  fact: (name: string, rawArgs: string) => Promise<string>;
  journal: (name: string, rawArgs: string) => Promise<string>;
  reminder: (name: string, rawArgs: string) => Promise<string>;
  prepareVisit: (rawArgs: string) => Promise<string>;
  healthConnected: boolean;
  healthInAnalysis: boolean;
  getHealthData: (days: number) => Promise<string>;
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
  if (opts.medications) system.push(`Medication reminders the user has set up:
${opts.medications}`);
  if (memory.length) {
    system.push(
      "Relevant past messages:\n" + memory.map((m) => `- [${m.role}] ${m.text}`).join("\n"),
    );
  }
  if (opts.healthConnected) system.push(HEALTH_PROMPT);
  if (opts.image) system.push(PHOTO_PROMPT);
  if (urgent) system.push(URGENT_PROMPT);
  if (analysis === "offer") system.push(OFFER_ANALYSIS_PROMPT);
  if (analysis !== "none" && opts.healthInAnalysis) system.push(HEALTH_IN_ANALYSIS_PROMPT);
  if (analysis === "run") system.push(RUN_ANALYSIS_PROMPT);
  if (opts.linksShown) system.push(LINKS_PROMPT);
  const tools = [
    ...toolDefs,
    saveLocationTool,
    visitSummaryTool,
    ...reminderTools,
    ...factTools,
    ...journalTools,
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
      } else if (call.function.name === "log_symptom" || call.function.name === "get_symptom_journal") {
        result = await opts.journal(call.function.name, call.function.arguments).catch((e) => `Tool error: ${(e as Error).message}`);
      } else if (call.function.name === "remember_fact" || call.function.name === "forget_fact") {
        result = await opts.fact(call.function.name, call.function.arguments).catch((e) => `Tool error: ${(e as Error).message}`);
      } else if (call.function.name === "set_medication_reminder" || call.function.name === "cancel_medication_reminder") {
        result = await opts.reminder(call.function.name, call.function.arguments).catch((e) => `Tool error: ${(e as Error).message}`);
      } else if (call.function.name === "prepare_visit_summary") {
        result = await opts.prepareVisit(call.function.arguments).catch((e) => `Tool error: ${(e as Error).message}`);
      } else if (call.function.name === "get_health_data") {
        result = !opts.healthConnected
          ? "Tool error: the user hasn't connected Apple Health."
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
    const clearedAt = (await ctx.db.get(userId))?.chatClearedAt ?? 0;
    return (
      await ctx.db
        .query("messages")
        .withIndex("by_user", (q) => q.eq("userId", userId).gt("_creationTime", clearedAt))
        .order("desc")
        .take(limit)
    ).reverse();
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
    channel,
    urgent: v.boolean(),
    heard: v.optional(v.string()), // the transcript, when the user asked by Telegram voice note
  },
  handler: async (ctx, { extra, heard, ...args }) => {
    // Two messages in the app; one Telegram message so they can't arrive out of order.
    await saveAssistantReply(ctx, args, false);
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
  args: { userId: Id<"users">; text: string; channel: "app" | "telegram"; urgent: boolean; kind?: "links" },
  deliver = true,
) {
  const messageId = await ctx.db.insert("messages", { ...args, role: "assistant" });
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
  const messageId = await ctx.db.insert("messages", {
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

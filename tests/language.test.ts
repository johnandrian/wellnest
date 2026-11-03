import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api } from "../convex/_generated/api";
import { toSpeech } from "../convex/lib/speech";
import { languagePrompt, t as text } from "../convex/lib/language";
import { LANGUAGE_NAMES, strings } from "../src/i18n";
import { Call, cortexCalls, createAppUser, drain, messagesOf, mockApis, setEnv, setup, telegramSends } from "./helpers";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(Date.parse("2026-11-02T18:00:00Z"));
  setEnv();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

const ttsCalls = (calls: Call[]) => calls.filter((c) => c.url === "https://api.cartesia.ai/tts/bytes");
const sttCalls = (calls: Call[]) => calls.filter((c) => c.url === "https://api.cartesia.ai/stt");
const CHAT = 999;
function post(t: ReturnType<typeof setup>, message: object, from: object = {}) {
  return t.fetch("/telegram", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Telegram-Bot-Api-Secret-Token": "s3cret" },
    body: JSON.stringify({ message: { chat: { id: CHAT, type: "private" }, from: { first_name: "Ana", ...from }, ...message } }),
  });
}
const tgUser = (t: ReturnType<typeof setup>) =>
  t.run((ctx) => ctx.db.query("users").withIndex("by_telegram", (q) => q.eq("telegramChatId", String(CHAT))).unique());

describe("language setting", () => {
  test("defaults to English; the model gets no language line", async () => {
    const t = setup();
    const { calls } = mockApis();
    const { as } = await createAppUser(t);
    expect((await as.query(api.chat.me))!.language).toBe("en");
    await as.mutation(api.chat.send, { text: "hi" });
    await drain(t);
    expect(cortexCalls(calls)[0].body.messages[0].content).not.toContain("The user's language");
  });

  test("Spanish: the model is told to reply in Spanish, and voice tokens carry the language", async () => {
    const t = setup();
    const { calls } = mockApis({ core: [{ content: "Descansa y toma agua." }] });
    const { as } = await createAppUser(t);
    await as.mutation(api.chat.setLanguage, { language: "es" });
    await as.mutation(api.chat.send, { text: "me duele la cabeza" });
    await drain(t);
    expect(cortexCalls(calls)[0].body.messages[0].content).toContain("The user's language is Spanish (Español). Reply in Spanish");
    expect(await as.action(api.voice.token, {})).toMatchObject({ language: "es", voiceId: "db6b0ed5-d5d3-463d-ae85-518a07d3c2b4" });
  });

  test("a language can have its own Sonic voice", async () => {
    vi.stubEnv("CARTESIA_VOICE_ID_EL", "voice_greek");
    const t = setup();
    mockApis();
    const { as } = await createAppUser(t);
    await as.mutation(api.chat.setLanguage, { language: "el" });
    expect(await as.action(api.voice.token, {})).toMatchObject({ language: "el", voiceId: "voice_greek" });
  });

  test("/tts speaks in the user's language", async () => {
    const t = setup();
    const { calls } = mockApis();
    const { userId, as } = await createAppUser(t);
    await as.mutation(api.chat.setLanguage, { language: "el" });
    const id = await t.run((ctx) => ctx.db.insert("messages", { userId, role: "assistant", text: "Ξεκουράσου.", channel: "app" }));
    expect((await as.fetch(`/tts?message=${id}`)).status).toBe(200);
    expect(ttsCalls(calls)[0].body).toMatchObject({ language: "el", transcript: "Ξεκουράσου." });
  });

  test("reminders and the pipeline's failure message follow the language", async () => {
    const t = setup();
    mockApis({ core: [new Error("down")] });
    const { userId, as } = await createAppUser(t);
    await as.mutation(api.chat.setLanguage, { language: "es" });
    await as.mutation(api.chat.setTimeZone, { timeZone: "America/Los_Angeles", utcOffsetMin: -480 });
    await as.mutation(api.chat.send, { text: "hola" });
    await t.finishAllScheduledFunctions(() => vi.advanceTimersByTime(1));
    expect((await messagesOf(t, userId)).at(-1)!.text).toBe(text("es", "failed"));

    await as.mutation(api.reminders.add, { name: "Ibuprofeno", dose: "400 mg", schedule: { kind: "daily", times: ["20:00"] } });
    vi.advanceTimersByTime(10 * 3_600_000);
    await t.finishAllScheduledFunctions(() => vi.advanceTimersByTime(1));
    const reminder = (await messagesOf(t, userId)).find((m) => m.kind === "reminder")!;
    expect(reminder.text).toMatch(/^💊 Es hora de tu \*\*Ibuprofeno\*\* \(400 mg\)\. Toca a las 8:00\s?p\.\s?m\.\.$/);
  });

  test("visit summaries are written in the user's language", async () => {
    const t = setup();
    const { calls } = mockApis({ core: [{ content: "# Resumen" }] });
    const { as } = await createAppUser(t);
    await as.mutation(api.chat.setLanguage, { language: "el" });
    await as.mutation(api.visit.create, {});
    await drain(t);
    expect(cortexCalls(calls).at(-1)!.body.messages[0].content).toContain("Write the whole summary, headings included, in Greek.");
  });
});

describe("language on Telegram", () => {
  test("a new user starts in their Telegram language when Wellnest speaks it", async () => {
    const t = setup();
    const { calls } = mockApis({ core: [{ content: "Hola" }] });
    await post(t, { text: "hola" }, { language_code: "es-419" });
    await drain(t);
    expect((await tgUser(t))!.language).toBe("es");
    expect(cortexCalls(calls)[0].body.messages[0].content).toContain("Reply in Spanish");
  });

  test("Chinese: a Telegram user in zh-hans starts in Chinese, and /language zh confirms in Chinese", async () => {
    const t = setup();
    const { calls } = mockApis({ core: [{ content: "你好" }] });
    await post(t, { text: "你好" }, { language_code: "zh-hans" });
    await drain(t);
    expect((await tgUser(t))!.language).toBe("zh");
    expect(cortexCalls(calls)[0].body.messages[0].content).toContain("The user's language is Simplified Chinese (简体中文). Reply in Simplified Chinese");
    await post(t, { text: "/language zh" });
    await drain(t);
    expect(telegramSends(calls).at(-1)!.body.text).toBe("好的，我会用中文回复你。");
  });

  test("unsupported Telegram languages fall back to English", async () => {
    const t = setup();
    mockApis();
    await post(t, { text: "salut" }, { language_code: "fr" });
    await drain(t);
    expect((await tgUser(t))!.language).toBeUndefined();
  });

  test("/language switches it, and voice notes are transcribed and spoken in it", async () => {
    const t = setup();
    const { calls } = mockApis({ cartesiaStt: "Έχω πονοκέφαλο", core: [{ content: "Ξεκουράσου." }] });
    await post(t, { text: "/language el" });
    await drain(t);
    expect((await tgUser(t))!.language).toBe("el");
    expect(telegramSends(calls).at(-1)!.body.text).toBe("Εντάξει, θα σου απαντώ στα ελληνικά.");

    await post(t, { voice: { file_id: "v1", file_unique_id: "u1", duration: 3, mime_type: "audio/ogg" } });
    await drain(t);
    expect((sttCalls(calls)[0].init!.body as FormData).get("language")).toBe("el");
    expect(ttsCalls(calls)[0].body).toMatchObject({ language: "el" });
  });

  test("/language with no or an unknown code lists the choices", async () => {
    const t = setup();
    const { calls } = mockApis();
    await post(t, { text: "/language klingon" });
    await drain(t);
    expect(telegramSends(calls).at(-1)!.body.text).toContain("/language es (Español)");
    expect((await tgUser(t))!.language).toBeUndefined();
  });

  test("the daily limit reply is in the user's language", async () => {
    const t = setup();
    const { calls } = mockApis();
    await post(t, { text: "/language es" });
    await drain(t);
    const user = (await tgUser(t))!;
    await t.run(async (ctx) => {
      for (let i = 0; i < 100; i++) await ctx.db.insert("messages", { userId: user._id, role: "user", text: `m${i}`, channel: "telegram" });
    });
    await post(t, { text: "otra pregunta" });
    await drain(t);
    expect(telegramSends(calls).at(-1)!.body.text).toBe(text("es", "limit", 100));
  });
});

describe("language helpers", () => {
  test("cut-short speech ends with a note in the reply's language", () => {
    const long = "Una frase. ".repeat(400);
    expect(toSpeech(long, 100, "es").endsWith("El resto está en el texto.")).toBe(true);
    expect(toSpeech(long, 100).endsWith("The rest is in the text.")).toBe(true);
    expect(toSpeech("Hola.\n\nFuentes:\n[CDC](https://cdc.gov)", 2500, "es")).toBe("Hola. CDC.");
  });

  test("prompt lines and app strings", () => {
    expect(languagePrompt("en")).toBeNull();
    expect(languagePrompt("el")).toContain("Greek (Ελληνικά)");
    expect(strings("el").welcome).toBe("Πώς νιώθεις;");
    expect(strings("xx").welcome).toBe("How are you feeling?");
    expect(strings("es").starters).toHaveLength(4);
    expect(strings("zh").welcome).toBe("你感觉怎么样？");
    expect(LANGUAGE_NAMES.zh).toBe("简体中文");
  });

  test("every fixed backend message has Chinese", () => {
    expect(text("zh", "reminder", "布洛芬", "400 毫克", "20:00")).toBe("💊 该服用 **布洛芬**（400 毫克）了。时间：20:00。");
    expect(text("zh", "lowSupply", "布洛芬", 3)).toBe("💊 你的 **布洛芬** 快用完了：大约还剩 3 天。是时候续药了。");
    expect(text("zh", "limit", 100)).toContain("911");
  });
});

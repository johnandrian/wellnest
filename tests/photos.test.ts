import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api } from "../convex/_generated/api";
import { Id } from "../convex/_generated/dataModel";
import { DAILY_LIMIT } from "../convex/pipeline";
import { imageDataUrl } from "../convex/lib/cortex";
import { cortexCalls, createAppUser, drain, messagesOf, mockApis, setEnv, setup, telegramSends } from "./helpers";

beforeEach(() => {
  vi.useFakeTimers();
  setEnv();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);

const store = (t: ReturnType<typeof setup>, type = "image/png", bytes: Uint8Array = PNG) =>
  t.run((ctx) => ctx.storage.store(new Blob([bytes], { type })));

// The last user turn the core model got.
const lastUserContent = (calls: any[]) => cortexCalls(calls).at(-1)!.body.messages.at(-1).content;

describe("photos from the app", () => {
  test("an uploaded photo goes to the model as an image with the question, and the app shows it", async () => {
    const t = setup();
    const { calls } = mockApis({ core: [{ content: "That label says ibuprofen 200 mg." }] });
    const { userId, as } = await createAppUser(t);
    const storageId = await store(t);
    await as.mutation(api.chat.claimUpload, { storageId });
    await as.mutation(api.chat.send, { text: "what is this pill?", imageId: storageId });
    await drain(t);

    expect(lastUserContent(calls)).toEqual([
      { type: "text", text: "what is this pill?" },
      { type: "image_url", image_url: { url: `data:image/png;base64,${btoa(String.fromCharCode(...PNG))}` } },
    ]);
    expect(cortexCalls(calls).at(-1)!.body.messages[0].content).toContain("The user attached a photo");
    const listed = await as.query(api.chat.list);
    expect(listed[0]).toMatchObject({ role: "user", text: "what is this pill?", imageUrl: expect.stringContaining("http") });
    expect(listed[0]).not.toHaveProperty("image");
    expect((await messagesOf(t, userId))[0].image).toBe(storageId);
  });

  test("a photo with no text still sends; later turns mention it without resending the image", async () => {
    const t = setup();
    const { calls } = mockApis({ core: [{ content: "Looks like a mild rash." }, { content: "Keep an eye on it." }] });
    const { as } = await createAppUser(t);
    const storageId = await store(t, "image/jpeg");
    await as.mutation(api.chat.claimUpload, { storageId });
    await as.mutation(api.chat.send, { text: "  ", imageId: storageId });
    await drain(t);
    expect(lastUserContent(calls)[0]).toEqual({ type: "text", text: "(no message, just the photo)" });

    await as.mutation(api.chat.send, { text: "is it getting worse?" });
    await drain(t);
    const msgs = cortexCalls(calls).at(-1)!.body.messages;
    expect(msgs.at(-1).content).toBe("is it getting worse?");
    expect(msgs.some((m: any) => m.content === "[sent a photo]")).toBe(true);
    expect(JSON.stringify(msgs)).not.toContain("base64");
    expect(cortexCalls(calls).at(-1)!.body.messages[0].content).not.toContain("The user attached a photo");
  });

  test("CORTEX_VISION_MODEL is used only for turns with a photo", async () => {
    const t = setup();
    vi.stubEnv("CORTEX_VISION_MODEL", "claude-sonnet-4-5");
    const { calls } = mockApis({ core: [{ content: "a" }, { content: "b" }] });
    const { as } = await createAppUser(t);
    const storageId = await store(t);
    await as.mutation(api.chat.claimUpload, { storageId });
    await as.mutation(api.chat.send, { text: "look", imageId: storageId });
    await drain(t);
    await as.mutation(api.chat.send, { text: "thanks" });
    await drain(t);
    expect(cortexCalls(calls).map((c) => c.body.model)).toEqual(["claude-sonnet-4-5", "openai-gpt-5.4"]);
  });

  test("someone else's upload, an unclaimed one, or one used twice is refused", async () => {
    const t = setup();
    mockApis();
    const a = await createAppUser(t, "a@example.com");
    const b = await createAppUser(t, "b@example.com");
    const storageId = await store(t);
    await expect(a.as.mutation(api.chat.send, { text: "x", imageId: storageId })).rejects.toThrow(/didn't upload/);
    await a.as.mutation(api.chat.claimUpload, { storageId });
    await expect(b.as.mutation(api.chat.claimUpload, { storageId })).rejects.toThrow(/Not found/);
    await expect(b.as.mutation(api.chat.send, { text: "x", imageId: storageId })).rejects.toThrow(/didn't upload/);
    await a.as.mutation(api.chat.send, { text: "x", imageId: storageId });
    await expect(a.as.mutation(api.chat.send, { text: "again", imageId: storageId })).rejects.toThrow(/didn't upload/);
  });

  test("non-images are refused", async () => {
    const t = setup();
    mockApis();
    const { as } = await createAppUser(t);
    const storageId = await store(t, "application/pdf");
    await as.mutation(api.chat.claimUpload, { storageId });
    await expect(as.mutation(api.chat.send, { text: "x", imageId: storageId })).rejects.toThrow(/JPEG or PNG/);
  });

  test("upload URLs need sign-in", async () => {
    const t = setup();
    await expect(t.mutation(api.chat.generateUploadUrl, {})).rejects.toThrow(/Not signed in/);
  });

  test("imageDataUrl handles images larger than one chunk", async () => {
    const big = new Uint8Array(100_000).map((_, i) => i % 256);
    const url = await imageDataUrl(new Blob([big], { type: "image/jpeg" }));
    expect(url.startsWith("data:image/jpeg;base64,")).toBe(true);
    expect(atob(url.split(",")[1]).length).toBe(100_000);
  });
});

describe("photos on Telegram", () => {
  const CHAT = 777;
  function post(t: ReturnType<typeof setup>, message: object) {
    return t.fetch("/telegram", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Telegram-Bot-Api-Secret-Token": "s3cret" },
      body: JSON.stringify({ message: { chat: { id: CHAT, type: "private" }, from: { first_name: "Sam" }, ...message } }),
    });
  }
  const sizes = [
    { file_id: "small", width: 90, height: 90, file_size: 1000 },
    { file_id: "medium", width: 1280, height: 960, file_size: 200_000 },
    { file_id: "huge", width: 4000, height: 3000, file_size: 3_000_000 },
  ];
  const userOf = (t: ReturnType<typeof setup>) =>
    t.run((ctx) => ctx.db.query("users").withIndex("by_telegram", (q) => q.eq("telegramChatId", String(CHAT))).unique());

  test("the largest size up to 1600px is downloaded, stored and answered with the caption", async () => {
    const t = setup();
    const { calls } = mockApis({ core: [{ content: "That's amoxicillin 500 mg." }] });
    expect((await post(t, { photo: sizes, caption: "what's this?" })).status).toBe(200);
    await drain(t);

    const getFile = calls.find((c) => c.url.endsWith("/getFile"));
    expect(getFile?.body.file_id).toBe("medium");
    const user = await userOf(t);
    const [msg] = await messagesOf(t, user!._id);
    expect(msg).toMatchObject({ role: "user", text: "what's this?", channel: "telegram" });
    expect(msg.image).toBeDefined();
    const meta = await t.run((ctx) => ctx.db.system.get("_storage", msg.image as Id<"_storage">));
    expect(meta?.contentType).toBe("image/jpeg");
    expect(lastUserContent(calls)[1].image_url.url.startsWith("data:image/jpeg;base64,")).toBe(true);
    expect(telegramSends(calls).at(-1)!.body.text).toContain("amoxicillin");
  });

  test("an image sent as a file works; other files are ignored", async () => {
    const t = setup();
    const { calls } = mockApis();
    await post(t, { document: { file_id: "doc_1", mime_type: "application/pdf", file_size: 100 } });
    await drain(t);
    expect(calls).toHaveLength(0);
    await post(t, { document: { file_id: "doc_2", mime_type: "image/png", file_size: 100 } });
    await drain(t);
    expect(calls.find((c) => c.url.endsWith("/getFile"))?.body.file_id).toBe("doc_2");
  });

  test("too large, or over the daily limit: refused before downloading", async () => {
    const t = setup();
    const { calls } = mockApis();
    await post(t, { document: { file_id: "big", mime_type: "image/jpeg", file_size: 20_000_000 } });
    await drain(t);
    expect(calls.some((c) => c.url.endsWith("/getFile"))).toBe(false);
    expect(telegramSends(calls).at(-1)!.body.text).toMatch(/under 8 MB/);

    const user = await userOf(t);
    await t.run(async (ctx) => {
      for (let i = 0; i < DAILY_LIMIT; i++) await ctx.db.insert("messages", { userId: user!._id, role: "user", text: `m${i}`, channel: "telegram" });
    });
    await post(t, { photo: sizes });
    await drain(t);
    expect(calls.some((c) => c.url.endsWith("/getFile"))).toBe(false);
    expect(telegramSends(calls).at(-1)!.body.text).toMatch(/today's limit/);
  });

  test("a download failure gets a friendly reply", async () => {
    const t = setup();
    const { calls } = mockApis({ telegramFileGone: true });
    await post(t, { photo: sizes });
    await drain(t);
    expect(telegramSends(calls).at(-1)!.body.text).toMatch(/couldn't open that photo/);
  });
});

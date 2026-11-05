// App/web entry points: send + list messages, user settings.
import { v } from "convex/values";
import { units, unitsOf } from "./lib/units";
import { getAuthUserId } from "@convex-dev/auth/server";
import { mutation, query } from "./_generated/server";
import { DAILY_LIMIT, enqueueUserMessage } from "./pipeline";
import { language } from "./lib/language";
import { refreshSoon } from "./weather";
import { chatMessages, currentChatKey } from "./lib/chats";
import { appearance, TEXT_SIZES } from "./lib/appearance";

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

export const send = mutation({
  // `voice`: asked with the mic (the app reads the reply aloud).
  args: { text: v.string(), imageId: v.optional(v.id("_storage")), voice: v.optional(v.boolean()) },
  handler: async (ctx, { text, imageId, voice }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not signed in");
    const trimmed = text.trim();
    if (!trimmed && !imageId) return { limited: false };
    // A photo must be this user's own unused upload (see claimUpload), and a real image.
    const upload = imageId
      ? await ctx.db.query("photoUploads").withIndex("by_storage", (q) => q.eq("storageId", imageId)).unique()
      : null;
    if (imageId) {
      const file = await ctx.db.system.get("_storage", imageId);
      if (!file || !upload || upload.userId !== userId || upload.messageId || upload.usedFor) {
        throw new Error("That photo didn't upload. Please try again.");
      }
      if (!file.contentType?.startsWith("image/") || file.size > MAX_IMAGE_BYTES) {
        throw new Error("Please send a JPEG or PNG photo under 8 MB.");
      }
    }
    const messageId = await enqueueUserMessage(ctx, userId, trimmed.slice(0, 4000), "app", !!voice, imageId);
    if (upload && messageId) await ctx.db.patch(upload._id, { messageId });
    return { limited: messageId === null, limit: DAILY_LIMIT };
  },
});

// A one-time upload URL for a photo; the app then claims the stored file with claimUpload before sending.
export const generateUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not signed in");
    return await ctx.storage.generateUploadUrl();
  },
});

// Ties an uploaded file to its uploader, so nobody can send someone else's upload by its id.
export const claimUpload = mutation({
  args: { storageId: v.id("_storage") },
  handler: async (ctx, { storageId }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not signed in");
    const existing = await ctx.db.query("photoUploads").withIndex("by_storage", (q) => q.eq("storageId", storageId)).unique();
    if (existing) {
      if (existing.userId !== userId) throw new Error("Not found");
      return;
    }
    if (!(await ctx.db.system.get("_storage", storageId))) throw new Error("Not found");
    await ctx.db.insert("photoUploads", { userId, storageId });
  },
});

// The current chat's messages, including ones sent on Telegram.
export const list = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    const user = userId ? await ctx.db.get(userId) : null;
    if (!user) return [];
    const messages = await chatMessages(ctx, user, await currentChatKey(ctx, user))
      .order("desc")
      .take(100);
    return await Promise.all(
      messages.reverse().map(async ({ embedding, image, ...m }) => ({
        ...m,
        imageUrl: image ? await ctx.storage.getUrl(image) : null,
      })),
    );
  },
});

export const me = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;
    const user = await ctx.db.get(userId);
    if (!user || user.deleting) return null;
    return {
      email: user.email ?? null,
      language: user.language ?? "en",
      appearance: user.appearance ?? { theme: "system" as const, textSize: 1 },
      notifications: { reminders: user.notifications?.reminders ?? true, appointments: user.notifications?.appointments ?? true },
      onboarded: !!user.onboardedAt,
      toured: !!user.touredAt,
      name: user.profile?.name ?? null,
      focus: user.focus ?? [],
      checkins: user.checkins ?? true,
      weeklySummary: user.weeklySummary ?? true,
      flareForecast: user.flareForecast ?? true,
      units: unitsOf(user),
      location: user.location ?? "",
      telegramLinked: !!user.telegramChatId,
    };
  },
});

// Start a fresh conversation (see users.chatClearedAt).
export const clear = mutation({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not signed in");
    await ctx.db.patch(userId, { chatClearedAt: Date.now(), analysisOfferedAt: undefined });
  },
});

export const setAppearance = mutation({
  args: { appearance },
  handler: async (ctx, { appearance }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not signed in");
    if (!TEXT_SIZES.includes(appearance.textSize)) throw new Error("Pick one of the text sizes.");
    await ctx.db.patch(userId, { appearance });
  },
});

export const setUnits = mutation({
  args: { units },
  handler: async (ctx, { units }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not signed in");
    await ctx.db.patch(userId, { units });
  },
});

export const setLanguage = mutation({
  args: { language },
  handler: async (ctx, { language }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not signed in");
    await ctx.db.patch(userId, { language });
  },
});

// The app reports its time zone on start, so medication reminders fire at local times.
export const setTimeZone = mutation({
  args: { timeZone: v.string(), utcOffsetMin: v.number() },
  handler: async (ctx, { timeZone, utcOffsetMin }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not signed in");
    const user = await ctx.db.get(userId);
    const zone = timeZone.slice(0, 64);
    const offset = Math.max(-14 * 60, Math.min(14 * 60, Math.round(utcOffsetMin)));
    if (user?.timeZone === zone && user.utcOffsetMin === offset) return;
    await ctx.db.patch(userId, { timeZone: zone, utcOffsetMin: offset });
  },
});

export const setLocation = mutation({
  args: { location: v.string() },
  handler: async (ctx, { location }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not signed in");
    const trimmed = location.trim().slice(0, 200);
    await ctx.db.patch(userId, { location: trimmed || undefined });
    if (trimmed) await refreshSoon(ctx, userId);
  },
});

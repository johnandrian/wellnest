import { httpRouter } from "convex/server";
import { registerStaticRoutes } from "@convex-dev/static-hosting";
import { httpAction } from "./_generated/server";
import { components, internal } from "./_generated/api";
import { auth } from "./auth";
import { ttsStream } from "./voice";
import { serve } from "./share";

const http = httpRouter();
auth.addHttpRoutes(http);

// Telegram webhook. Register with:
// curl "https://api.telegram.org/bot<TOKEN>/setWebhook?url=<CONVEX_SITE_URL>/telegram&secret_token=<TELEGRAM_WEBHOOK_SECRET>"
http.route({
  path: "/telegram",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    // Fail closed: reject everything unless the secret is set and matches.
    const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
    const given = req.headers.get("X-Telegram-Bot-Api-Secret-Token") ?? "";
    if (!secret || !safeEqual(given, secret)) {
      return new Response("forbidden", { status: 403 });
    }
    const update = await req.json();
    const cb = update.callback_query;
    if (cb?.data && cb.message?.chat?.type === "private") {
      await ctx.runMutation(internal.telegram.handleLinkDecision, {
        chatId: String(cb.message.chat.id),
        callbackId: String(cb.id),
        messageId: cb.message.message_id,
        data: String(cb.data),
      });
      return new Response("ok");
    }
    const msg = update.message;
    // Only private chats; always 200 so Telegram doesn't retry.
    if (msg?.chat?.type === "private") {
      const chatId = String(msg.chat.id);
      const name = [msg.from?.first_name, msg.from?.last_name].filter(Boolean).join(" ") || undefined;
      // A voice note, or an audio file sent to the bot.
      const audio = msg.voice ?? msg.audio;
      // A photo (Telegram sends several sizes, smallest first), or an image sent as a file.
      const photo = pickPhoto(msg);
      if (msg.text) {
        await ctx.runMutation(internal.telegram.handleIncoming, {
          chatId,
          text: msg.text,
          name,
          languageCode: typeof msg.from?.language_code === "string" ? msg.from.language_code : undefined,
        });
      } else if (typeof audio?.file_id === "string") {
        await ctx.runMutation(internal.telegram.handleVoice, {
          chatId,
          name,
          fileId: audio.file_id,
          duration: Number(audio.duration) || 0,
          mimeType: typeof audio.mime_type === "string" ? audio.mime_type : undefined,
        });
      } else if (photo) {
        await ctx.runMutation(internal.telegram.handlePhoto, {
          chatId,
          name,
          fileId: photo.fileId,
          size: photo.size,
          caption: typeof msg.caption === "string" ? msg.caption : "",
        });
      } else if (msg.location) {
        await ctx.runMutation(internal.telegram.saveSharedLocation, {
          chatId,
          name,
          lat: msg.location.latitude,
          lon: msg.location.longitude,
        });
      }
    }
    return new Response("ok");
  }),
});

// CREAO run-finished webhook. The URL carries our secret (see lib/creao.ts webhookUrl); the body is only used to
// find the run, and the result is re-fetched from CREAO. Always 200 for a valid secret so CREAO doesn't retry.
http.route({
  path: "/creao",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    const secret = process.env.CREAO_WEBHOOK_SECRET;
    const given = new URL(req.url).searchParams.get("token") ?? "";
    if (!secret || !safeEqual(given, secret)) {
      return new Response("forbidden", { status: 403 });
    }
    const body = await req.json().catch(() => null);
    if (typeof body?.runId === "string" && body.runId) {
      await ctx.runMutation(internal.creao.webhookReceived, { runId: body.runId });
    }
    return new Response("ok");
  }),
});

// Streamed MP3 of one of the caller's replies, for voice mode on iOS/Android (see voice.ts).
http.route({ path: "/tts", method: "GET", handler: ttsStream });

// Read-only share links for carers and doctors (see share.ts).
http.route({ pathPrefix: "/share/", method: "GET", handler: serve });

// The Expo web app (uploaded with `npm run deploy:web`). Registered last: exact routes above win over this catch-all.
registerStaticRoutes(http, components.staticHosting);

function safeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export default http;

// The largest photo size up to 1600px wide (plenty to read a label, and small enough to send to the model).
function pickPhoto(msg: any): { fileId: string; size: number } | null {
  if (Array.isArray(msg.photo) && msg.photo.length) {
    const sizes = msg.photo.filter((p: any) => typeof p?.file_id === "string");
    const fit = sizes.filter((p: any) => Number(p.width) <= 1600);
    const best = fit.at(-1) ?? sizes[0];
    return best ? { fileId: best.file_id, size: Number(best.file_size) || 0 } : null;
  }
  const doc = msg.document;
  if (typeof doc?.file_id === "string" && /^image\/(jpeg|png|webp)$/.test(String(doc.mime_type))) {
    return { fileId: doc.file_id, size: Number(doc.file_size) || 0 };
  }
  return null;
}

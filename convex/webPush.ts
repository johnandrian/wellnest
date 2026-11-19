"use node";
// Web Push for browsers that turned notifications on (src/push.web.ts, public/sw.js), signed with the VAPID keys in
// WEB_PUSH_PUBLIC_KEY and WEB_PUSH_PRIVATE_KEY. Without them nothing is sent. Subscriptions the push service says
// are gone (404, 410) are forgotten.
import { v } from "convex/values";
import webpush from "web-push";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { appUrl } from "./lib/links";

export const send = internalAction({
  args: {
    subs: v.array(v.object({ endpoint: v.string(), p256dh: v.string(), auth: v.string() })),
    title: v.string(),
    body: v.string(),
    data: v.record(v.string(), v.string()),
  },
  handler: async (ctx, { subs, ...message }) => {
    const publicKey = process.env.WEB_PUSH_PUBLIC_KEY;
    const privateKey = process.env.WEB_PUSH_PRIVATE_KEY;
    if (!publicKey || !privateKey) return;
    // The contact the push services may use: a mailto: or https address.
    const subject = process.env.WEB_PUSH_SUBJECT || appUrl() || "https://talktothebeak.health";
    const gone: string[] = [];
    for (const s of subs) {
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, JSON.stringify(message), {
          TTL: 3600,
          vapidDetails: { subject, publicKey, privateKey },
        });
      } catch (e) {
        const status = (e as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) gone.push(s.endpoint);
        else console.error("web push failed", status ?? e);
      }
    }
    if (gone.length) await ctx.runMutation(internal.push.forgetWeb, { endpoints: gone });
  },
});

// Share links for carers and doctors: a private, read-only web page of the sections the user picks, covering the
// last N days whenever it's opened (convex/lib/report.ts). Links have unguessable tokens, can expire, can be turned
// off at any time, and record when they were last opened. Served at /share/<token> (convex/http.ts).
import { v } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";
import { httpAction, internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { internal } from "./_generated/api";
import { buildReport, page, section } from "./lib/report";
import { gather } from "./reports";
import { dateDaysAgo } from "./lib/health";
import { langOf } from "./lib/language";

const DAY_MS = 86_400_000;
export const MAX_ACTIVE = 20;

function newToken() {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

const urlFor = (token: string) => `${(process.env.CONVEX_SITE_URL ?? "").replace(/\/$/, "")}/share/${token}`;

export const create = mutation({
  args: {
    label: v.optional(v.string()),
    sections: v.array(section),
    rangeDays: v.number(),
    expiresInDays: v.union(v.number(), v.null()), // null: until turned off
  },
  handler: async (ctx, { label, sections, rangeDays, expiresInDays }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not signed in");
    const picked = [...new Set(sections)];
    if (!picked.length) throw new Error("Pick at least one section.");
    const now = Date.now();
    const mine = await ctx.db.query("shareLinks").withIndex("by_user", (q) => q.eq("userId", userId)).take(200);
    const active = mine.filter((l) => !l.revokedAt && (!l.expiresAt || l.expiresAt > now));
    if (active.length >= MAX_ACTIVE) throw new Error(`Up to ${MAX_ACTIVE} active links. Turn one off first.`);
    const token = newToken();
    await ctx.db.insert("shareLinks", {
      userId,
      token,
      label: label?.trim().slice(0, 80) || undefined,
      sections: picked,
      rangeDays: Math.min(365, Math.max(1, Math.round(rangeDays))),
      ...(expiresInDays !== null && { expiresAt: now + Math.min(365, Math.max(1, expiresInDays)) * DAY_MS }),
      opens: 0,
    });
    return { url: urlFor(token) };
  },
});

export const list = query({
  args: { now: v.number() },
  handler: async (ctx, { now }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];
    const links = await ctx.db.query("shareLinks").withIndex("by_user", (q) => q.eq("userId", userId)).order("desc").take(50);
    return links.map((l) => ({
      _id: l._id,
      url: urlFor(l.token),
      label: l.label ?? null,
      sections: l.sections,
      rangeDays: l.rangeDays,
      createdAt: l._creationTime,
      expiresAt: l.expiresAt ?? null,
      status: l.revokedAt ? ("off" as const) : l.expiresAt && l.expiresAt <= now ? ("expired" as const) : ("active" as const),
      opens: l.opens,
      lastOpenedAt: l.lastOpenedAt ?? null,
    }));
  },
});

export const revoke = mutation({
  args: { id: v.id("shareLinks") },
  handler: async (ctx, { id }) => {
    const userId = await getAuthUserId(ctx);
    const link = await ctx.db.get(id);
    if (!userId || !link || link.userId !== userId) throw new Error("Not found");
    await ctx.db.patch(id, { revokedAt: Date.now() });
  },
});

// The page for a token, or null when it doesn't exist, is off or has expired.
export const pageFor = internalQuery({
  args: { token: v.string(), now: v.number(), generated: v.string() },
  handler: async (ctx, { token, now, generated }) => {
    const link = await ctx.db.query("shareLinks").withIndex("by_token", (q) => q.eq("token", token)).unique();
    if (!link || link.revokedAt || (link.expiresAt && link.expiresAt <= now)) return null;
    const user = await ctx.db.get(link.userId);
    if (!user || user.deleting) return null;
    const to = dateDaysAgo(now, 0);
    const from = dateDaysAgo(now, link.rangeDays - 1);
    const data = await gather(ctx, link.userId, from, to, link.sections, generated);
    if (link.label) data.title = `${data.title} · ${link.label}`;
    return { id: link._id, html: buildReport(data), lang: langOf(user) };
  },
});

export const opened = internalMutation({
  args: { id: v.id("shareLinks") },
  handler: async (ctx, { id }) => {
    const link = await ctx.db.get(id);
    if (link) await ctx.db.patch(id, { opens: link.opens + 1, lastOpenedAt: Date.now() });
  },
});

const HEADERS = {
  "Content-Type": "text/html; charset=utf-8",
  "Cache-Control": "no-store",
  "X-Robots-Tag": "noindex, nofollow",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  // Static page: no scripts, no outside loads, can't be framed.
  "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; img-src data:; frame-ancestors 'none'",
};

export const serve = httpAction(async (ctx, req) => {
  const token = new URL(req.url).pathname.replace(/^\/share\//, "").replace(/\/$/, "");
  const now = Date.now();
  const generated = new Date(now).toISOString().slice(0, 16).replace("T", " ") + " UTC";
  const result = /^[A-Za-z0-9_-]{20,64}$/.test(token) ? await ctx.runQuery(internal.share.pageFor, { token, now, generated }) : null;
  if (!result) {
    return new Response(page("Link unavailable", "<h1>This link isn't available</h1><p class=\"muted\">It may have expired or been turned off. Ask the person who shared it for a new one.</p>"), { status: 404, headers: HEADERS });
  }
  await ctx.runMutation(internal.share.opened, { id: result.id });
  return new Response(result.html, { headers: HEADERS });
});

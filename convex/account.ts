// The account itself: changing the password from Settings. There's no email service, so the current password is
// the proof; after a change every other device is signed out.
import { v } from "convex/values";
import { getAuthSessionId, getAuthUserId, invalidateSessions, modifyAccountCredentials, retrieveAccount } from "@convex-dev/auth/server";
import { action, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";

export const MIN_PASSWORD = 8;

// The email the password account signs in with.
export const passwordLogin = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    const account = await ctx.db
      .query("authAccounts")
      .withIndex("userIdAndProvider", (q) => q.eq("userId", userId).eq("provider", "password"))
      .unique();
    return account?.providerAccountId ?? null;
  },
});

export const changePassword = action({
  args: { current: v.string(), next: v.string() },
  handler: async (ctx, { current, next }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not signed in");
    if (next.length < MIN_PASSWORD) throw new Error(`The new password needs at least ${MIN_PASSWORD} characters.`);
    if (next === current) throw new Error("The new password is the same as the current one.");
    const email: string | null = await ctx.runQuery(internal.account.passwordLogin, { userId });
    if (!email) throw new Error("This account doesn't sign in with a password.");
    try {
      await retrieveAccount(ctx, { provider: "password", account: { id: email, secret: current } });
    } catch {
      throw new Error("The current password isn't right.");
    }
    await modifyAccountCredentials(ctx, { provider: "password", account: { id: email, secret: next } });
    const sessionId = await getAuthSessionId(ctx);
    await invalidateSessions(ctx, { userId, except: sessionId ? [sessionId] : [] });
    return null;
  },
});

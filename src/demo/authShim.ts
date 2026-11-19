// Stands in for @convex-dev/auth/server when convex/ code runs in the browser for the example dashboard
// (metro.config.js). The demo's fake ctx.auth (./db.ts) says who is signed in.
type Ctx = { auth: { getUserIdentity: () => Promise<{ subject: string } | null> } };

export async function getAuthUserId(ctx: Ctx) {
  const identity = await ctx.auth.getUserIdentity();
  return identity ? (identity.subject.split("|")[0] as never) : null;
}

export const authTables = {};

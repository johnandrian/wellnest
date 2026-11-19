// Changing the password from Settings (convex/account.ts).
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { Scrypt } from "lucia";
import { api } from "../convex/_generated/api";
import { createAppUser, setEnv, setup } from "./helpers";

beforeEach(() => setEnv());
afterEach(() => vi.unstubAllEnvs());

async function withPassword(t: ReturnType<typeof setup>, password: string) {
  const u = await createAppUser(t, "a@example.com");
  const secret = await new Scrypt().hash(password);
  await t.run((ctx) => ctx.db.insert("authAccounts", { userId: u.userId, provider: "password", providerAccountId: "a@example.com", secret }));
  return u;
}

describe("change password", () => {
  test("needs the current password and 8 characters, then signs out the other devices", async () => {
    const t = setup();
    const { userId, as } = await withPassword(t, "old-password");
    const other = await t.run((ctx) => ctx.db.insert("authSessions", { userId, expirationTime: Date.now() + 3_600_000 }));
    await expect(as.action(api.account.changePassword, { current: "old-password", next: "short" })).rejects.toThrow(/at least 8/);
    await expect(as.action(api.account.changePassword, { current: "wrong-password", next: "new-password" })).rejects.toThrow(/current password isn't right/);
    await as.action(api.account.changePassword, { current: "old-password", next: "new-password" });
    const account = (await t.run((ctx) => ctx.db.query("authAccounts").first()))!;
    expect(await new Scrypt().verify(account.secret!, "new-password")).toBe(true);
    expect(await t.run((ctx) => ctx.db.get(other))).toBeNull();
    // This device stays signed in.
    expect(await as.query(api.chat.me)).not.toBeNull();
  });

  test("needs sign-in and a password account", async () => {
    const t = setup();
    await expect(t.action(api.account.changePassword, { current: "a", next: "new-password" })).rejects.toThrow(/Not signed in/);
    const { as } = await createAppUser(t, "b@example.com");
    await expect(as.action(api.account.changePassword, { current: "a", next: "new-password" })).rejects.toThrow(/doesn't sign in with a password/);
  });
});

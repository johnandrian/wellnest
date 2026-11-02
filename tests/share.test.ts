import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api } from "../convex/_generated/api";
import { createAppUser, mockApis, setEnv, setup } from "./helpers";

const NOW = Date.parse("2026-11-02T21:00:00Z");
const DAY = 86_400_000;
const SITE = "https://happy-otter-123.convex.site";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  setEnv();
  vi.stubEnv("CONVEX_SITE_URL", SITE);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

const pathOf = (url: string) => url.replace(SITE, "");

async function withData(t: ReturnType<typeof setup>) {
  mockApis();
  const u = await createAppUser(t);
  await u.as.mutation(api.me.addFact, { text: "Allergic to penicillin" });
  await u.as.mutation(api.reminders.add, { name: "Sertraline", dose: "50 mg", schedule: { kind: "daily", times: ["08:00"] } });
  return u;
}

describe("share links", () => {
  test("a link serves a read-only page of just the chosen sections, with safe headers, and counts opens", async () => {
    const t = setup();
    const { as } = await withData(t);
    const { url } = await as.mutation(api.share.create, { label: "Dr. Lee", sections: ["medications"], rangeDays: 30, expiresInDays: 7 });
    expect(url).toMatch(new RegExp(`^${SITE}/share/[A-Za-z0-9_-]{32}$`));
    const res = await t.fetch(pathOf(url));
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Security-Policy")).toContain("default-src 'none'");
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(res.headers.get("X-Robots-Tag")).toBe("noindex, nofollow");
    const html = await res.text();
    expect(html).toContain("<title>Health report · Dr. Lee</title>");
    expect(html).toContain("Sertraline");
    expect(html).not.toContain("penicillin");
    await t.fetch(pathOf(url));
    const [link] = await as.query(api.share.list, { now: Date.now() });
    expect(link).toMatchObject({ label: "Dr. Lee", sections: ["medications"], status: "active", opens: 2, lastOpenedAt: expect.any(Number) });
  });

  test("turned off, expired, unknown or malformed links show a not-available page", async () => {
    const t = setup();
    const { as } = await withData(t);
    const a = await as.mutation(api.share.create, { sections: ["facts"], rangeDays: 30, expiresInDays: 1 });
    const b = await as.mutation(api.share.create, { sections: ["facts"], rangeDays: 30, expiresInDays: null });
    await as.mutation(api.share.revoke, { id: (await as.query(api.share.list, { now: NOW })).find((l) => l.url === b.url)!._id });
    expect((await t.fetch(pathOf(b.url))).status).toBe(404);
    expect((await t.fetch(pathOf(a.url))).status).toBe(200);
    vi.setSystemTime(NOW + 2 * DAY);
    const expired = await t.fetch(pathOf(a.url));
    expect(expired.status).toBe(404);
    expect(await expired.text()).toContain("This link isn't available");
    expect((await t.fetch("/share/notarealtokennotarealtoken")).status).toBe(404);
    expect((await t.fetch("/share/<script>")).status).toBe(404);
    expect((await as.query(api.share.list, { now: Date.now() })).map((l) => l.status).sort()).toEqual(["expired", "off"]);
  });

  test("only the owner can turn a link off; deleting the account turns links off", async () => {
    const t = setup();
    const { as } = await withData(t);
    const other = await createAppUser(t, "b@example.com");
    const { url } = await as.mutation(api.share.create, { sections: ["facts"], rangeDays: 30, expiresInDays: null });
    const [link] = await as.query(api.share.list, { now: NOW });
    await expect(other.as.mutation(api.share.revoke, { id: link._id })).rejects.toThrow(/Not found/);
    expect(await other.as.query(api.share.list, { now: NOW })).toEqual([]);
    await as.mutation(api.me.deleteData, { category: "everything" });
    expect((await t.fetch(pathOf(url))).status).toBe(404); // hidden right away
    await t.finishAllScheduledFunctions(() => vi.advanceTimersByTime(1)); // not the recurring reminder
    expect(await t.run((ctx) => ctx.db.query("shareLinks").collect())).toHaveLength(0);
  });

  test("needs sections, and caps active links", async () => {
    const t = setup();
    const { as } = await withData(t);
    await expect(as.mutation(api.share.create, { sections: [], rangeDays: 30, expiresInDays: 7 })).rejects.toThrow(/at least one/);
    for (let i = 0; i < 20; i++) await as.mutation(api.share.create, { sections: ["facts"], rangeDays: 30, expiresInDays: 7 });
    await expect(as.mutation(api.share.create, { sections: ["facts"], rangeDays: 30, expiresInDays: 7 })).rejects.toThrow(/Up to 20/);
  });
});

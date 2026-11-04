import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api } from "../convex/_generated/api";
import { createAppUser, messagesOf, mockApis, pushSends, setEnv, setup } from "./helpers";

const NOW = Date.parse("2026-11-02T18:00:00Z");
const H = 3_600_000;
const DAY = 24 * H;
const APP = "https://talktothebeak.health";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  setEnv();
  vi.stubEnv("APP_URL", APP);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

const settle = (t: ReturnType<typeof setup>) => t.finishAllScheduledFunctions(() => vi.advanceTimersByTime(1));
const tokenOf = (url: string) => new URL(url).searchParams.get("join")!;
const ALL = { missedDoses: true, forecast: true };

// Ana invites Sam; Sam joins.
async function circle(t: ReturnType<typeof setup>, alerts = ALL) {
  mockApis();
  const ana = await createAppUser(t, "ana@example.com");
  const sam = await createAppUser(t, "sam@example.com");
  await t.run((ctx) => ctx.db.patch(ana.userId, { profile: { name: "Ana" }, timeZone: "UTC" }));
  const { url } = await ana.as.mutation(api.circle.invite, { label: "Sam (son)", alerts });
  await sam.as.mutation(api.circle.join, { token: tokenOf(url) });
  return { ana, sam, url };
}

describe("care circle: invites and joining", () => {
  test("an invite link on the app's domain; joining adds the member and tells the person", async () => {
    const t = setup();
    mockApis();
    const ana = await createAppUser(t, "ana@example.com");
    const sam = await createAppUser(t, "sam@example.com");
    await t.run((ctx) => ctx.db.patch(ana.userId, { profile: { name: "Ana" } }));
    const { url } = await ana.as.mutation(api.circle.invite, { label: "Sam (son)", alerts: ALL });
    expect(url).toMatch(new RegExp(`^${APP}/\\?join=[A-Za-z0-9_-]{32}$`));
    // Signed out, the welcome page can say who it's from.
    expect(await t.query(api.circle.inviteInfo, { token: tokenOf(url), now: NOW })).toEqual({ name: "Ana", own: false });
    expect(await ana.as.query(api.circle.inviteInfo, { token: tokenOf(url), now: NOW })).toEqual({ name: "Ana", own: true });

    expect(await sam.as.mutation(api.circle.join, { token: tokenOf(url) })).toEqual({ ownerId: ana.userId, name: "Ana" });
    expect(await sam.as.query(api.circle.caringFor, {})).toEqual([expect.objectContaining({ ownerId: ana.userId, name: "Ana", alerts: ALL })]);
    const mine = await ana.as.query(api.circle.mine, { now: NOW });
    expect(mine).toEqual({ members: [expect.objectContaining({ name: "sam", label: "Sam (son)", alerts: ALL })], invites: [] });
    expect((await messagesOf(t, ana.userId)).filter((m) => m.kind === "circle").map((m) => m.text)).toEqual([
      expect.stringContaining("**Sam (son)** joined your Care Circle"),
    ]);
  });

  test("invites work once, expire after a week, can be cancelled, and can't be used by their sender", async () => {
    const t = setup();
    const { ana, url } = await circle(t);
    const lee = await createAppUser(t, "lee@example.com");
    await expect(lee.as.mutation(api.circle.join, { token: tokenOf(url) })).rejects.toThrow("isn't available");

    const own = await ana.as.mutation(api.circle.invite, { alerts: ALL });
    await expect(ana.as.mutation(api.circle.join, { token: tokenOf(own.url) })).rejects.toThrow("your own invite");

    const cancelled = await ana.as.mutation(api.circle.invite, { alerts: ALL });
    const [open] = (await ana.as.query(api.circle.mine, { now: Date.now() }))!.invites.filter((i) => i.url === cancelled.url);
    await ana.as.mutation(api.circle.cancelInvite, { id: open._id });
    await expect(lee.as.mutation(api.circle.join, { token: tokenOf(cancelled.url) })).rejects.toThrow("isn't available");

    const old = await ana.as.mutation(api.circle.invite, { alerts: ALL });
    vi.setSystemTime(NOW + 8 * DAY);
    expect(await t.query(api.circle.inviteInfo, { token: tokenOf(old.url), now: Date.now() })).toBeNull();
    await expect(lee.as.mutation(api.circle.join, { token: tokenOf(old.url) })).rejects.toThrow("isn't available");
  });

  test("up to 10 people, counting open invites", async () => {
    const t = setup();
    const { ana } = await circle(t);
    for (let i = 0; i < 9; i++) await ana.as.mutation(api.circle.invite, { alerts: ALL });
    await expect(ana.as.mutation(api.circle.invite, { alerts: ALL })).rejects.toThrow("up to 10 people");
  });
});

describe("care circle: what members see", () => {
  test("today's doses with what happened, medications, contacts and a report; nothing for anyone else", async () => {
    const t = setup();
    const { ana, sam } = await circle(t);
    await ana.as.mutation(api.reminders.add, { name: "Metformin", dose: "500 mg", schedule: { kind: "daily", times: ["08:00"] } });
    await t.run(async (ctx) => {
      const med = (await ctx.db.query("medications").first())!;
      for (const [dueAt, status] of [[NOW - 10 * H, "taken"], [NOW - 6 * H, undefined], [NOW - H, undefined]] as const) {
        await ctx.db.insert("messages", {
          userId: ana.userId, role: "assistant", channel: "app", kind: "reminder", text: "Time for Metformin",
          reminder: { medicationId: med._id, dueAt, ...(status && { status }) },
        });
      }
      await ctx.db.insert("emergencyPlans", { userId: ana.userId, sections: [], contacts: [{ name: "Dr. Lee", phone: "555-0100" }] });
    });
    const view = await sam.as.query(api.circle.person, { ownerId: ana.userId, now: NOW });
    expect(view).toMatchObject({
      name: "Ana",
      doses: [
        { name: "Metformin", status: "taken" },
        { name: "Metformin", status: "missed" },
        { name: "Metformin", status: "due" },
      ],
      meds: [{ name: "Metformin", dose: "500 mg", paused: false }],
      contacts: [expect.objectContaining({ name: "Dr. Lee", phone: "555-0100" })],
      forecast: [],
    });
    expect(await sam.as.query(api.circle.report, { ownerId: ana.userId, now: NOW, generated: "now" })).toContain("Metformin");

    const lee = await createAppUser(t, "lee@example.com");
    expect(await lee.as.query(api.circle.person, { ownerId: ana.userId, now: NOW })).toBeNull();
    await expect(lee.as.query(api.circle.report, { ownerId: ana.userId, now: NOW, generated: "now" })).rejects.toThrow("Not found");
  });

  test("the person changes alerts or removes a member; a member can leave; nobody else can do either", async () => {
    const t = setup();
    const { ana, sam } = await circle(t);
    const lee = await createAppUser(t, "lee@example.com");
    const [row] = (await ana.as.query(api.circle.mine, { now: NOW }))!.members;
    await expect(sam.as.mutation(api.circle.setAlerts, { id: row._id, alerts: ALL })).rejects.toThrow("Not found");
    await ana.as.mutation(api.circle.setAlerts, { id: row._id, alerts: { missedDoses: false, forecast: true } });
    expect((await sam.as.query(api.circle.caringFor, {}))[0].alerts).toEqual({ missedDoses: false, forecast: true });
    await expect(lee.as.mutation(api.circle.remove, { id: row._id })).rejects.toThrow("Not found");
    await sam.as.mutation(api.circle.remove, { id: row._id });
    expect(await sam.as.query(api.circle.caringFor, {})).toEqual([]);
    expect(await sam.as.query(api.circle.person, { ownerId: ana.userId, now: NOW })).toBeNull();
  });
});

describe("care circle: alerts", () => {
  test("missed doses reach members who chose them, in the chat with a push", async () => {
    const t = setup();
    const { ana, sam } = await circle(t);
    const lee = await createAppUser(t, "lee@example.com");
    const { url } = await ana.as.mutation(api.circle.invite, { alerts: { missedDoses: false, forecast: true } });
    await lee.as.mutation(api.circle.join, { token: tokenOf(url) });
    const { calls } = mockApis();
    await sam.as.mutation(api.push.register, { token: "ExponentPushToken[ssssssssssssssssssssss]", platform: "ios" });
    await ana.as.mutation(api.reminders.add, { name: "Metformin", schedule: { kind: "interval", everyHours: 12, firstAt: NOW + 12 * H } });
    for (let i = 0; i < 4; i++) {
      vi.advanceTimersByTime(12 * H);
      await settle(t);
    }
    expect((await messagesOf(t, sam.userId)).filter((m) => m.kind === "circle").map((m) => m.text)).toEqual([
      "💊 **Ana** has missed 3 doses of Metformin this week. A gentle check-in might help.",
    ]);
    expect(pushSends(calls).filter((p) => p.channelId === "circle")).toEqual([
      expect.objectContaining({ to: "ExponentPushToken[ssssssssssssssssssssss]", title: "Ana missed some doses", data: expect.objectContaining({ kind: "circle", ownerId: ana.userId }) }),
    ]);
    expect((await messagesOf(t, lee.userId)).filter((m) => m.kind === "circle")).toEqual([]);
  });

  test("deleting an account removes it from every care circle", async () => {
    const t = setup();
    const { ana, sam } = await circle(t);
    await ana.as.mutation(api.circle.invite, { alerts: ALL });
    await ana.as.mutation(api.me.deleteData, { category: "everything" });
    await settle(t);
    expect(await t.run((ctx) => ctx.db.query("circleMembers").collect())).toEqual([]);
    expect(await t.run((ctx) => ctx.db.query("circleInvites").collect())).toEqual([]);
    expect(await sam.as.query(api.circle.caringFor, {})).toEqual([]);
  });
});

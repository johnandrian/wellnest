import { describe, expect, test } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { DemoServer, NeedsAccount } from "../src/demo/server";
import { compare } from "../src/demo/db";

// The example dashboard (/demo) runs the app's own Convex functions on a made-up person in the browser.
const NOW = Date.now();
const DAY = 86_400_000;
const date = (offset = 0) => {
  const d = new Date(NOW + offset * DAY);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const today = date();

type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any
const q = (server: DemoServer, name: string, args: Record<string, unknown> = {}) => server.run(name, args, "query") as Promise<Any>;
const m = (server: DemoServer, name: string, args: Record<string, unknown> = {}) => server.run(name, args, "mutation") as Promise<Any>;

describe("example dashboard data", () => {
  test("every query the Health tools use is loaded", () => {
    const server = new DemoServer("en", NOW);
    // The chat, its history, and the sign-in pages aren't part of the example.
    const outside = new Set(["Chat.tsx", "ChatHistory.tsx", "JoinPrompt.tsx", "Welcome.tsx", "Onboarding.tsx", "AboutPanel.tsx", "SettingsPanel.tsx", "HealthSettings.tsx"]);
    const used = new Set<string>();
    for (const file of readdirSync("src").filter((f) => f.endsWith(".tsx") && !outside.has(f))) {
      for (const [, mod, fn] of readFileSync(`src/${file}`, "utf8").matchAll(/use(?:Query|Mutation)\(api\.([a-zA-Z]+)\.([a-zA-Z]+)/g)) used.add(`${mod}:${fn}`);
    }
    expect(used.size).toBeGreaterThan(60);
    expect([...used].filter((name) => !server.has(name))).toEqual([]);
  });

  test("the dashboard shows four charts, the pressure pattern, the dose change, and what's next", async () => {
    const server = new DemoServer("en", NOW);
    const dash = await q(server, "dashboard:view", { today, now: NOW });
    expect(dash.name).toBe("Alex");
    expect(dash.finishProfile).toBeNull();
    expect(dash.charts.map((c: Any) => c.metric)).toEqual(["pain", "mood", "sleepQuality", "symptom"]);
    expect(dash.charts[0].meds.some((x: Any) => x.kind === "dose_changed")).toBe(true);
    expect(dash.meds.count).toBe(4);
    expect(dash.meds.overdue).toBe(0);
    expect(dash.meds.lowSupply).toBe(1);
    expect(dash.visit.questions.length).toBe(3);

    const insights = await q(server, "insights:view", { today });
    // The welcome page story: joint pain flares on the days the air pressure drops.
    expect(insights.patterns[0]).toMatch(/^Pain averaged 7\/10 on days with a drop in air pressure/);
    expect(insights.tomorrow[0]).toMatch(/air pressure/);
    expect(insights.medEffects[0]).toMatch(/^Pain since changing the dose of Methotrexate/);
  });

  test("every tool has something to show", async () => {
    const server = new DemoServer("en", NOW);
    const journal = await q(server, "journal:view", { since: date(-29), today });
    expect(journal.symptoms.map((x: Any) => x.name)).toEqual(["pain", "morning stiffness", "fatigue"]);
    expect(journal.daily.length).toBeGreaterThan(20);
    const trackers = await q(server, "trackers:view", { since: date(-29) });
    expect(trackers.pain.length).toBe(26);
    expect(trackers.weight.length).toBe(4);
    expect((await q(server, "exercises:list", { date: today })).length).toBe(3);
    const meds = await q(server, "medications:all");
    expect(meds.length).toBe(4);
    const detail = await q(server, "medications:detail", { id: meds[0]._id });
    expect(detail.sideEffects.length).toBe(2);
    expect(detail.events.length).toBe(2);
    const doses = await q(server, "reminders:today", { from: NOW - DAY, to: NOW + DAY });
    expect(doses.doses.length).toBeGreaterThan(0);
    expect(doses.asNeeded.length).toBe(1);
    expect((await q(server, "drugs:view")).interactions.length).toBeGreaterThan(0);
    expect((await q(server, "visits:list", { now: NOW })).upcoming.length).toBe(2);
    expect((await q(server, "visits:team")).length).toBe(3);
    expect((await q(server, "visit:history")).length).toBe(1);
    expect((await q(server, "share:list", { now: NOW })).length).toBe(1);
    const records = await q(server, "records:list");
    expect(records.length).toBe(4);
    expect((await q(server, "records:trends")).length).toBe(4);
    expect((await q(server, "emergency:get")).contacts.length).toBe(2);
    expect((await q(server, "circle:mine", { now: NOW })).members.length).toBe(1);
    expect((await q(server, "agent:waiting")).count).toBe(1);
  });

  test("changes stay in memory and show in the next answer", async () => {
    const server = new DemoServer("en", NOW);
    await m(server, "journal:add", { symptom: "headache", severity: 5 });
    const journal = await q(server, "journal:view", { since: date(-29), today });
    expect(journal.recent.some((e: Any) => e.symptom === "headache" && e.date === today)).toBe(true);

    await m(server, "daily:log", { date: today, energy: 2 });
    expect((await q(server, "daily:today", { date: today })).energy).toBe(2);
  });

  test("approving an action finishes it, and a visit summary is written", async () => {
    const server = new DemoServer("en", NOW);
    const waiting = (await server.db.reader.query("agentActions").collect()).find((a) => a.status === "proposed")!;
    await m(server, "agent:approve", { id: waiting._id });
    await new Promise((r) => setTimeout(r, 20));
    expect((await server.db.reader.get(waiting._id))!.status).toBe("done");
  });

  test("anything that needs the real server says so", async () => {
    const server = new DemoServer("en", NOW);
    await expect(server.run("questions:suggest", {}, "action")).rejects.toBeInstanceOf(NeedsAccount);
    await expect(server.run("chat:generateUploadUrl", {}, "mutation")).rejects.toBeInstanceOf(NeedsAccount);
  });

  test("the made-up person speaks each app language", async () => {
    for (const lang of ["es", "el", "zh"] as const) {
      const server = new DemoServer(lang, NOW);
      const dash = await q(server, "dashboard:view", { today, now: NOW });
      expect(dash.charts.length).toBe(4);
      expect((await q(server, "medications:all")).length).toBe(4);
    }
  });

  test("values sort the way Convex sorts them", () => {
    const xs = ["b", 2, null, undefined, true, "a", 1];
    const order = [undefined, null, 1, 2, true, "a", "b"];
    for (let i = 1; i < order.length; i++) expect(compare(order[i - 1], order[i])).toBeLessThan(0);
    void xs;
  });
});

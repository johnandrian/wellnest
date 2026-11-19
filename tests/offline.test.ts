// Logs made offline (src/offline.tsx): the waiting list kept on the device, and doses sent later keeping the time
// they were tapped (convex/reminders.ts).
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api } from "../convex/_generated/api";
import { Id } from "../convex/_generated/dataModel";
import { due, enqueue, MAX_AGE_MS, MAX_QUEUED, parseQueue, prune, type QueuedLog } from "../src/offlineQueue";
import { createAppUser, setEnv, setup } from "./helpers";

const NOW = Date.parse("2026-11-02T18:00:00Z");
const H = 3_600_000;

const log = (id: string, user: string, at: number): QueuedLog => ({ id, user, at, fn: "journal.add", args: { symptom: "headache", date: "2026-11-02" } });

describe("offline queue", () => {
  test("keeps the newest 50, and sends an account's own logs oldest first", () => {
    let q: QueuedLog[] = [];
    for (let i = 0; i < MAX_QUEUED + 5; i++) q = enqueue(q, log(`l${i}`, "a@example.com", NOW + i));
    expect(q).toHaveLength(MAX_QUEUED);
    expect(q[0].id).toBe("l5");

    const mixed = [log("b2", "a@example.com", NOW + 2), log("other", "b@example.com", NOW), log("b1", "a@example.com", NOW + 1)];
    expect(due(mixed, "a@example.com", NOW + 10).map((x) => x.id)).toEqual(["b1", "b2"]);
  });

  test("a week-old log is dropped; other accounts' logs wait", () => {
    const q = [log("old", "a@example.com", NOW - MAX_AGE_MS - 1), log("sent", "a@example.com", NOW), log("other", "b@example.com", NOW)];
    expect(due(q, "a@example.com", NOW).map((x) => x.id)).toEqual(["sent"]);
    expect(prune(q, new Set(["sent"]), NOW).map((x) => x.id)).toEqual(["other"]);
  });

  test("a broken or foreign stored value reads as empty", () => {
    expect(parseQueue(null)).toEqual([]);
    expect(parseQueue("{not json")).toEqual([]);
    expect(parseQueue('{"a":1}')).toEqual([]);
    expect(parseQueue(JSON.stringify([log("x", "a@example.com", NOW), { id: 3 }])).map((x) => x.id)).toEqual(["x"]);
  });
});

describe("doses answered offline", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    setEnv();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  test("Taken and Took one keep the time they were tapped, never later than now or more than two days back", async () => {
    const t = setup();
    const { userId, as } = await createAppUser(t);
    await as.mutation(api.chat.setTimeZone, { timeZone: "America/Los_Angeles", utcOffsetMin: -480 });
    const daily = (await as.mutation(api.reminders.add, { name: "Zinc", schedule: { kind: "daily", times: ["08:00"] } })) as Id<"medications">;
    const prn = (await as.mutation(api.reminders.add, { name: "Ibuprofen", schedule: { kind: "asNeeded" } })) as Id<"medications">;
    const dueAt = NOW - 2 * H;

    await as.mutation(api.reminders.mark, { medicationId: daily, dueAt, status: "taken", at: NOW - H });
    const took = await as.mutation(api.reminders.takeNow, { medicationId: prn, at: NOW - 3 * H });
    expect(took).toBe(NOW - 3 * H);
    // From the future, or too long ago: clamped.
    const future = await as.mutation(api.reminders.takeNow, { medicationId: prn, at: NOW + H });
    expect(future).toBeGreaterThanOrEqual(NOW);
    expect(future).toBeLessThan(NOW + 1000);
    const old = await as.mutation(api.reminders.takeNow, { medicationId: prn, at: NOW - 10 * 24 * H });
    expect(old - (NOW - 48 * H)).toBeLessThan(1000);
    expect(old).toBeGreaterThanOrEqual(NOW - 48 * H);

    const logs = await t.run((ctx) => ctx.db.query("doseLogs").withIndex("by_user", (q) => q.eq("userId", userId)).collect());
    expect(logs.find((l) => l.medicationId === daily)).toMatchObject({ dueAt, status: "taken", takenAt: NOW - H });
  });
});

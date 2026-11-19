// Logs made while the app has no connection (./offline.tsx): what's kept on the device until it's back. Kept small
// and plain so a test can check it (tests/offline-queue.test.ts).
import type { FunctionArgs } from "convex/server";
import type { api } from "../convex/_generated/api";

export type LogCall =
  | { fn: "journal.add"; args: FunctionArgs<typeof api.journal.add> }
  | { fn: "trackers.add"; args: FunctionArgs<typeof api.trackers.add> }
  | { fn: "reminders.mark"; args: FunctionArgs<typeof api.reminders.mark> }
  | { fn: "reminders.takeNow"; args: FunctionArgs<typeof api.reminders.takeNow> };
export type QueuedLog = LogCall & { id: string; user: string; at: number };

// At most this many, and none older than a week: a log that old would land on the wrong days anyway.
export const MAX_QUEUED = 50;
export const MAX_AGE_MS = 7 * 24 * 3_600_000;

export function enqueue(queue: QueuedLog[], item: QueuedLog): QueuedLog[] {
  return [...queue, item].slice(-MAX_QUEUED);
}

// What can still be sent for this account now: its own logs that aren't too old, oldest first.
export function due(queue: QueuedLog[], user: string, now: number): QueuedLog[] {
  return queue.filter((q) => q.user === user && now - q.at <= MAX_AGE_MS).sort((a, b) => a.at - b.at);
}

// Drops what was sent and what's too old to send; other accounts' logs stay for when they sign in again.
export function prune(queue: QueuedLog[], sent: Set<string>, now: number): QueuedLog[] {
  return queue.filter((q) => !sent.has(q.id) && now - q.at <= MAX_AGE_MS);
}

export function parseQueue(raw: string | null | undefined): QueuedLog[] {
  try {
    const list = JSON.parse(raw ?? "[]");
    if (!Array.isArray(list)) return [];
    // Drops anything that isn't a queued log, such as a damaged save.
    return list.filter((q) => q && typeof q.id === "string" && typeof q.fn === "string" && typeof q.user === "string");
  } catch {
    return [];
  }
}

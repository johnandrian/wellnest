// Where logs made offline wait in a browser: this site's local storage. Phones: ./offlineStore.ts.
import { parseQueue, type QueuedLog } from "./offlineQueue";

const KEY = "wellnest.offline";

export function readQueue(): QueuedLog[] {
  try {
    return parseQueue(window.localStorage.getItem(KEY));
  } catch {
    return [];
  }
}

export async function writeQueue(queue: QueuedLog[]) {
  try {
    if (queue.length) window.localStorage.setItem(KEY, JSON.stringify(queue));
    else window.localStorage.removeItem(KEY);
  } catch {
    // Private windows can refuse storage; the log then waits only in memory.
  }
}

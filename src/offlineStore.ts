// Where logs made offline wait on a phone: a file in the app's own documents folder. Web: ./offlineStore.web.ts.
import { File, Paths } from "expo-file-system";
import { parseQueue, type QueuedLog } from "./offlineQueue";

const file = () => new File(Paths.document, "wellnest-offline.json");

export function readQueue(): QueuedLog[] {
  try {
    const f = file();
    return f.exists ? parseQueue(f.textSync()) : [];
  } catch {
    return [];
  }
}

export async function writeQueue(queue: QueuedLog[]) {
  try {
    const f = file();
    if (!queue.length) {
      if (f.exists) f.delete();
      return;
    }
    if (!f.exists) f.create();
    await f.write(JSON.stringify(queue));
  } catch (e) {
    console.warn("couldn't save offline logs", e);
  }
}

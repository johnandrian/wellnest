// Expo push notifications (https://docs.expo.dev/push-notifications/sending-notifications/). The phone app
// registers an Expo push token (convex/push.ts); Expo delivers to APNs / FCM.

const SEND_URL = "https://exp.host/--/api/v2/push/send";
const TOKEN = /^Expo(nent)?PushToken\[[A-Za-z0-9_-]{10,}\]$/;
const BATCH = 100; // Expo's limit per request

export const isPushToken = (s: string) => TOKEN.test(s);

export type PushMessage = {
  to: string;
  title: string;
  body: string;
  data?: Record<string, string>;
  categoryId?: string; // iOS/Android action buttons, set up by the app (src/push.ts)
  channelId?: string; // Android notification channel
  sound?: "default";
};

type Ticket = { status: "ok"; id: string } | { status: "error"; message?: string; details?: { error?: string } };

// Sends the messages; returns the tokens Expo says are no longer registered, so they can be forgotten.
export async function sendPush(messages: PushMessage[]): Promise<{ deadTokens: string[]; errors: string[] }> {
  const deadTokens: string[] = [];
  const errors: string[] = [];
  for (let i = 0; i < messages.length; i += BATCH) {
    const batch = messages.slice(i, i + BATCH);
    const res = await fetch(SEND_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        ...(process.env.EXPO_ACCESS_TOKEN && { Authorization: `Bearer ${process.env.EXPO_ACCESS_TOKEN}` }),
      },
      body: JSON.stringify(batch),
    });
    if (!res.ok) {
      errors.push(`Expo push ${res.status}: ${(await res.text()).slice(0, 200)}`);
      continue;
    }
    const tickets: Ticket[] = (await res.json()).data ?? [];
    tickets.forEach((t, j) => {
      if (t.status !== "error") return;
      if (t.details?.error === "DeviceNotRegistered") deadTokens.push(batch[j].to);
      else errors.push(t.message ?? t.details?.error ?? "unknown push error");
    });
  }
  return { deadTokens, errors };
}

// Notification text has no Markdown.
export const plain = (s: string) => s.replace(/\*\*|__|`/g, "").replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");

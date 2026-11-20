// Logging without a connection: a symptom, a tracker entry, or a dose (Taken, Skip, or Took one) made while the app
// can't reach the server is kept on the device (./offlineStore.ts) and sent when it's back, with the time it was
// logged. A small banner says the app is offline and how many logs are waiting. Everything else still needs a
// connection.
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { Animated, Text, View } from "react-native";
import { useConvex, type ConvexReactClient } from "convex/react";
import { api } from "../convex/_generated/api";
import { errorText, showToast } from "./feedback";
import { usePresence } from "./Motion";
import { due, enqueue, prune, type LogCall, type QueuedLog } from "./offlineQueue";
import { readQueue, writeQueue } from "./offlineStore";
import { useInsets } from "./safeArea";
import { colors, radius, themed } from "./theme";
import type { Strings } from "./i18n";

type Send = (call: LogCall) => Promise<"sent" | "queued">;
const OfflineContext = createContext<Send | null>(null);

function run(convex: ConvexReactClient, call: LogCall): Promise<unknown> {
  switch (call.fn) {
    case "journal.add":
      return convex.mutation(api.journal.add, call.args);
    case "journal.addNote":
      return convex.mutation(api.journal.addNote, call.args);
    case "trackers.add":
      return convex.mutation(api.trackers.add, call.args);
    case "reminders.mark":
      return convex.mutation(api.reminders.mark, call.args);
    default:
      return convex.mutation(api.reminders.takeNow, call.args);
  }
}

// A dose answered offline keeps the time it was tapped (the server takes it as when it was taken), and a journal note
// the time it was written.
function stamp(call: LogCall, at: number): LogCall {
  if (call.fn === "journal.addNote") return { fn: call.fn, args: { ...call.args, at } };
  if (call.fn === "reminders.mark") return { fn: call.fn, args: { ...call.args, at } };
  if (call.fn === "reminders.takeNow") return { fn: call.fn, args: { ...call.args, at } };
  return call;
}

const isOffline = (convex: ConvexReactClient) => {
  const st = convex.connectionState();
  return st.hasEverConnected && !st.isWebSocketConnected;
};

let lastId = 0;
const newId = () => `${Date.now().toString(36)}-${(lastId++).toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

// Wraps the signed-in app (App.tsx); `user` keeps each account's waiting logs apart on a shared device.
export function OfflineProvider({ s, user, children }: { s: Strings; user: string; children: ReactNode }) {
  const convex = useConvex();
  const queueRef = useRef<QueuedLog[]>([]);
  const [pending, setPending] = useState(0);
  const [offline, setOffline] = useState(false);
  const flushing = useRef(false);
  const sRef = useRef(s);
  sRef.current = s;

  const save = useCallback(
    (queue: QueuedLog[]) => {
      queueRef.current = queue;
      setPending(due(queue, user, Date.now()).length);
      void writeQueue(queue);
    },
    [user],
  );

  const flush = useCallback(async () => {
    if (flushing.current || isOffline(convex)) return;
    const todo = due(queueRef.current, user, Date.now());
    if (!todo.length) return;
    flushing.current = true;
    let sent = 0;
    try {
      for (const item of todo) {
        try {
          await run(convex, item);
          sent++;
        } catch (e) {
          // Sign-in isn't back yet: try again on the next reconnect.
          if (/Not signed in/.test(errorText(e))) break;
          // The server refused it (a medication since removed, a day that's full): say so and let it go.
          showToast(sRef.current.offlineFailed.replace("{why}", errorText(e)));
        }
        save(prune(queueRef.current, new Set([item.id]), Date.now()));
      }
    } finally {
      flushing.current = false;
    }
    if (sent) showToast(sent === 1 ? sRef.current.offlineSentOne : sRef.current.offlineSent.replace("{n}", String(sent)));
  }, [convex, user, save]);

  useEffect(() => {
    save(prune(readQueue(), new Set(), Date.now()));
    const check = () => {
      const now = isOffline(convex);
      setOffline(now);
      if (!now) void flush();
    };
    check();
    return convex.subscribeToConnectionState(check);
  }, [convex, flush, save]);

  const send = useCallback<Send>(
    async (call) => {
      if (!isOffline(convex)) {
        await run(convex, call);
        return "sent";
      }
      const at = Date.now();
      save(enqueue(queueRef.current, { ...stamp(call, at), id: newId(), user, at }));
      showToast(sRef.current.offlineSaved);
      return "queued";
    },
    [convex, user, save],
  );

  return (
    <OfflineContext.Provider value={send}>
      {children}
      <OfflineBanner s={s} offline={offline} pending={pending} />
    </OfflineContext.Provider>
  );
}

// The logs that still work offline. Outside the signed-in app (the demo) they just send.
export function useOfflineSend(): Send {
  const send = useContext(OfflineContext);
  const convex = useConvex();
  return send ?? (async (call) => (await run(convex, call), "sent"));
}

function OfflineBanner({ s, offline, pending }: { s: Strings; offline: boolean; pending: number }) {
  const { t, mounted } = usePresence(offline);
  const insets = useInsets();
  if (!mounted) return null;
  return (
    <View style={[styles.wrap, { top: insets.top + 8 }]} pointerEvents="none">
      <Animated.View
        style={[styles.pill, { opacity: t, transform: [{ translateY: t.interpolate({ inputRange: [0, 1], outputRange: [-12, 0] }) }] }]}
        accessibilityLiveRegion="polite"
      >
        <Text style={styles.text}>
          {pending === 1 ? s.offlinePendingOne
          : pending ? s.offlinePending.replace("{n}", String(pending))
          : s.offlineNow}
        </Text>
      </Animated.View>
    </View>
  );
}

const styles = themed(() => ({
  wrap: { position: "absolute", left: 16, right: 16, alignItems: "center", zIndex: 40 },
  pill: { maxWidth: 520, paddingHorizontal: 16, paddingVertical: 8, borderRadius: radius.pill, backgroundColor: colors.warningSoft },
  text: { color: colors.warningText, fontSize: 14, fontWeight: "600" as const, textAlign: "center" as const },
}));

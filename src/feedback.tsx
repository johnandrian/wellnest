// Shared feedback for every screen: the readable line of a server error, a yes / no question before something
// destructive, and a toast at the bottom of the window ("Copied", "Saved") that can offer Undo.
//
// Undo works by waiting: removeWithUndo hides the item at once (useHidden), shows "Removed · Undo", and only runs the
// real delete when the toast goes away. Undo just shows the item again; nothing was deleted yet.
import { useEffect, useState } from "react";
import { Alert, Animated, Platform, Text, View } from "react-native";
import { Tap } from "./Tap";
import { usePresence } from "./Motion";
import { colors, radius, themed, TOUCH } from "./theme";
import { useInsets } from "./safeArea";
import type { Strings } from "./i18n";

// The first line of a Convex error, without the "Uncaught Error:" and stack the server adds.
export const errorText = (e: unknown) => ((e as Error)?.message ?? String(e)).replace(/^.*Uncaught Error: /, "").split("\n")[0];

// A yes / no question; resolves true on yes. `destructive` colors the yes button red on a phone.
export function confirmAsk(o: { title: string; message?: string; ok: string; cancel: string; destructive?: boolean }): Promise<boolean> {
  if (Platform.OS === "web") return Promise.resolve(window.confirm(o.message ? `${o.title}\n\n${o.message}` : o.title));
  return new Promise((resolve) =>
    Alert.alert(o.title, o.message, [
      { text: o.cancel, style: "cancel", onPress: () => resolve(false) },
      { text: o.ok, style: o.destructive === false ? "default" : "destructive", onPress: () => resolve(true) },
    ]),
  );
}

// ---------- The toast ----------

const SHOW_MS = 2500;
const UNDO_MS = 5000;

type Toast = { id: number; text: string; undo?: () => void; done?: () => void };
let toast: Toast | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
let nextId = 0;
const hidden = new Set<string>();
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

// Ends the current toast: runs its pending action (a delete waiting for Undo) unless it was undone.
function finish(undone = false) {
  if (timer) clearTimeout(timer);
  timer = null;
  const t = toast;
  toast = null;
  emit();
  if (t && !undone) t.done?.();
}

// "Copied", "Saved": a short message at the bottom of the window. A newer toast replaces it.
export function showToast(text: string) {
  finish();
  toast = { id: ++nextId, text };
  timer = setTimeout(() => finish(), SHOW_MS);
  emit();
}

// Hides `key` at once and runs `run` once the toast is gone, unless Undo is tapped. `key` is what useHidden
// checks, usually the row's id.
export function removeWithUndo(o: { key: string; text: string; run: () => Promise<unknown>; onError?: (e: unknown) => void }) {
  finish();
  hidden.add(o.key);
  toast = {
    id: ++nextId,
    text: o.text,
    undo: () => {
      hidden.delete(o.key);
      finish(true);
    },
    // Stays hidden while the delete runs, so the row doesn't flash back before the list updates.
    done: () =>
      void o.run().then(
        () => {
          hidden.delete(o.key);
          emit();
        },
        (e) => {
          hidden.delete(o.key);
          emit();
          o.onError?.(e);
        },
      ),
  };
  timer = setTimeout(() => finish(), UNDO_MS);
  emit();
}

function useStore() {
  const [, set] = useState(0);
  useEffect(() => {
    const l = () => set((n) => n + 1);
    listeners.add(l);
    return () => void listeners.delete(l);
  }, []);
}

// Whether a row is waiting to be deleted (removeWithUndo), so lists can leave it out.
export function useHidden() {
  useStore();
  return (key: string) => hidden.has(key);
}

// Drawn once at the root of the app (App.tsx), over every screen.
export function ToastHost({ s }: { s: Strings }) {
  useStore();
  const [shown, setShown] = useState<Toast | null>(toast);
  // Keep the last toast's words while it slides away.
  useEffect(() => {
    if (toast) setShown(toast);
  });
  const { t, mounted } = usePresence(!!toast);
  const insets = useInsets();
  if (!mounted || !shown) return null;
  return (
    <View style={[styles.wrap, { bottom: 24 + insets.bottom }]} pointerEvents="box-none">
      <Animated.View
        style={[styles.toast, { opacity: t, transform: [{ translateY: t.interpolate({ inputRange: [0, 1], outputRange: [16, 0] }) }] }]}
        accessibilityLiveRegion="polite"
        accessibilityRole="alert"
      >
        <Text style={styles.text}>{shown.text}</Text>
        {shown.undo && (
          <Tap style={styles.undo} onPress={toast?.id === shown.id ? shown.undo : undefined} accessibilityRole="button">
            <Text style={styles.undoText}>{s.undo}</Text>
          </Tap>
        )}
      </Animated.View>
    </View>
  );
}

const styles = themed(() => ({
  wrap: { position: "absolute", left: 16, right: 16, alignItems: "center", zIndex: 50 },
  toast: { flexDirection: "row", alignItems: "center", gap: 12, maxWidth: 520, minHeight: TOUCH, paddingLeft: 18, paddingRight: 6, borderRadius: radius.pill, backgroundColor: colors.text },
  text: { flexShrink: 1, color: colors.bg, fontSize: 15, paddingVertical: 10 },
  undo: { minHeight: TOUCH, justifyContent: "center", paddingHorizontal: 12 },
  undoText: { color: colors.bg, fontSize: 15, fontWeight: "700", textDecorationLine: "underline" },
}));

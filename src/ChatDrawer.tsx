// The chat as a drawer on the right of a wide browser window (src/Chat.tsx): it opens beside the dashboard and tools
// instead of covering them, so Wellnest can be asked about whatever is on screen. Ctrl+K (Cmd+K on a Mac) opens and
// closes it. Phones and narrow windows keep the full-screen chat.
import { ReactNode, useEffect, useRef } from "react";
import { Animated, View } from "react-native";
import { usePresence } from "./Motion";
import { colors, softShadow, themed } from "./theme";

// The window width from which the chat docks as a drawer: room for the rail, a tool, and the drawer side by side.
export const DRAWER_MIN_WIDTH = 1100;
export const DRAWER_WIDTH = 420;

export function ChatDrawer({ open, children }: { open: boolean; children: ReactNode }) {
  const { t, mounted } = usePresence(open);
  // While closing, keep showing the chat as it was.
  const last = useRef(children);
  if (open) last.current = children;
  if (!mounted) return null;
  return (
    // The width eases open with the drawer, so the tools make room rather than jump (web only, where this is shown).
    <Animated.View style={[styles.slot, { width: t.interpolate({ inputRange: [0, 1], outputRange: [0, DRAWER_WIDTH + 10] }) }]}>
      <Animated.View
        style={[styles.drawer, { opacity: t, transform: [{ translateX: t.interpolate({ inputRange: [0, 1], outputRange: [32, 0] }) }] }]}
        accessibilityRole="complementary"
      >
        <View style={styles.fill}>{open ? children : last.current}</View>
      </Animated.View>
    </Animated.View>
  );
}

// Ctrl+K / Cmd+K anywhere in the window calls `onToggle` (web only).
export function useChatShortcut(onToggle: () => void) {
  const latest = useRef(onToggle);
  latest.current = onToggle;
  useEffect(() => {
    if (typeof window === "undefined" || !window.addEventListener) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "k") {
        e.preventDefault();
        latest.current();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}

const styles = themed(() => ({
  slot: { alignSelf: "stretch", overflow: "hidden" },
  drawer: {
    width: DRAWER_WIDTH,
    flex: 1,
    marginVertical: 10,
    marginRight: 10,
    borderRadius: 28,
    borderWidth: 1,
    borderColor: colors.hairline,
    backgroundColor: colors.bg,
    overflow: "hidden",
    ...softShadow(),
  },
  fill: { flex: 1 },
}));

// A panel that slides in over the right half of a wide browser window (Settings, "What Wellnest knows about me"),
// with the page dimmed behind it. Tapping outside, the close button or Escape closes it. Phones and narrow windows
// use the drop-down under the header instead (src/Chat.tsx).
import { ReactNode, useEffect, useRef } from "react";
import { Animated, Platform, Pressable, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors, radius, TOUCH, themed } from "./theme";
import { usePresence } from "./Motion";
import { Tap } from "./Tap";

// Half of this is still as wide as a phone, which Settings is laid out for.
export const SIDE_SHEET_MIN_WIDTH = 768;

export function SideSheet({ open, title, closeLabel, onClose, children }: { open: boolean; title: string; closeLabel: string; onClose: () => void; children: ReactNode }) {
  const { t, mounted } = usePresence(open);
  // While closing, keep showing what it last showed.
  const last = useRef({ title, children });
  if (open) last.current = { title, children };

  useEffect(() => {
    if (!open || Platform.OS !== "web") return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!mounted) return null;
  return (
    <View style={styles.overlay} pointerEvents={open ? "auto" : "none"}>
      <Animated.View style={[styles.backdrop, { opacity: t }]}>
        <Pressable style={styles.fill} onPress={onClose} accessibilityRole="button" accessibilityLabel={closeLabel} />
      </Animated.View>
      <Animated.View
        style={[styles.sheet, { opacity: t, transform: [{ translateX: t.interpolate({ inputRange: [0, 1], outputRange: [48, 0] }) }] }]}
        accessibilityViewIsModal
      >
        <View style={styles.head}>
          <Text style={styles.title} accessibilityRole="header" numberOfLines={1}>
            {last.current.title}
          </Text>
          <Tap style={styles.close} onPress={onClose} accessibilityRole="button" accessibilityLabel={closeLabel}>
            <Ionicons name="close" size={24} color={colors.text} />
          </Tap>
        </View>
        <View style={styles.body}>{open ? children : last.current.children}</View>
      </Animated.View>
    </View>
  );
}

const styles = themed(() => ({
  overlay: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, zIndex: 30, flexDirection: "row", justifyContent: "flex-end" },
  backdrop: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: colors.backdrop },
  fill: { flex: 1 },
  sheet: { width: "50%", height: "100%", backgroundColor: colors.surface, borderTopLeftRadius: radius.lg, borderBottomLeftRadius: radius.lg, overflow: "hidden" },
  head: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8, paddingLeft: 20, paddingRight: 8, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: colors.border },
  title: { flex: 1, fontSize: 20, fontWeight: "700", color: colors.text },
  close: { width: TOUCH, height: TOUCH, alignItems: "center", justifyContent: "center", borderRadius: TOUCH / 2 },
  body: { flex: 1, minHeight: 0 },
}));

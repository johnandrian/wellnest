// The notifications bell in the top bar (src/HubPanel.tsx): a count of what's waiting (convex/dashboard.ts `alerts`):
// actions to approve, doses past due, and refills running low. Tapping it opens a small list under the top bar; each
// line opens the tool that handles it. Red when one of the actions is urgent.
import { useEffect, useRef, useState } from "react";
import { Animated, Modal, Platform, Pressable, ScrollView, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useQuery } from "convex/react";
import { api } from "../convex/_generated/api";
import { Tap } from "./Tap";
import { Icon, IconName } from "./Icon";
import { colors, radius, softShadow, themed, tint, TOUCH } from "./theme";
import type { Strings } from "./i18n";
import { usePresence } from "./Motion";
import { useNow } from "./useNow";
import { useInsets } from "./safeArea";
import { CountBadge, type HubTab } from "./HubPanel";

type Item = { key: string; icon: IconName; tint: keyof typeof tint; text: string; urgent?: boolean; tab: HubTab };

export function NotificationsButton({ s, onOpen }: { s: Strings; onOpen: (t: HubTab) => void }) {
  const now = useNow(60_000);
  const alerts = useQuery(api.dashboard.alerts, { now });
  const [open, setOpen] = useState(false);
  const items: Item[] = [
    ...(alerts?.actions ?? []).map((a) => ({ key: a._id, icon: "agent" as const, tint: "agent" as const, text: a.title, urgent: a.urgent, tab: "agent" as const })),
    ...(alerts?.overdue
      ? [{ key: "overdue", icon: "medications" as const, tint: "medications" as const, text: alerts.overdue === 1 ? s.homeOverdueOne : s.homeOverdueMany.replace("{n}", String(alerts.overdue)), tab: "reminders" as const }]
      : []),
    ...(alerts?.lowSupply ?? []).map((name) => ({ key: `low-${name}`, icon: "pharmacy" as const, tint: "medications" as const, text: s.notifyLow.replace("{name}", name), tab: "reminders" as const })),
  ];
  const urgent = items.some((i) => i.urgent);
  const label = items.length ? s.notifyCount.replace("{n}", String(items.length)) : s.notifications;
  return (
    <>
      <Tap style={styles.round} onPress={() => setOpen(true)} accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ expanded: open }}>
        <Icon name="notifications" size={22} color={colors.onBar} />
        {items.length > 0 && (
          <View style={styles.badge} pointerEvents="none">
            <CountBadge n={items.length} urgent={urgent} s={s} />
          </View>
        )}
      </Tap>
      <Dropdown open={open} onClose={() => setOpen(false)} s={s}>
        {items.length ? (
          items.map((i) => (
            <Tap
              key={i.key}
              style={[styles.item, i.urgent && styles.itemUrgent]}
              onPress={() => {
                setOpen(false);
                onOpen(i.tab);
              }}
              accessibilityRole="button"
            >
              <View style={[styles.icon, { backgroundColor: tint[i.tint].bg }]}>
                <Icon name={i.icon} size={18} color={i.urgent ? colors.danger : tint[i.tint].fg} />
              </View>
              <Text style={[styles.text, i.urgent && styles.textUrgent]} numberOfLines={3}>
                {i.text}
              </Text>
              <Ionicons name="chevron-forward" size={16} color={colors.muted} />
            </Tap>
          ))
        ) : (
          <View style={styles.empty}>
            <Ionicons name="checkmark-circle-outline" size={22} color={colors.primary} />
            <Text style={styles.emptyText}>{s.notifyNone}</Text>
          </View>
        )}
      </Dropdown>
    </>
  );
}

// A small panel at the top right, over a clear backdrop: a tap outside, the close button, or Escape closes it.
function Dropdown({ open, onClose, s, children }: { open: boolean; onClose: () => void; s: Strings; children: React.ReactNode }) {
  const { t, mounted } = usePresence(open);
  const insets = useInsets();
  const last = useRef(children);
  if (open) last.current = children;
  useEffect(() => {
    if (!open || Platform.OS !== "web") return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!mounted) return null;
  return (
    <Modal visible transparent animationType="none" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityRole="button" accessibilityLabel={s.close} />
      <Animated.View
        style={[
          styles.panel,
          { top: insets.top + 76, opacity: t, transform: [{ translateY: t.interpolate({ inputRange: [0, 1], outputRange: [-8, 0] }) }] },
        ]}
        accessibilityViewIsModal
      >
        <View style={styles.head}>
          <Text style={styles.title} accessibilityRole="header">
            {s.notifications}
          </Text>
          <Tap style={styles.close} onPress={onClose} accessibilityRole="button" accessibilityLabel={s.close}>
            <Ionicons name="close" size={20} color={colors.muted} />
          </Tap>
        </View>
        <ScrollView contentContainerStyle={styles.list}>{open ? children : last.current}</ScrollView>
      </Animated.View>
    </Modal>
  );
}

const styles = themed(() => ({
  round: { width: TOUCH, height: TOUCH, borderRadius: TOUCH / 2, alignItems: "center", justifyContent: "center", backgroundColor: colors.barFill },
  badge: { position: "absolute", top: -4, right: -4 },
  backdrop: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0 },
  panel: {
    position: "absolute",
    right: 16,
    width: 340,
    maxWidth: "92%",
    maxHeight: "70%",
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.hairline,
    overflow: "hidden",
    ...softShadow(),
  },
  head: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingLeft: 16, paddingRight: 6, paddingVertical: 4, borderBottomWidth: 1, borderBottomColor: colors.border },
  title: { fontSize: 16, fontWeight: "700", color: colors.text },
  close: { width: TOUCH, height: TOUCH, alignItems: "center", justifyContent: "center" },
  list: { padding: 8, gap: 4 },
  item: { flexDirection: "row", alignItems: "center", gap: 10, minHeight: TOUCH + 8, paddingHorizontal: 8, borderRadius: radius.sm },
  itemUrgent: { backgroundColor: colors.dangerSoft },
  icon: { width: 32, height: 32, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  text: { flex: 1, color: colors.text, fontSize: 14, lineHeight: 19 },
  textUrgent: { color: colors.danger, fontWeight: "600" },
  empty: { flexDirection: "row", alignItems: "center", gap: 8, padding: 12 },
  emptyText: { color: colors.muted, fontSize: 14 },
}));

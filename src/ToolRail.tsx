// The tool rail: the dashboard and every health tool in one short list, each with its own icon. On a wide screen it sits on the left beside the tool (src/HubPanel.tsx) and can fold down to just the
// icons; on a phone the menu button slides the same list in from the left (RailSheet), and picking a tool closes it.
import { ReactNode, useEffect, useRef } from "react";
import { Animated, Platform, Pressable, ScrollView, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Tap } from "./Tap";
import { Icon, IconName } from "./Icon";
import { colors, radius, softShadow, themed, tint, TOUCH } from "./theme";
import type { Strings } from "./i18n";
import { SingingBrand, SingingMark } from "./SingingMark";
import { SwapIcon, usePresence } from "./Motion";
import { CountBadge, toolTabOf, TOOLS, type HubTab } from "./HubPanel";
import { useInsets } from "./safeArea";

export const RAIL_WIDTH = 188;
export const RAIL_FOLDED = 64;

export function ToolRail({
  tab,
  onTab,
  s,
  waiting,
  folded = false,
  onFold,
}: {
  tab: HubTab;
  onTab: (t: HubTab) => void;
  s: Strings;
  waiting?: { count: number; urgent: boolean } | null;
  folded?: boolean;
  // Docked rails can fold to icons; the phone's slide-in one can't.
  onFold?: () => void;
}) {
  const open = toolTabOf(tab);
  return (
    <View style={[styles.rail, { width: folded ? RAIL_FOLDED : RAIL_WIDTH }]}>
      <View style={[styles.brand, folded && styles.brandFolded]}>
        {!folded && (
          // Hovering the name makes the bird sing, as in the chat's header.
          <SingingBrand style={styles.brandName}>
            <SingingMark size={26} />
            <Text style={styles.brandText} numberOfLines={1}>
              Wellnest
            </Text>
          </SingingBrand>
        )}
        {onFold && (
          <Tap style={styles.fold} onPress={onFold} accessibilityRole="button" accessibilityLabel={folded ? s.railExpand : s.railCollapse}>
            <SwapIcon id={folded ? "folded" : "open"}>
              <Ionicons name={folded ? "chevron-forward" : "chevron-back"} size={18} color={colors.onBarMuted} />
            </SwapIcon>
          </Tap>
        )}
      </View>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.list} showsVerticalScrollIndicator={false} accessibilityRole="menu">
        <Row icon="dashboard" fg={colors.primary} bg={colors.primarySoft} label={s.dashboard} on={open === "home"} folded={folded} onPress={() => onTab("home")} />
        {TOOLS.map((t) => (
          <Row
            key={t.tab}
            icon={t.icon}
            fg={tint[t.tint].fg}
            bg={tint[t.tint].bg}
            label={t.label(s)}
            hint={t.desc(s)}
            on={open === t.tab}
            folded={folded}
            onPress={() => onTab(t.tab)}
            badge={t.tab === "agent" && !!waiting?.count ? <CountBadge n={waiting.count} urgent={waiting.urgent} s={s} /> : null}
          />
        ))}
      </ScrollView>
    </View>
  );
}

function Row(p: { icon: IconName; fg: string; bg: string; label: string; hint?: string; on: boolean; folded: boolean; onPress: () => void; badge?: ReactNode }) {
  return (
    <Tap
      style={[styles.row, p.folded && styles.rowFolded, p.on && styles.rowOn]}
      onPress={p.onPress}
      accessibilityRole="menuitem"
      accessibilityState={{ selected: p.on }}
      accessibilityLabel={p.label}
      accessibilityHint={p.hint}
    >
      <View style={[styles.icon, { backgroundColor: p.bg }]}>
        <Icon name={p.icon} size={18} color={p.fg} />
      </View>
      {!p.folded && (
        <Text style={[styles.label, p.on && styles.labelOn]} numberOfLines={1}>
          {p.label}
        </Text>
      )}
      {p.badge && <View style={p.folded ? styles.badgeFolded : undefined}>{p.badge}</View>}
    </Tap>
  );
}

// The phone's rail: slides in from the left over a dimmed page. Tapping outside, the close button, or Escape closes it.
export function RailSheet({ open, onClose, closeLabel, children }: { open: boolean; onClose: () => void; closeLabel: string; children: ReactNode }) {
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
    <View style={styles.overlay} pointerEvents={open ? "auto" : "none"}>
      <Animated.View style={[styles.backdrop, { opacity: t }]}>
        <Pressable style={styles.fill} onPress={onClose} accessibilityRole="button" accessibilityLabel={closeLabel} />
      </Animated.View>
      <Animated.View
        style={[styles.sheet, { paddingTop: insets.top, paddingBottom: insets.bottom, opacity: t, transform: [{ translateX: t.interpolate({ inputRange: [0, 1], outputRange: [-40, 0] }) }] }]}
        accessibilityViewIsModal
      >
        {open ? children : last.current}
      </Animated.View>
    </View>
  );
}

const styles = themed(() => ({
  rail: {
    alignSelf: "stretch",
    backgroundColor: colors.bar,
    margin: 10,
    marginRight: 0,
    borderRadius: 28,
    borderWidth: 1,
    borderColor: colors.hairline,
    paddingVertical: 10,
    ...softShadow(),
  },
  brand: { flexDirection: "row", alignItems: "center", gap: 6, paddingLeft: 12, paddingRight: 6, minHeight: TOUCH, marginBottom: 6 },
  brandFolded: { justifyContent: "center", paddingLeft: 6 },
  brandName: { flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", gap: 6 },
  brandText: { flexShrink: 1, color: colors.onBar, fontSize: 17, fontWeight: "800" },
  fold: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center", backgroundColor: colors.barFill },
  scroll: { flex: 1 },
  list: { paddingHorizontal: 8, paddingBottom: 10, gap: 4 },
  row: { flexDirection: "row", alignItems: "center", gap: 10, minHeight: TOUCH, paddingHorizontal: 8, borderRadius: radius.sm },
  rowFolded: { justifyContent: "center", paddingHorizontal: 0 },
  rowOn: { backgroundColor: colors.barFill },
  icon: { width: 30, height: 30, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  label: { flex: 1, color: colors.onBarMuted, fontSize: 14, fontWeight: "600" },
  labelOn: { color: colors.onBar, fontWeight: "700" },
  badgeFolded: { position: "absolute", top: 2, right: 6 },
  overlay: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, zIndex: 40, flexDirection: "row" },
  backdrop: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: colors.backdrop },
  fill: { flex: 1 },
  sheet: { height: "100%", flexDirection: "row" },
}));

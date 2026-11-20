// The views inside a tool (Journal's Log, Trends, and Trackers; Visits' Appointments and Prep): a pill row of tabs,
// each with its own icon, the open one filled.
import { Text, View } from "react-native";
import { Tap } from "./Tap";
import { Icon, IconName } from "./Icon";
import { colors, radius, themed } from "./theme";

export function SegmentTabs<K extends string>({ items, value, onChange }: { items: { key: K; label: string; icon: IconName }[]; value: K; onChange: (k: K) => void }) {
  return (
    <View style={styles.tabs} accessibilityRole="tablist">
      {items.map((t) => {
        const on = value === t.key;
        return (
          <Tap key={t.key} style={[styles.tab, on && styles.tabOn]} onPress={() => onChange(t.key)} accessibilityRole="tab" accessibilityState={{ selected: on }}>
            <Icon name={t.icon} size={16} color={on ? colors.onPrimary : colors.muted} />
            <Text style={[styles.tabText, on && styles.tabTextOn]} numberOfLines={1}>
              {t.label}
            </Text>
          </Tap>
        );
      })}
    </View>
  );
}

// A heading inside a tool with its icon in front ("Today", "Find care nearby").
export function IconHeading({ icon, text, tint }: { icon: IconName; text: string; tint?: string }) {
  return (
    <View style={styles.heading}>
      <Icon name={icon} size={18} color={tint ?? colors.primary} />
      <Text style={styles.headingText} accessibilityRole="header">
        {text}
      </Text>
    </View>
  );
}

const styles = themed(() => ({
  tabs: { flexDirection: "row", gap: 4, padding: 4, borderRadius: radius.pill, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.hairline },
  tab: { flex: 1, flexDirection: "row", gap: 6, minHeight: 40, paddingHorizontal: 8, alignItems: "center", justifyContent: "center", borderRadius: radius.pill },
  tabOn: { backgroundColor: colors.primary },
  tabText: { color: colors.text, fontSize: 14, fontWeight: "600", flexShrink: 1 },
  tabTextOn: { color: colors.onPrimary },
  heading: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 6, marginBottom: 4 },
  headingText: { fontSize: 17, fontWeight: "700", color: colors.text },
}));

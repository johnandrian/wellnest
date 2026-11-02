// "Health tools": one header button for the journal, reminders, visit summary and care, as tabs.
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors } from "./theme";
import type { Strings } from "./i18n";
import { JournalPanel } from "./JournalPanel";
import { MedicationsPanel } from "./MedicationsPanel";
import { VisitPanel } from "./VisitPanel";
import { CarePanel } from "./CarePanel";

export type HubTab = "journal" | "reminders" | "visit" | "care";

const TABS: { tab: HubTab; icon: keyof typeof Ionicons.glyphMap; label: (s: Strings) => string }[] = [
  { tab: "journal", icon: "pulse", label: (s) => s.tabJournal },
  { tab: "reminders", icon: "medkit-outline", label: (s) => s.tabMeds },
  { tab: "visit", icon: "clipboard-outline", label: (s) => s.tabVisit },
  { tab: "care", icon: "location-outline", label: (s) => s.tabCare },
];

export function HubPanel({ tab, onTab, s }: { tab: HubTab; onTab: (t: HubTab) => void; s: Strings }) {
  return (
    <View style={styles.wrap}>
      <View style={styles.tabs} accessibilityRole="tablist">
        {TABS.map((t) => (
          <Pressable
            key={t.tab}
            style={[styles.tab, tab === t.tab && styles.tabOn]}
            onPress={() => onTab(t.tab)}
            accessibilityRole="tab"
            accessibilityState={{ selected: tab === t.tab }}
          >
            <Ionicons name={t.icon} size={16} color={tab === t.tab ? colors.primary : colors.muted} />
            <Text style={[styles.tabText, tab === t.tab && styles.tabTextOn]} numberOfLines={1}>
              {t.label(s)}
            </Text>
          </Pressable>
        ))}
      </View>
      {tab === "journal" && <JournalPanel s={s} />}
      {tab === "reminders" && <MedicationsPanel s={s} />}
      {tab === "visit" && <VisitPanel s={s} />}
      {tab === "care" && <CarePanel s={s} />}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flexShrink: 1, maxHeight: "80%" },
  tabs: { flexDirection: "row", backgroundColor: "#fff", borderBottomWidth: 1, borderBottomColor: colors.border, paddingHorizontal: 8 },
  tab: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 4, paddingVertical: 10, borderBottomWidth: 2, borderBottomColor: "transparent", minWidth: 0 },
  tabOn: { borderBottomColor: colors.primary },
  tabText: { color: colors.muted, fontSize: 13, fontWeight: "600", flexShrink: 1 },
  tabTextOn: { color: colors.primary },
});

// "Health tools": one header button for the journal, medications, appointments, visit summaries and care, as tabs.
// The tab bar scrolls sideways on narrow phones.
import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors } from "./theme";
import type { Strings } from "./i18n";
import { JournalPanel } from "./JournalPanel";
import { MedicationsPanel } from "./MedicationsPanel";
import { VisitsPanel } from "./VisitsPanel";
import { VisitPanel } from "./VisitPanel";
import { CarePanel } from "./CarePanel";

export type HubTab = "journal" | "reminders" | "visits" | "visit" | "care";

const TABS: { tab: HubTab; icon: keyof typeof Ionicons.glyphMap; label: (s: Strings) => string }[] = [
  { tab: "journal", icon: "pulse", label: (s) => s.tabJournal },
  { tab: "reminders", icon: "medkit-outline", label: (s) => s.tabMeds },
  { tab: "visits", icon: "calendar-outline", label: (s) => s.tabVisits },
  { tab: "visit", icon: "clipboard-outline", label: (s) => s.tabVisit },
  { tab: "care", icon: "location-outline", label: (s) => s.tabCare },
];

export function HubPanel({ tab, onTab, s }: { tab: HubTab; onTab: (t: HubTab) => void; s: Strings }) {
  // "Make a visit summary" on an appointment opens the summary tab with its title as the reason.
  const [summaryReason, setSummaryReason] = useState<string | undefined>(undefined);
  return (
    <View style={styles.wrap}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.tabsScroll} contentContainerStyle={styles.tabs} accessibilityRole="tablist">
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
      </ScrollView>
      {tab === "journal" && <JournalPanel s={s} />}
      {tab === "reminders" && <MedicationsPanel s={s} />}
      {tab === "visits" && (
        <VisitsPanel
          s={s}
          onPrepare={(reason) => {
            setSummaryReason(reason);
            onTab("visit");
          }}
        />
      )}
      {tab === "visit" && <VisitPanel s={s} initialReason={summaryReason} key={summaryReason ?? ""} />}
      {tab === "care" && <CarePanel s={s} />}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flexShrink: 1, maxHeight: "80%" },
  tabsScroll: { flexGrow: 0, backgroundColor: "#fff", borderBottomWidth: 1, borderBottomColor: colors.border },
  tabs: { flexDirection: "row", paddingHorizontal: 8, minWidth: "100%" },
  tab: { flexGrow: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 4, paddingVertical: 10, paddingHorizontal: 10, borderBottomWidth: 2, borderBottomColor: "transparent" },
  tabOn: { borderBottomColor: colors.primary },
  tabText: { color: colors.muted, fontSize: 13, fontWeight: "600" },
  tabTextOn: { color: colors.primary },
});

// "Health tools": one header button for the journal, medications, appointments, visit summaries and care, as tabs.
// It covers the whole screen; the Chat button at the top right goes back to the conversation.
// The tab bar scrolls sideways on narrow phones.
import { useState } from "react";
import { Platform, ScrollView, StyleSheet, Text, View } from "react-native";
import { Tap } from "./Tap";
import { Ionicons } from "@expo/vector-icons";
import { colors, radius, TOUCH } from "./theme";
import type { Strings } from "./i18n";
import { JournalPanel } from "./JournalPanel";
import { MedicationsPanel } from "./MedicationsPanel";
import { VisitsPanel } from "./VisitsPanel";
import { VisitPanel } from "./VisitPanel";
import { CarePanel } from "./CarePanel";
import { ExercisePanel } from "./ExercisePanel";

export type HubTab = "journal" | "reminders" | "exercise" | "visits" | "visit" | "care";

const TABS: { tab: HubTab; icon: keyof typeof Ionicons.glyphMap; label: (s: Strings) => string }[] = [
  { tab: "journal", icon: "pulse", label: (s) => s.tabJournal },
  { tab: "reminders", icon: "medkit-outline", label: (s) => s.tabMeds },
  { tab: "exercise", icon: "barbell-outline", label: (s) => s.tabExercise },
  { tab: "visits", icon: "calendar-outline", label: (s) => s.tabVisits },
  { tab: "visit", icon: "clipboard-outline", label: (s) => s.tabVisit },
  { tab: "care", icon: "location-outline", label: (s) => s.tabCare },
];

export function HubPanel({ tab, onTab, onClose, s }: { tab: HubTab; onTab: (t: HubTab) => void; onClose: () => void; s: Strings }) {
  // "Make a visit summary" on an appointment opens the summary tab with its title as the reason.
  const [summaryReason, setSummaryReason] = useState<string | undefined>(undefined);
  return (
    <View style={styles.wrap}>
      <View style={styles.header}>
        <Text style={styles.title} numberOfLines={1}>
          {s.hubTitle}
        </Text>
        <Tap
          style={({ pressed }) => [styles.back, pressed && styles.pressed]}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel={s.backToChat}
        >
          <Ionicons name="chatbubble-ellipses-outline" size={18} color={colors.primary} />
          <Text style={styles.backText}>{s.backToChat}</Text>
        </Tap>
      </View>
      <View style={styles.tabBar}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.tabsScroll} contentContainerStyle={styles.tabs} accessibilityRole="tablist">
          {TABS.map((t) => (
            <Tap
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
            </Tap>
          ))}
        </ScrollView>
      </View>
      {tab === "journal" && <JournalPanel s={s} />}
      {tab === "reminders" && <MedicationsPanel s={s} />}
      {tab === "exercise" && <ExercisePanel s={s} />}
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
  wrap: { flex: 1 },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 16,
    // Room for the status bar / notch on phones, like the chat header.
    paddingTop: Platform.OS === "web" ? 12 : 56,
    paddingBottom: 10,
    backgroundColor: colors.surface,
  },
  title: { fontSize: 18, fontWeight: "700", color: colors.text, flexShrink: 1 },
  back: { flexDirection: "row", alignItems: "center", gap: 6, minHeight: TOUCH, borderWidth: 1, borderColor: colors.primary, borderRadius: radius.pill, paddingHorizontal: 14 },
  backText: { color: colors.primary, fontWeight: "600", fontSize: 14 },
  pressed: { opacity: 0.6 },
  tabBar: { backgroundColor: colors.surface, borderBottomWidth: 1, borderBottomColor: colors.border },
  // Lined up with the content below it (max 760 wide) on tablets and desktop.
  tabsScroll: { flexGrow: 0, width: "100%", maxWidth: 792, alignSelf: "center" },
  // Pill tabs: the selected one is filled, so it doesn't rely on colour alone.
  tabs: { flexDirection: "row", gap: 6, paddingHorizontal: 12, paddingBottom: 10, minWidth: "100%" },
  tab: { flexGrow: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, minHeight: TOUCH, paddingHorizontal: 12, borderRadius: radius.pill },
  tabOn: { backgroundColor: colors.primarySoft },
  tabText: { color: colors.muted, fontSize: 14, fontWeight: "600" },
  tabTextOn: { color: colors.primary },
});

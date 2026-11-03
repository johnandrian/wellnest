// "Health tools": a dashboard home (./HomePanel) with the journal, medications, exercise, appointments, reports and
// care one tap away. It covers the whole screen; the Chat button at the top right goes back to the conversation.
// Inside a tool, the back button returns to the dashboard and the row under the header switches tools.
import { useState } from "react";
import { Platform, ScrollView, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useQuery } from "convex/react";
import { api } from "../convex/_generated/api";
import { Tap } from "./Tap";
import { Icon, IconName } from "./Icon";
import { colors, radius, tint, TOUCH } from "./theme";
import type { Strings } from "./i18n";
import { HomePanel } from "./HomePanel";
import { JournalPanel } from "./JournalPanel";
import { MedicationsPanel } from "./MedicationsPanel";
import { VisitsPanel } from "./VisitsPanel";
import { VisitPanel } from "./VisitPanel";
import { CarePanel } from "./CarePanel";
import { ExercisePanel } from "./ExercisePanel";

export type ToolTab = "journal" | "reminders" | "exercise" | "visits" | "visit" | "care";
export type HubTab = "home" | ToolTab;

export const TOOLS: { tab: ToolTab; icon: IconName; tint: keyof typeof tint; label: (s: Strings) => string; desc: (s: Strings) => string }[] = [
  { tab: "journal", icon: "journal", tint: "journal", label: (s) => s.tabJournal, desc: (s) => s.toolJournalDesc },
  { tab: "reminders", icon: "medications", tint: "medications", label: (s) => s.tabMeds, desc: (s) => s.toolMedsDesc },
  { tab: "exercise", icon: "exercise", tint: "exercise", label: (s) => s.tabExercise, desc: (s) => s.toolExerciseDesc },
  { tab: "visits", icon: "appointments", tint: "appointments", label: (s) => s.tabVisits, desc: (s) => s.toolVisitsDesc },
  { tab: "visit", icon: "reports", tint: "reports", label: (s) => s.tabVisit, desc: (s) => s.toolVisitDesc },
  { tab: "care", icon: "care", tint: "care", label: (s) => s.tabCare, desc: (s) => s.toolCareDesc },
];

function greeting(s: Strings, name: string | null) {
  const h = new Date().getHours();
  const hi = h < 12 ? s.greetMorning : h < 18 ? s.greetAfternoon : s.greetEvening;
  return name ? `${hi}, ${name.split(" ")[0]}` : hi;
}

export function HubPanel({ tab, onTab, onClose, s }: { tab: HubTab; onTab: (t: HubTab) => void; onClose: () => void; s: Strings }) {
  // "Make a visit summary" on an appointment opens the summary tab with its title as the reason.
  const [summaryReason, setSummaryReason] = useState<string | undefined>(undefined);
  const me = useQuery(api.chat.me);
  const tool = TOOLS.find((t) => t.tab === tab);
  return (
    <View style={styles.wrap}>
      <View style={styles.header}>
        <View style={styles.headerRow}>
          {tool ? (
            <Tap style={styles.round} onPress={() => onTab("home")} accessibilityRole="button" accessibilityLabel={s.dashboard}>
              <Ionicons name="chevron-back" size={22} color={colors.onPrimary} />
            </Tap>
          ) : (
            <View style={styles.badge}>
              <Icon name="dashboard" size={20} color={colors.onPrimary} />
            </View>
          )}
          <View style={styles.titles}>
            <Text style={styles.kicker} numberOfLines={1}>
              {tool ? s.dashboard : new Date().toLocaleDateString(s.locale, { weekday: "long", month: "long", day: "numeric" })}
            </Text>
            <Text style={styles.title} numberOfLines={1} accessibilityRole="header">
              {tool ? tool.label(s) : greeting(s, me?.name ?? null)}
            </Text>
          </View>
          <Tap style={styles.chat} onPress={onClose} accessibilityRole="button" accessibilityLabel={s.backToChat}>
            <Ionicons name="chatbubble-ellipses-outline" size={18} color={colors.primary} />
            <Text style={styles.chatText}>{s.backToChat}</Text>
          </Tap>
        </View>
        {tool && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.tabsScroll} contentContainerStyle={styles.tabs} accessibilityRole="tablist">
            {TOOLS.map((t) => {
              const on = tab === t.tab;
              return (
                <Tap
                  key={t.tab}
                  style={[styles.tab, on && styles.tabOn]}
                  onPress={() => onTab(t.tab)}
                  accessibilityRole="tab"
                  accessibilityState={{ selected: on }}
                >
                  <Icon name={t.icon} size={16} color={on ? colors.primary : colors.onPrimary} />
                  <Text style={[styles.tabText, on && styles.tabTextOn]} numberOfLines={1}>
                    {t.label(s)}
                  </Text>
                </Tap>
              );
            })}
          </ScrollView>
        )}
      </View>
      {tab === "home" && <HomePanel s={s} onOpen={onTab} onChat={onClose} />}
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
  // The teal band: it carries the greeting on the dashboard and the tool switcher inside a tool.
  header: {
    backgroundColor: colors.primary,
    // Room for the status bar / notch on phones, like the chat header.
    paddingTop: Platform.OS === "web" ? 14 : 56,
    paddingBottom: 12,
    borderBottomLeftRadius: radius.lg,
    borderBottomRightRadius: radius.lg,
  },
  headerRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16, width: "100%", maxWidth: 792, alignSelf: "center" },
  round: { width: TOUCH, height: TOUCH, borderRadius: TOUCH / 2, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(255,255,255,0.16)" },
  badge: { width: TOUCH, height: TOUCH, borderRadius: radius.md, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(255,255,255,0.16)" },
  titles: { flex: 1, minWidth: 0 },
  kicker: { color: colors.primarySoft, fontSize: 13, fontWeight: "600" },
  title: { color: colors.onPrimary, fontSize: 21, fontWeight: "700", marginTop: 1 },
  chat: { flexDirection: "row", alignItems: "center", gap: 6, minHeight: TOUCH, borderRadius: radius.pill, paddingHorizontal: 14, backgroundColor: colors.surface },
  chatText: { color: colors.primary, fontWeight: "700", fontSize: 14 },
  tabsScroll: { flexGrow: 0, width: "100%", maxWidth: 792, alignSelf: "center", marginTop: 12 },
  // Pill tabs: the selected one is filled white, so it doesn't rely on colour alone.
  tabs: { flexDirection: "row", gap: 6, paddingHorizontal: 12, minWidth: "100%" },
  tab: { flexGrow: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, minHeight: 40, paddingHorizontal: 12, borderRadius: radius.pill, backgroundColor: "rgba(255,255,255,0.12)" },
  tabOn: { backgroundColor: colors.surface },
  tabText: { color: colors.onPrimary, fontSize: 14, fontWeight: "600" },
  tabTextOn: { color: colors.primary },
});

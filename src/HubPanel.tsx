// "Health tools": a dashboard home (./HomePanel) with the journal, medications, exercise, appointments, guides,
// reports, records, care and the Care Circle one tap away. It's the home screen and covers the whole width; the gear
// opens Settings under the header and the Chat button at the top right goes to the conversation.
// Inside a tool, the back button returns to the dashboard and the row under the header switches tools.
import { ReactNode, useState } from "react";
import { Platform, ScrollView, Text, useWindowDimensions, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useQuery } from "convex/react";
import { api } from "../convex/_generated/api";
import { Tap } from "./Tap";
import { Icon, IconName } from "./Icon";
import { colors, floatingBar, kicker, radius, tint, TOUCH, themed } from "./theme";
import type { Strings } from "./i18n";
import { HomePanel } from "./HomePanel";
import { JournalPanel } from "./JournalPanel";
import { MedicationsPanel } from "./MedicationsPanel";
import { VisitsPanel } from "./VisitsPanel";
import { VisitPanel } from "./VisitPanel";
import { CarePanel } from "./CarePanel";
import { ExercisePanel } from "./ExercisePanel";
import { RecordsPanel } from "./RecordsPanel";
import { CirclePanel } from "./CirclePanel";
import { GuidesPanel } from "./GuidesPanel";
import { Enter, SwapIcon } from "./Motion";

export type ToolTab = "journal" | "reminders" | "exercise" | "visits" | "guides" | "visit" | "records" | "care" | "circle";
export type HubTab = "home" | ToolTab;

export const TOOLS: { tab: ToolTab; icon: IconName; tint: keyof typeof tint; label: (s: Strings) => string; desc: (s: Strings) => string }[] = [
  { tab: "journal", icon: "journal", tint: "journal", label: (s) => s.tabJournal, desc: (s) => s.toolJournalDesc },
  { tab: "reminders", icon: "medications", tint: "medications", label: (s) => s.tabMeds, desc: (s) => s.toolMedsDesc },
  { tab: "exercise", icon: "exercise", tint: "exercise", label: (s) => s.tabExercise, desc: (s) => s.toolExerciseDesc },
  { tab: "visits", icon: "appointments", tint: "appointments", label: (s) => s.tabVisits, desc: (s) => s.toolVisitsDesc },
  { tab: "guides", icon: "guides", tint: "guides", label: (s) => s.tabGuides, desc: (s) => s.toolGuidesDesc },
  { tab: "visit", icon: "reports", tint: "reports", label: (s) => s.tabVisit, desc: (s) => s.toolVisitDesc },
  { tab: "records", icon: "records", tint: "records", label: (s) => s.tabRecords, desc: (s) => s.toolRecordsDesc },
  { tab: "care", icon: "care", tint: "care", label: (s) => s.tabCare, desc: (s) => s.toolCareDesc },
  { tab: "circle", icon: "circle", tint: "circle", label: (s) => s.tabCircle, desc: (s) => s.toolCircleDesc },
];

export function greeting(s: Strings, name: string | null) {
  const h = new Date().getHours();
  const hi = h < 12 ? s.greetMorning : h < 18 ? s.greetAfternoon : s.greetEvening;
  return name ? `${hi}, ${name.split(" ")[0]}` : hi;
}

export function HubPanel({
  tab,
  onTab,
  onClose,
  s,
  settingsOpen,
  onSettings,
  children,
}: {
  tab: HubTab;
  onTab: (t: HubTab) => void;
  onClose: () => void;
  s: Strings;
  settingsOpen: boolean;
  onSettings: () => void;
  // Settings, dropping open under the header (src/Chat.tsx).
  children?: ReactNode;
}) {
  // "Make a visit summary" on an appointment opens the summary tab with its title as the reason.
  const [summaryReason, setSummaryReason] = useState<string | undefined>(undefined);
  const me = useQuery(api.chat.me);
  const tool = TOOLS.find((t) => t.tab === tab);
  // On a phone the Chat button is just its icon, so the greeting has room next to the gear.
  const narrow = useWindowDimensions().width < 440;
  return (
    <View style={styles.wrap}>
      <View style={styles.header}>
        <View style={styles.headerRow}>
          {tool ? (
            <Tap style={styles.round} onPress={() => onTab("home")} accessibilityRole="button" accessibilityLabel={s.dashboard}>
              <SwapIcon id="back">
                <Ionicons name="chevron-back" size={22} color={colors.onBar} />
              </SwapIcon>
            </Tap>
          ) : (
            <View style={styles.badge}>
              <SwapIcon id="home">
                <Icon name="dashboard" size={20} color={colors.onBar} />
              </SwapIcon>
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
          <Tap style={styles.round} onPress={onSettings} accessibilityRole="button" accessibilityLabel={settingsOpen ? s.closeSettings : s.settings}>
            <SwapIcon id={settingsOpen ? "close" : "settings"}>
              <Ionicons name={settingsOpen ? "close" : "settings-outline"} size={22} color={colors.onBar} />
            </SwapIcon>
          </Tap>
          <Tap style={[styles.chat, narrow && styles.chatNarrow]} onPress={onClose} accessibilityRole="button" accessibilityLabel={s.backToChat}>
            <Ionicons name="chatbubble-ellipses-outline" size={18} color={colors.onBarAction} />
            {!narrow && <Text style={styles.chatText}>{s.backToChat}</Text>}
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
                  <Icon name={t.icon} size={16} color={on ? colors.onBarAction : colors.onBar} />
                  <Text style={[styles.tabText, on && styles.tabTextOn]} numberOfLines={1}>
                    {t.label(s)}
                  </Text>
                </Tap>
              );
            })}
          </ScrollView>
        )}
      </View>
      {children}
      {/* Each tool fades up into place when it opens. */}
      <Enter key={tab} style={styles.body} from={12}>
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
        {tab === "guides" && <GuidesPanel s={s} onOpen={onTab} />}
        {tab === "visit" && <VisitPanel s={s} initialReason={summaryReason} key={summaryReason ?? ""} />}
        {tab === "records" && <RecordsPanel s={s} />}
        {tab === "care" && <CarePanel s={s} />}
        {tab === "circle" && <CirclePanel s={s} />}
      </Enter>
    </View>
  );
}

const styles = themed(() => ({
  wrap: { flex: 1 },
  body: { flex: 1 },
  // The teal band: it carries the greeting on the dashboard and the tool switcher inside a tool.
  header: {
    backgroundColor: colors.bar,
    // Room for the status bar / notch on phones, like the chat header.
    paddingTop: Platform.OS === "web" ? 14 : 56,
    paddingBottom: 12,
    borderBottomLeftRadius: radius.lg,
    borderBottomRightRadius: radius.lg,
    ...floatingBar(),
  },
  headerRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 16, width: "100%" },
  round: { width: TOUCH, height: TOUCH, borderRadius: TOUCH / 2, alignItems: "center", justifyContent: "center", backgroundColor: colors.barFill },
  badge: { width: TOUCH, height: TOUCH, borderRadius: radius.md, alignItems: "center", justifyContent: "center", backgroundColor: colors.barFill },
  titles: { flex: 1, minWidth: 0 },
  kicker: { color: colors.onBarMuted, fontSize: 13, fontWeight: "600", ...kicker() },
  title: { color: colors.onBar, fontSize: 21, fontWeight: "700", marginTop: 1 },
  chat: { flexDirection: "row", alignItems: "center", gap: 6, minHeight: TOUCH, borderRadius: radius.pill, paddingHorizontal: 14, backgroundColor: colors.barAction },
  chatNarrow: { width: TOUCH, paddingHorizontal: 0, justifyContent: "center" },
  chatText: { color: colors.onBarAction, fontWeight: "700", fontSize: 14 },
  tabsScroll: { flexGrow: 0, width: "100%", marginTop: 12 },
  // Pill tabs: the selected one is filled white, so it doesn't rely on colour alone.
  tabs: { flexDirection: "row", gap: 6, paddingHorizontal: 12, minWidth: "100%" },
  tab: { flexGrow: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, minHeight: 40, paddingHorizontal: 12, borderRadius: radius.pill, backgroundColor: colors.barFill },
  tabOn: { backgroundColor: colors.barAction },
  tabText: { color: colors.onBar, fontSize: 14, fontWeight: "600" },
  tabTextOn: { color: colors.onBarAction },
}));

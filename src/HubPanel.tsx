// "Health tools": a dashboard home (./HomePanel) with every tool one tap away, grouped into Track, Medications, Visits,
// Care, and Actions (GROUPS). It's the home screen and covers the whole width; the gear opens Settings under the header
// and the Chat button at the top right goes to the conversation. Inside a tool, the back button returns to the
// dashboard, the row under the header switches groups (back to the tool last open in that group), and a second row
// switches tools within a group that has more than one.
import { ReactNode, useRef, useState } from "react";
import { ScrollView, Text, useWindowDimensions, View } from "react-native";
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
import { SharePanel } from "./SharePanel";
import { CarePanel } from "./CarePanel";
import { ExercisePanel } from "./ExercisePanel";
import { RecordsPanel } from "./RecordsPanel";
import { CirclePanel } from "./CirclePanel";
import { AgentPanel } from "./AgentPanel";
import { Enter, SwapIcon } from "./Motion";
import { barTop, useInsets } from "./safeArea";
import { useNow } from "./useNow";

export type ToolTab = "journal" | "reminders" | "exercise" | "visits" | "visit" | "records" | "care" | "circle" | "agent";
// "prep" opens Visits on its Prep view.
export type HubTab = "home" | ToolTab | "prep";

export const TOOLS: { tab: ToolTab; icon: IconName; tint: keyof typeof tint; label: (s: Strings) => string; desc: (s: Strings) => string }[] = [
  { tab: "journal", icon: "journal", tint: "journal", label: (s) => s.tabJournal, desc: (s) => s.toolJournalDesc },
  { tab: "reminders", icon: "medications", tint: "medications", label: (s) => s.tabMeds, desc: (s) => s.toolMedsDesc },
  { tab: "exercise", icon: "exercise", tint: "exercise", label: (s) => s.tabExercise, desc: (s) => s.toolExerciseDesc },
  { tab: "visits", icon: "appointments", tint: "appointments", label: (s) => s.tabVisits, desc: (s) => s.toolVisitsDesc },
  { tab: "visit", icon: "share", tint: "reports", label: (s) => s.tabVisit, desc: (s) => s.toolVisitDesc },
  { tab: "records", icon: "records", tint: "records", label: (s) => s.tabRecords, desc: (s) => s.toolRecordsDesc },
  { tab: "care", icon: "care", tint: "care", label: (s) => s.tabCare, desc: (s) => s.toolCareDesc },
  { tab: "circle", icon: "circle", tint: "circle", label: (s) => s.tabCircle, desc: (s) => s.toolCircleDesc },
  { tab: "agent", icon: "agent", tint: "agent", label: (s) => s.tabAgent, desc: (s) => s.toolAgentDesc },
];

export type GroupKey = "track" | "meds" | "visits" | "care" | "actions";
export const GROUPS: { key: GroupKey; icon: IconName; label: (s: Strings) => string; tools: ToolTab[] }[] = [
  { key: "track", icon: "journal", label: (s) => s.groupTrack, tools: ["journal", "exercise"] },
  { key: "meds", icon: "medications", label: (s) => s.tabMeds, tools: ["reminders"] },
  { key: "visits", icon: "appointments", label: (s) => s.tabVisits, tools: ["visits", "visit", "records"] },
  { key: "care", icon: "care", label: (s) => s.tabCare, tools: ["care", "circle"] },
  { key: "actions", icon: "agent", label: (s) => s.tabAgent, tools: ["agent"] },
];
export const groupOf = (tab: ToolTab) => GROUPS.find((g) => g.tools.includes(tab))!;
const toolOf = (tab: ToolTab) => TOOLS.find((t) => t.tab === tab)!;

export function greeting(s: Strings, name: string | null, at = Date.now()) {
  const h = new Date(at).getHours();
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
  const [summaryFor, setSummaryFor] = useState<{ id?: string; title: string } | undefined>(undefined);
  const me = useQuery(api.chat.me);
  // The date and greeting move on at midnight and through the day while the screen stays open.
  const now = useNow();
  const tool = TOOLS.find((t) => t.tab === (tab === "prep" ? "visits" : tab));
  const waiting = useQuery(api.agent.waiting);
  const group = tool ? groupOf(tool.tab) : null;
  // The tool last open in each group, so switching back lands where you were.
  const lastIn = useRef<Partial<Record<GroupKey, ToolTab>>>({});
  if (tool && group) lastIn.current[group.key] = tool.tab;
  // On a phone the Chat button is just its icon, so the greeting has room next to the gear.
  const narrow = useWindowDimensions().width < 440;
  const insets = useInsets();
  return (
    <View style={styles.wrap}>
      <View style={[styles.header, barTop(insets.top)]}>
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
              {tool ? s.dashboard : new Date(now).toLocaleDateString(s.locale, { weekday: "long", month: "long", day: "numeric" })}
            </Text>
            <Text style={styles.title} numberOfLines={1} accessibilityRole="header">
              {tool ? tool.label(s) : greeting(s, me?.name ?? null, now)}
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
        {tool && group && (
          <>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.tabsScroll} contentContainerStyle={styles.tabs} accessibilityRole="tablist">
              {GROUPS.map((g) => {
                const on = g.key === group.key;
                return (
                  <Tap
                    key={g.key}
                    style={[styles.tab, on && styles.tabOn]}
                    onPress={() => onTab(lastIn.current[g.key] ?? g.tools[0])}
                    accessibilityRole="tab"
                    accessibilityState={{ selected: on }}
                  >
                    <Icon name={g.icon} size={16} color={on ? colors.onBarAction : colors.onBar} />
                    <Text style={[styles.tabText, on && styles.tabTextOn]} numberOfLines={1}>
                      {g.label(s)}
                    </Text>
                    {g.key === "actions" && !!waiting?.count && <CountBadge n={waiting.count} urgent={waiting.urgent} s={s} />}
                  </Tap>
                );
              })}
            </ScrollView>
            {group.tools.length > 1 && (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.subScroll} contentContainerStyle={styles.tabs} accessibilityRole="tablist">
                {group.tools.map((t) => {
                  const on = tool.tab === t;
                  return (
                    <Tap key={t} style={[styles.sub, on && styles.subOn]} onPress={() => onTab(t)} accessibilityRole="tab" accessibilityState={{ selected: on }}>
                      <Text style={[styles.subText, on && styles.subTextOn]} numberOfLines={1}>
                        {toolOf(t).label(s)}
                      </Text>
                    </Tap>
                  );
                })}
              </ScrollView>
            )}
          </>
        )}
      </View>
      {children}
      {/* Each tool fades up into place when it opens. */}
      <Enter key={tab} style={styles.body} from={12}>
        {tab === "home" && <HomePanel s={s} onOpen={onTab} onChat={onClose} />}
        {tab === "journal" && <JournalPanel s={s} />}
        {tab === "reminders" && <MedicationsPanel s={s} />}
        {tab === "exercise" && <ExercisePanel s={s} />}
        {(tab === "visits" || tab === "prep") && (
          <VisitsPanel
            s={s}
            openPrep={tab === "prep"}
            onPrepare={(visit) => {
              setSummaryFor(visit);
              onTab("visit");
            }}
          />
        )}
        {tab === "visit" && <SharePanel s={s} forVisit={summaryFor} key={summaryFor?.id ?? summaryFor?.title ?? ""} />}
        {tab === "records" && <RecordsPanel s={s} />}
        {tab === "care" && <CarePanel s={s} />}
        {tab === "circle" && <CirclePanel s={s} />}
        {tab === "agent" && <AgentPanel s={s} />}
      </Enter>
    </View>
  );
}

// A small count on the Actions tab and tile: red when one of them is urgent.
export function CountBadge({ n, urgent, s }: { n: number; urgent: boolean; s: Strings }) {
  return (
    <View style={[styles.count, urgent && styles.countUrgent]} accessibilityLabel={s.actionsBadge.replace("{n}", String(n))}>
      <Text style={[styles.countText, urgent && styles.countTextUrgent]}>{n > 9 ? "9+" : n}</Text>
    </View>
  );
}

const styles = themed(() => ({
  wrap: { flex: 1 },
  count: { minWidth: 20, height: 20, borderRadius: 10, paddingHorizontal: 5, alignItems: "center", justifyContent: "center", backgroundColor: colors.primary },
  countUrgent: { backgroundColor: colors.danger },
  countText: { color: colors.onPrimary, fontSize: 12, fontWeight: "700" },
  countTextUrgent: { color: colors.onDanger },
  body: { flex: 1 },
  // The floating top bar: it carries the greeting on the dashboard and the tool switcher inside a tool.
  header: {
    backgroundColor: colors.bar,
    // Floats below the status bar / notch on a phone (barTop in ./safeArea.ts).
    borderBottomLeftRadius: radius.lg,
    borderBottomRightRadius: radius.lg,
    ...floatingBar(),
  },
  headerRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 16, width: "100%" },
  round: { width: TOUCH, height: TOUCH, borderRadius: TOUCH / 2, alignItems: "center", justifyContent: "center", backgroundColor: colors.barFill },
  badge: { width: TOUCH, height: TOUCH, borderRadius: radius.md, alignItems: "center", justifyContent: "center", backgroundColor: colors.barFill },
  titles: { flex: 1, minWidth: 0 },
  kicker: { color: colors.onBarMuted, fontWeight: "600", ...kicker() },
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
  // The tools inside a group: smaller, outlined, so the two rows read as levels.
  subScroll: { flexGrow: 0, width: "100%", marginTop: 8 },
  sub: { minHeight: 36, paddingHorizontal: 14, borderRadius: radius.pill, justifyContent: "center", borderWidth: 1, borderColor: colors.barFill },
  subOn: { backgroundColor: colors.barFill, borderColor: colors.onBar },
  subText: { color: colors.onBarMuted, fontSize: 13, fontWeight: "600" },
  subTextOn: { color: colors.onBar },
}));

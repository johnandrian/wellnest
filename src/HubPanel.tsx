// "Health tools": the dashboard (./HomePanel) and every tool. The tool rail (./ToolRail) lists them all, each with its
// own icon: docked on the left on a wide screen, slid in from the menu button on a phone. The top bar names where you
// are, with the notifications bell (./NotificationsButton) and the gear (Settings, opening under the header). Chat is a
// round button at the bottom right: the conversation, or the chat drawer beside the tools on a wide screen.
import { ReactNode, useState } from "react";
import { Text, useWindowDimensions, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useQuery } from "convex/react";
import { api } from "../convex/_generated/api";
import { Tap } from "./Tap";
import { Icon, IconName } from "./Icon";
import { colors, floatingBar, kicker, radius, softShadow, tint, TOUCH, themed } from "./theme";
import type { Strings } from "./i18n";
import { HomePanel } from "./HomePanel";
import { JournalPanel } from "./JournalPanel";
import { MedicationsPanel } from "./MedicationsPanel";
import { VisitsPanel } from "./VisitsPanel";
import { SharePanel } from "./SharePanel";
import { CarePanel } from "./CarePanel";
import { ExercisePanel } from "./ExercisePanel";
import { RecordsPanel } from "./RecordsPanel";
import { NotificationsButton } from "./NotificationsButton";
import { AgentPanel } from "./AgentPanel";
import { Enter, SwapIcon } from "./Motion";
import { barTop, useInsets } from "./safeArea";
import { useNow } from "./useNow";
import { RailSheet, ToolRail } from "./ToolRail";
import { readFlag, writeFlag } from "./prefs";

export type ToolTab = "journal" | "reminders" | "exercise" | "visits" | "visit" | "records" | "care" | "agent";
// "prep" opens Visits on its Prep view, and "circle" opens Care on its Care Circle view.
export type HubTab = "home" | ToolTab | "prep" | "circle";
// The tool a tab belongs to ("home" stays "home").
export const toolTabOf = (tab: HubTab): ToolTab | "home" => (tab === "prep" ? "visits" : tab === "circle" ? "care" : tab);

export const TOOLS: { tab: ToolTab; icon: IconName; tint: keyof typeof tint; label: (s: Strings) => string; desc: (s: Strings) => string }[] = [
  { tab: "journal", icon: "journal", tint: "journal", label: (s) => s.tabJournal, desc: (s) => s.toolJournalDesc },
  { tab: "reminders", icon: "medications", tint: "medications", label: (s) => s.tabMeds, desc: (s) => s.toolMedsDesc },
  { tab: "exercise", icon: "exercise", tint: "exercise", label: (s) => s.tabExercise, desc: (s) => s.toolExerciseDesc },
  { tab: "visits", icon: "appointments", tint: "appointments", label: (s) => s.tabVisits, desc: (s) => s.toolVisitsDesc },
  { tab: "visit", icon: "share", tint: "reports", label: (s) => s.tabVisit, desc: (s) => s.toolVisitDesc },
  { tab: "records", icon: "records", tint: "records", label: (s) => s.tabRecords, desc: (s) => s.toolRecordsDesc },
  { tab: "care", icon: "care", tint: "care", label: (s) => s.tabCare, desc: (s) => s.toolCareDesc },
  { tab: "agent", icon: "agent", tint: "agent", label: (s) => s.tabAgent, desc: (s) => s.toolAgentDesc },
];

// Room the panel needs before the rail docks beside the tool rather than sliding in from the menu button.
const RAIL_MIN_ROOM = 900;
const FOLD_KEY = "wellnest.railFolded";

export function greeting(s: Strings, name: string | null, at = Date.now()) {
  const { hi, first } = greetingParts(s, name, at);
  return first ? `${hi}, ${first}` : hi;
}

// The greeting in two parts, so the top bar can set the name in bold.
export function greetingParts(s: Strings, name: string | null, at = Date.now()) {
  const h = new Date(at).getHours();
  return { hi: h < 12 ? s.greetMorning : h < 18 ? s.greetAfternoon : s.greetEvening, first: name ? name.split(" ")[0] : null };
}

export function HubPanel({
  tab,
  onTab,
  onClose,
  s,
  settingsOpen,
  onSettings,
  chatOpen = false,
  children,
}: {
  tab: HubTab;
  onTab: (t: HubTab) => void;
  // The Chat button: opens the conversation (or, on a wide screen, opens and closes the chat drawer).
  onClose: () => void;
  s: Strings;
  settingsOpen: boolean;
  onSettings: () => void;
  // The chat drawer is open beside the tools (wide screens, src/Chat.tsx).
  chatOpen?: boolean;
  // Settings, dropping open under the header (src/Chat.tsx).
  children?: ReactNode;
}) {
  // "Make a visit summary" on an appointment opens the summary tab with its title as the reason.
  const [summaryFor, setSummaryFor] = useState<{ id?: string; title: string } | undefined>(undefined);
  const me = useQuery(api.chat.me);
  // The date and greeting move on at midnight and through the day while the screen stays open.
  const now = useNow();
  const tool = TOOLS.find((t) => t.tab === toolTabOf(tab));
  const waiting = useQuery(api.agent.waiting);
  const hello = greetingParts(s, me?.name ?? null, now);
  // The rail docks once this panel has room for it (the panel, not the window: the chat drawer may take some).
  const windowWidth = useWindowDimensions().width;
  const [room, setRoom] = useState(windowWidth);
  const docked = room >= RAIL_MIN_ROOM;
  const [folded, setFolded] = useState(() => readFlag(FOLD_KEY, false));
  const [menu, setMenu] = useState(false);
  // On a phone the Chat button is just its icon, so the greeting has room.
  const narrow = room < 440;
  const insets = useInsets();
  const pick = (t: HubTab) => {
    setMenu(false);
    onTab(t);
  };
  const fold = () => {
    writeFlag(FOLD_KEY, !folded);
    setFolded(!folded);
  };
  const c = tool ? tint[tool.tint] : null;
  return (
    <View style={styles.wrap} onLayout={(e) => setRoom(e.nativeEvent.layout.width)}>
      {docked && <ToolRail tab={tab} onTab={pick} s={s} waiting={waiting} folded={folded} onFold={fold} />}
      <View style={styles.main}>
        <View style={[styles.header, barTop(insets.top)]}>
          <View style={styles.headerRow}>
            {docked ? (
              <View style={[styles.badge, c && { backgroundColor: c.bg }]}>
                <SwapIcon id={tool?.tab ?? "home"}>
                  <Icon name={tool?.icon ?? "dashboard"} size={20} color={c ? c.fg : colors.onBar} />
                </SwapIcon>
              </View>
            ) : (
              <Tap style={styles.round} onPress={() => setMenu(true)} accessibilityRole="button" accessibilityLabel={s.menu} accessibilityState={{ expanded: menu }}>
                <Icon name="menu" size={22} color={colors.onBar} />
              </Tap>
            )}
            <View style={styles.titles}>
              <Text style={styles.kicker} numberOfLines={1}>
                {new Date(now).toLocaleDateString(s.locale, { weekday: "long", month: "long", day: "numeric" })}
              </Text>
              {tool ? (
                <Text style={styles.title} numberOfLines={1} accessibilityRole="header">
                  {tool.label(s)}
                </Text>
              ) : (
                // On a phone it may take two lines, so the name is never cut off.
                <Text style={[styles.title, styles.hello, narrow && styles.helloNarrow]} numberOfLines={narrow ? 2 : 1} accessibilityRole="header">
                  {hello.first ? `${hello.hi}, ` : hello.hi}
                  {hello.first && <Text style={styles.name}>{hello.first}</Text>}
                </Text>
              )}
            </View>
            <NotificationsButton s={s} onOpen={pick} />
            <Tap style={styles.round} onPress={onSettings} accessibilityRole="button" accessibilityLabel={settingsOpen ? s.closeSettings : s.settings}>
              <SwapIcon id={settingsOpen ? "close" : "settings"}>
                {settingsOpen ? <Ionicons name="close" size={22} color={colors.onBar} /> : <Icon name="settings" size={22} color={colors.onBar} />}
              </SwapIcon>
            </Tap>
          </View>
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
          {(tab === "care" || tab === "circle") && <CarePanel s={s} openCircle={tab === "circle"} />}
          {tab === "agent" && <AgentPanel s={s} />}
        </Enter>
        {/* The chat, always one tap away at the bottom right; hidden while the chat drawer is open beside it. */}
        {!chatOpen && (
          <Tap
            style={[styles.chat, narrow && styles.chatNarrow, { bottom: 16 + insets.bottom }]}
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel={s.backToChat}
          >
            <Icon name="chat" size={narrow ? 22 : 18} color={colors.onPrimary} />
            {!narrow && <Text style={styles.chatText}>{s.backToChat}</Text>}
          </Tap>
        )}
      </View>
      {!docked && (
        <RailSheet open={menu} onClose={() => setMenu(false)} closeLabel={s.close}>
          <ToolRail tab={tab} onTab={pick} s={s} waiting={waiting} />
        </RailSheet>
      )}
    </View>
  );
}

// A small count on the Actions row in the rail and on the dashboard: red when one of them is urgent.
export function CountBadge({ n, urgent, s }: { n: number; urgent: boolean; s: Strings }) {
  return (
    <View style={[styles.count, urgent && styles.countUrgent]} accessibilityLabel={s.actionsBadge.replace("{n}", String(n))}>
      <Text style={[styles.countText, urgent && styles.countTextUrgent]}>{n > 9 ? "9+" : n}</Text>
    </View>
  );
}

const styles = themed(() => ({
  wrap: { flex: 1, flexDirection: "row" },
  main: { flex: 1, minWidth: 0 },
  count: { minWidth: 20, height: 20, borderRadius: 10, paddingHorizontal: 5, alignItems: "center", justifyContent: "center", backgroundColor: colors.primary },
  countUrgent: { backgroundColor: colors.danger },
  countText: { color: colors.onPrimary, fontSize: 12, fontWeight: "700" },
  countTextUrgent: { color: colors.onDanger },
  body: { flex: 1 },
  // The floating top bar: the greeting on the dashboard, the tool's name inside a tool.
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
  hello: { fontWeight: "500" },
  helloNarrow: { fontSize: 18, lineHeight: 22 },
  name: { color: colors.onBar, fontWeight: "800" },
  // The floating Chat button.
  chat: {
    position: "absolute",
    right: 20,
    zIndex: 20,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    height: 52,
    borderRadius: radius.pill,
    paddingHorizontal: 20,
    backgroundColor: colors.primary,
    ...softShadow(),
  },
  chatNarrow: { width: 56, height: 56, paddingHorizontal: 0, justifyContent: "center" },
  chatText: { color: colors.onPrimary, fontWeight: "700", fontSize: 15 },
}));

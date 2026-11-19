// The Health tools dashboard (convex/dashboard.ts): what's next and this week at a glance, today's check-in, questions
// to ask at an appointment in the coming week, four weeks of charts for what the user tracks, tomorrow's flare
// forecast, the strongest pattern, and every tool as a tile. It fills the window: more columns on wider screens.
// DashboardView draws it from data passed in, so the public demo (src/DemoPage.tsx) shows the same screen.
import { MedBand, MedLegend, MedPins, TrendDot } from "./ChartMarks";
import { ReactNode, useState } from "react";
import { ActivityIndicator, ScrollView, Text, useWindowDimensions, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useAction, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { api } from "../convex/_generated/api";
import { Tap } from "./Tap";
import { Icon, IconName, METRIC_ICON } from "./Icon";
import { colors, kicker, radius, scaleColor, themed, tint, ui } from "./theme";
import { errorText } from "./feedback";
import type { Strings } from "./i18n";
import { DailyCard, localDate } from "./DailyCard";
import { TodayDoses } from "./TodayDoses";
import { CountBadge, GROUPS, TOOLS, type HubTab } from "./HubPanel";
import { Enter, SwapIcon } from "./Motion";
import type { Id } from "../convex/_generated/dataModel";
import { axisDay, formatDate } from "./format";
import { TapBars } from "./TapBars";
import { useNow } from "./useNow";
import { EmergencyFull } from "./EmergencyCard";

// Questions show on the dashboard in the week before an appointment.
const QUESTIONS_DAYS = 7;

export type DashboardData = NonNullable<FunctionReturnType<typeof api.dashboard.view>>;
export type InsightsData = NonNullable<FunctionReturnType<typeof api.insights.view>>;
type Chart = DashboardData["charts"][number];

// The query re-runs every 5 minutes (not on every render), so a dose that comes due or a passed appointment updates.
function useDashboard() {
  const now = useNow(5 * 60_000);
  return useQuery(api.dashboard.view, { today: localDate(new Date(now)), now });
}

const fmt = (n: number) => (Math.round(n * 10) / 10).toLocaleString();
const withUnit = (n: number, unit: string) => (!unit ? fmt(n) : unit.startsWith("/") ? `${fmt(n)}${unit}` : `${fmt(n)} ${unit}`);

function when(at: number, locale: string) {
  const d = new Date(at);
  const time = d.toLocaleTimeString(locale, { hour: "numeric", minute: "2-digit" });
  return d.toDateString() === new Date().toDateString() ? time : `${d.toLocaleDateString(locale, { weekday: "short", month: "short", day: "numeric" })}, ${time}`;
}

// Up or down against last week, for the arrow: the real direction, whether that's good or bad.
const moved = (c: Chart) => (c.week === null || c.prevWeek === null ? 0 : Math.sign(c.week - c.prevWeek));

// Better, worse or steady against last week, for measures where one direction is bad.
function trend(c: Chart): "better" | "worse" | "same" | null {
  if (c.week === null || c.prevWeek === null || c.worse === "none") return null;
  const diff = c.week - c.prevWeek;
  if (Math.abs(diff) < Math.max(0.3, c.max * 0.05)) return "same";
  return (diff > 0) === (c.worse === "high") ? "worse" : "better";
}

export function HomePanel({ s, onOpen, onChat }: { s: Strings; onOpen: (t: HubTab) => void; onChat: () => void }) {
  const data = useDashboard();
  const insights = useQuery(api.insights.view, { today: localDate() });
  const waiting = useQuery(api.agent.waiting);
  const plan = useQuery(api.emergency.get);
  const [planOpen, setPlanOpen] = useState(false);
  const now = useNow();
  if (data === undefined) return <ActivityIndicator style={styles.loading} color={colors.primary} />;
  if (data === null) return null;
  return (
    <DashboardView
      data={data}
      insights={insights ?? null}
      now={now}
      s={s}
      onOpen={onOpen}
      onChat={onChat}
      checkin={<DailyCard s={s} inChat flush />}
      doses={<TodayDoses s={s} compact />}
      waiting={waiting}
      emergency={
        plan?.exists ? (
          <>
            <Tap style={styles.emergency} onPress={() => setPlanOpen(true)} accessibilityRole="button">
              <Ionicons name="alert-circle" size={20} color={colors.danger} />
              <Text style={styles.emergencyText}>{s.homeEmergencyPlan}</Text>
              <Ionicons name="expand-outline" size={18} color={colors.danger} />
            </Tap>
            <EmergencyFull open={planOpen} onClose={() => setPlanOpen(false)} s={s} />
          </>
        ) : null
      }
    />
  );
}

// The dashboard itself. `checkin`: today's check-in card. `demo`: sample data, so nothing asks the server.
export function DashboardView(p: {
  data: DashboardData;
  insights: InsightsData | null;
  now: number;
  s: Strings;
  onOpen: (t: HubTab) => void;
  onChat: () => void;
  checkin: ReactNode;
  // Today's doses to answer (./TodayDoses.tsx); the example dashboard has none.
  doses?: ReactNode;
  // Actions waiting for the user's OK (convex/agent.ts waiting).
  waiting?: { count: number; urgent: boolean };
  // A button that opens the emergency plan full screen, when there is one.
  emergency?: ReactNode;
  demo?: boolean;
  header?: ReactNode;
}) {
  const { data, insights, now, s, onOpen, onChat } = p;
  const { width } = useWindowDimensions();
  const wide = width >= 640;
  const wider = width >= 1100;
  const m = data.meds;
  const [allPatterns, setAllPatterns] = useState(false);

  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
      {p.header}
      <View style={styles.stats}>
        <Stat
          icon="medications"
          tint="medications"
          label={s.homeNextDose}
          value={m.next ? when(m.next.at, s.locale) : s.homeNoDose}
          sub={
            m.overdue === 1 ? s.homeOverdueOne
            : m.overdue ? s.homeOverdueMany.replace("{n}", String(m.overdue))
            : m.next?.name
          }
          warn={m.overdue > 0}
          onPress={() => onOpen("reminders")}
          wide={wide}
        />
        <Stat
          icon="appointments"
          tint="appointments"
          label={s.homeNextVisit}
          value={data.visit ? when(data.visit.startsAt, s.locale) : s.homeNoVisit}
          sub={data.visit?.title}
          onPress={() => onOpen("visits")}
          wide={wide}
        />
        <Stat
          icon="journal"
          tint="journal"
          label={s.homeLogged}
          value={s.homeLoggedOf.replace("{n}", String(data.logged))}
          sub={s.homeDosesNone}
          meter={data.logged / 7}
          onPress={() => onOpen("journal")}
          wide={wide}
        />
        <Stat
          icon="doses"
          tint="exercise"
          label={s.homeDoses}
          value={m.answered ? s.homeDosesOf.replace("{a}", String(m.taken)).replace("{b}", String(m.answered)) : "–"}
          sub={m.lowSupply ? s.homeLowSupply.replace("{n}", String(m.lowSupply)) : s.homeDosesNone}
          warn={m.lowSupply > 0}
          meter={m.answered ? m.taken / m.answered : undefined}
          onPress={() => onOpen("reminders")}
          wide={wide}
        />
      </View>

      {!!p.waiting?.count && (
        <Enter>
          <Tap style={[styles.waiting, p.waiting.urgent && styles.waitingUrgent]} onPress={() => onOpen("agent")} accessibilityRole="button">
            <Icon name="agent" size={20} color={p.waiting.urgent ? colors.danger : colors.primary} />
            <View style={styles.flex}>
              <Text style={styles.waitingTitle}>{(p.waiting.count === 1 ? s.homeActionsOne : s.homeActionsMany).replace("{n}", String(p.waiting.count))}</Text>
              {p.waiting.urgent && <Text style={styles.waitingUrgentText}>{s.homeActionsUrgent}</Text>}
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.muted} />
          </Tap>
        </Enter>
      )}

      {p.emergency}
      {p.doses}

      {p.checkin}

      {data.visit && data.visit.startsAt - now < QUESTIONS_DAYS * 86_400_000 && <VisitQuestions visit={data.visit} s={s} onOpen={onOpen} demo={p.demo} />}

      <View style={styles.sectionRow}>
        <Text style={styles.section} accessibilityRole="header">
          {s.homeTrends}
        </Text>
        <Tap style={styles.seeAll} onPress={() => onOpen("journal")} accessibilityRole="link">
          <Text style={styles.seeAllText}>{s.homeSeeAll}</Text>
          <Ionicons name="chevron-forward" size={16} color={colors.primary} />
        </Tap>
      </View>
      {data.charts.length ? (
        <View style={styles.grid}>
          {data.charts.map((c) => (
            <TrendCard key={c.metric} chart={c} s={s} wide={wide} wider={wider} onPress={() => onOpen("journal")} />
          ))}
        </View>
      ) : (
        <Text style={styles.empty}>{s.homeChartsEmpty}</Text>
      )}

      {!!insights && (!!insights.patterns.length || !!insights.weather || !!insights.tomorrow.length) && (
        <View style={styles.insight}>
          {!!insights.tomorrow.length && (
            <View style={styles.insightRow}>
              <View style={[styles.iconDot, { backgroundColor: colors.surface }]}>
                <Icon name="forecast" size={18} color={colors.warningText} />
              </View>
              <View style={styles.flex}>
                <Text style={styles.insightLabel}>{s.homeTomorrow}</Text>
                {insights.tomorrow.map((line) => (
                  <Text key={line} style={styles.insightText}>
                    {line}
                  </Text>
                ))}
              </View>
            </View>
          )}
          {!!insights.patterns.length && (
            <View style={styles.insightRow}>
              <View style={[styles.iconDot, { backgroundColor: colors.surface }]}>
                <Icon name="insights" size={18} color={colors.primary} />
              </View>
              <View style={styles.flex}>
                <Text style={styles.insightLabel}>{s.homePattern}</Text>
                {(allPatterns ? insights.patterns : insights.patterns.slice(0, 1)).map((line) => (
                  <Text key={line} style={styles.insightText}>
                    {line}
                  </Text>
                ))}
                {insights.patterns.length > 1 && (
                  <Tap style={styles.morePatterns} onPress={() => setAllPatterns(!allPatterns)} accessibilityRole="button" accessibilityState={{ expanded: allPatterns }}>
                    <Text style={styles.askText}>{allPatterns ? s.journalShowFewer : s.homeAllPatterns.replace("{n}", String(insights.patterns.length))}</Text>
                  </Tap>
                )}
                {allPatterns && <Text style={styles.small}>{s.journalNotCause}</Text>}
              </View>
            </View>
          )}
          {!!insights.weather && (
            <View style={styles.insightRow}>
              <View style={[styles.iconDot, { backgroundColor: colors.surface }]}>
                <Icon name="weather" size={18} color={colors.primary} />
              </View>
              <View style={styles.flex}>
                <Text style={styles.insightLabel}>{insights.weatherPlace ? s.weatherIn.replace("{place}", insights.weatherPlace) : s.insightsWeather}</Text>
                <Text style={styles.insightText}>{insights.weather}</Text>
              </View>
            </View>
          )}
          <Tap style={styles.ask} onPress={onChat} accessibilityRole="button">
            <Ionicons name="chatbubble-ellipses-outline" size={16} color={colors.primary} />
            <Text style={styles.askText}>{s.homeTalk}</Text>
          </Tap>
        </View>
      )}

      <Text style={styles.section} accessibilityRole="header">
        {s.homeTools}
      </Text>
      {GROUPS.map((g) => (
        <View key={g.key} style={styles.group}>
          <Text style={styles.groupTitle} accessibilityRole="header">
            {g.label(s)}
          </Text>
          <View style={styles.grid}>
            {g.tools.map((tab) => TOOLS.find((t) => t.tab === tab)!).map((t) => (
              <Tap key={t.tab} style={[styles.tool, wide ? styles.third : styles.half]} onPress={() => onOpen(t.tab)} accessibilityRole="button" accessibilityLabel={`${t.label(s)}. ${t.desc(s)}`}>
                <View style={[styles.toolIcon, { backgroundColor: tint[t.tint].bg }]}>
                  <Icon name={t.icon} size={24} color={tint[t.tint].fg} />
                </View>
                <View style={styles.toolHead}>
                  <Text style={[styles.toolTitle, styles.flex]} numberOfLines={1}>
                    {t.label(s)}
                  </Text>
                  {t.tab === "agent" && !!p.waiting?.count && <CountBadge n={p.waiting.count} urgent={p.waiting.urgent} s={s} />}
                </View>
                <Text style={styles.toolDesc} numberOfLines={2}>
                  {t.desc(s)}
                </Text>
              </Tap>
            ))}
          </View>
        </View>
      ))}
    </ScrollView>
  );
}

type Visit = NonNullable<DashboardData["visit"]>;

// The next appointment's questions to ask (convex/questions.ts), or a button to write some, and the prep checklist.
function VisitQuestions({ visit, s, onOpen, demo }: { visit: Visit; s: Strings; onOpen: (t: HubTab) => void; demo?: boolean }) {
  const suggest = useAction(api.questions.suggest);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const write = async () => {
    setBusy(true);
    setError(null);
    try {
      await suggest({ id: visit._id as Id<"visits"> });
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  const c = tint.appointments;
  return (
    <Enter style={styles.questions}>
      <View style={styles.trendHead}>
        <View style={[styles.iconDot, { backgroundColor: c.bg }]}>
          <Icon name="appointments" size={18} color={c.fg} />
        </View>
        <View style={styles.flex}>
          <Text style={styles.trendTitle} numberOfLines={1}>
            {s.homeQuestionsTitle.replace("{title}", visit.title)}
          </Text>
          <Text style={styles.small}>{when(visit.startsAt, s.locale)}</Text>
        </View>
      </View>
      {visit.questions.length ? (
        visit.questions.slice(0, 3).map((q) => (
          <Text key={q} style={styles.insightText}>
            • {q}
          </Text>
        ))
      ) : (
        <Text style={styles.small}>{s.homeQuestionsEmpty}</Text>
      )}
      <View style={styles.actions}>
        {!visit.questions.length && !demo && (
          <Tap style={styles.ask} onPress={() => void write()} disabled={busy} accessibilityRole="button" accessibilityState={{ busy }}>
            <SwapIcon id={busy ? "busy" : "idle"}>
              {busy ? <ActivityIndicator size="small" color={colors.primary} /> : <Ionicons name="sparkles-outline" size={16} color={colors.primary} />}
            </SwapIcon>
            <Text style={styles.askText}>{s.visitSuggestQuestions}</Text>
          </Tap>
        )}
        <Tap style={styles.ask} onPress={() => onOpen("prep")} accessibilityRole="button">
          <Icon name="guides" size={16} color={colors.primary} />
          <Text style={styles.askText}>{s.homeChecklist}</Text>
        </Tap>
      </View>
      {error && <Text style={styles.error}>{error}</Text>}
    </Enter>
  );
}

function Stat(p: {
  icon: IconName;
  tint: keyof typeof tint;
  label: string;
  value: string;
  sub?: string;
  meter?: number;
  warn?: boolean;
  wide: boolean;
  onPress: () => void;
}) {
  const c = tint[p.tint];
  return (
    <Tap style={[styles.stat, p.wide ? styles.quarter : styles.half]} onPress={p.onPress} accessibilityRole="button" accessibilityLabel={`${p.label}: ${p.value}${p.sub ? `, ${p.sub}` : ""}`}>
      <View style={[styles.iconDot, { backgroundColor: c.bg }]}>
        <Icon name={p.icon} size={18} color={c.fg} />
      </View>
      <Text style={styles.statLabel} numberOfLines={1}>
        {p.label}
      </Text>
      <Text style={styles.statValue} numberOfLines={1}>
        {p.value}
      </Text>
      {p.meter !== undefined && (
        <View style={styles.meter}>
          <View style={[styles.meterFill, { width: `${Math.round(Math.min(1, p.meter) * 100)}%`, backgroundColor: c.fg }]} />
        </View>
      )}
      {!!p.sub && (
        <Text style={[styles.statSub, p.warn && styles.warn]} numberOfLines={1}>
          {p.warn ? "⚠ " : ""}
          {p.sub}
        </Text>
      )}
    </Tap>
  );
}

// Read when drawing, so it follows the theme.
const bad = () => ({ better: colors.primary, worse: colors.danger, same: colors.muted });

// Also shown read only to Care Circle members (src/CirclePanel.tsx), without onPress.
export function TrendCard({ chart, s, wide, wider, onPress }: { chart: Chart; s: Strings; wide: boolean; wider: boolean; onPress?: () => void }) {
  const t = trend(chart);
  const byDate = new Map(chart.points.map((p) => [p.date, p.value]));
  const dates: string[] = [];
  for (let d = Date.parse(`${chart.from}T00:00:00Z`); d <= Date.parse(`${chart.to}T00:00:00Z`); d += 86_400_000) dates.push(new Date(d).toISOString().slice(0, 10));
  const values = chart.points.map((p) => p.value);
  const trendBy = new Map((chart.trend ?? []).map((p) => [p.date, p.value]));
  const marked = new Set(chart.meds.map((m) => m.date));
  const top = Math.max(chart.max, ...values, ...trendBy.values()) || 1;
  // Measures without a fixed scale (peak flow, steps, heart rate) start just under their lowest day, so changes show.
  const low = Math.min(...values, ...trendBy.values());
  const floor = chart.unit.startsWith("/") ? 0 : Math.max(0, low - (top - low) * 0.5 - top * 0.02);

  // Each bar's colour says how good that day was: red to teal, by which direction is bad. 1-5 ratings start at 1.
  // Measures with no bad direction (steps) stay in the greens.
  const base = chart.unit === "/5" ? 1 : floor;
  const barColor = (v: number) => {
    const f = Math.min(1, Math.max(0, (v - base) / (top - base || 1)));
    return scaleColor(chart.worse === "high" ? 1 - f : chart.worse === "low" ? f : 0.75 + 0.25 * f);
  };
  const label = t && { better: s.homeBetter, worse: s.homeWorse, same: s.homeSame }[t];
  // Tap a day's bar to read its value; the line takes the axis's place.
  const [picked, setPicked] = useState<string | null>(null);
  const pickedValue = picked ? byDate.get(picked) : undefined;
  return (
    <View style={[styles.trend, wider ? styles.third : wide ? styles.half2 : styles.full]}>
      {/* The head opens the tool. The bars are a button of their own, so they sit beside it, not inside it. */}
      <Tap style={styles.trendTop} onPress={onPress} disabled={!onPress} accessibilityRole={onPress ? "button" : "summary"}
        accessibilityLabel={`${chart.title}: ${s.homeLatest} ${withUnit(chart.latest.value, chart.unit)}${label ? `, ${label}` : ""}`}>
        <View style={styles.trendHead}>
          <View style={[styles.iconDot, { backgroundColor: colors.primarySoft }]}>
            <Icon name={METRIC_ICON[chart.metric] ?? "insights"} size={18} color={colors.primary} />
          </View>
          <Text style={styles.trendTitle} numberOfLines={1}>
            {chart.title}
          </Text>
          {t && (
            <View style={[styles.pill, { borderColor: bad()[t] }]}>
              <Ionicons
                name={
                  t === "same" || !moved(chart) ? "remove"
                  : moved(chart) > 0 ? "trending-up"
                  : "trending-down"
                }
                size={14}
                color={bad()[t]}
              />
              <Text style={[styles.pillText, { color: bad()[t] }]}>{label}</Text>
            </View>
          )}
        </View>
        <View style={styles.valueRow}>
          <Text style={styles.big}>{withUnit(chart.latest.value, chart.unit)}</Text>
          {chart.prevWeek !== null && chart.week !== null && (
            <Text style={styles.small} numberOfLines={1}>
              {s.homeThisWeek} {withUnit(chart.week, chart.unit)} · {s.homeLastWeek.replace("{v}", withUnit(chart.prevWeek, chart.unit))}
            </Text>
          )}
        </View>
      </Tap>
      {chart.meds.length > 0 && <MedPins dates={dates} meds={chart.meds} gap={2} />}
      <TapBars count={dates.length} onPick={(i) => setPicked(dates[i] === picked ? null : dates[i])} style={styles.bars} label={`${chart.title}. ${s.chartTapHint}`}>
        {dates.map((d) => {
          const v = byDate.get(d);
          const t = trendBy.get(d);
          return (
            <View key={d} style={[styles.slot, d === picked && styles.slotOn]}>
              {marked.has(d) && <MedBand />}
              {v !== undefined && (
                <View style={[styles.bar, { height: `${Math.max(6, ((v - floor) / (top - floor || 1)) * 100)}%`, backgroundColor: barColor(v) }]} />
              )}
              {t !== undefined && <TrendDot share={(t - floor) / (top - floor || 1)} color={colors.text} />}
            </View>
          );
        })}
      </TapBars>
      {picked ? (
        <Enter from={4}>
          <Text style={styles.picked}>
            {formatDate(picked, s, { weekday: "short", month: "short", day: "numeric" })}: {pickedValue !== undefined ? withUnit(pickedValue, chart.unit) : s.chartNothing}
          </Text>
        </Enter>
      ) : (
        <View style={styles.axis}>
          <Text style={styles.axisText}>{axisDay(chart.from, s)}</Text>
          <Text style={styles.axisText}>{axisDay(chart.to, s)}</Text>
        </View>
      )}
      {trendBy.size > 0 && <Text style={styles.axisText}>● {s.chartTrend}</Text>}
      <MedLegend meds={chart.meds} s={s} />
    </View>
  );
}

const styles = themed(() => ({
  loading: { flex: 1 },
  section: { ...ui.section },
  empty: { ...ui.empty },
  scroll: { flex: 1 },
  content: { padding: 16, gap: 14, width: "100%", paddingBottom: 40 },
  flex: { flex: 1 },
  stats: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  group: { gap: 8 },
  emergency: { ...ui.card, flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 14, minHeight: 52, borderColor: colors.dangerBorder },
  emergencyText: { flex: 1, color: colors.danger, fontSize: 15, fontWeight: "700" },
  morePatterns: { minHeight: 36, justifyContent: "center", alignSelf: "flex-start" },
  slotOn: { backgroundColor: colors.primarySoft },
  picked: { color: colors.text, fontSize: 13, fontWeight: "600" },
  toolHead: { flexDirection: "row", alignItems: "center", gap: 6 },
  waiting: { ...ui.card, flexDirection: "row", alignItems: "center", gap: 10, padding: 14, borderColor: colors.primary },
  waitingUrgent: { borderColor: colors.danger, backgroundColor: colors.dangerSoft },
  waitingTitle: { color: colors.text, fontSize: 15, fontWeight: "700" },
  waitingUrgentText: { color: colors.danger, fontSize: 13, fontWeight: "600", marginTop: 2 },
  groupTitle: { color: colors.muted, fontWeight: "700", ...kicker() },
  // Two per row on phones; four (stats) or three (tools) on wider screens. The gap is taken out of each share.
  half: { flexBasis: "47%", flexGrow: 1 },
  quarter: { flexBasis: "22%", flexGrow: 1 },
  third: { flexBasis: "30%", flexGrow: 1 },
  half2: { flexBasis: "47%", flexGrow: 1 },
  full: { flexBasis: "100%" },
  stat: { ...ui.card, padding: 12, gap: 4, minHeight: 124 },
  iconDot: { width: 34, height: 34, borderRadius: 26, alignItems: "center", justifyContent: "center" },
  statLabel: { color: colors.muted, fontSize: 13, fontWeight: "600", marginTop: 4 },
  statValue: { color: colors.text, fontSize: 17, fontWeight: "700" },
  statSub: { color: colors.muted, fontSize: 13 },
  warn: { color: colors.warningText, fontWeight: "600" },
  meter: { height: 6, borderRadius: 3, backgroundColor: colors.bg, overflow: "hidden", marginVertical: 2 },
  meterFill: { height: "100%", borderRadius: 3 },
  sectionRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  seeAll: { flexDirection: "row", alignItems: "center", gap: 2, minHeight: 44, paddingHorizontal: 4, marginTop: 8 },
  seeAllText: { color: colors.primary, fontWeight: "600", fontSize: 14 },
  trend: { ...ui.card, padding: 12, gap: 8 },
  trendTop: { gap: 8 },
  trendHead: { flexDirection: "row", alignItems: "center", gap: 8 },
  trendTitle: { flex: 1, fontSize: 15, fontWeight: "700", color: colors.text },
  pill: { flexDirection: "row", alignItems: "center", gap: 3, borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: 8, paddingVertical: 2 },
  pillText: { fontSize: 12, fontWeight: "700" },
  valueRow: { gap: 2 },
  big: { fontSize: 26, fontWeight: "800", color: colors.text },
  small: { fontSize: 13, color: colors.muted },
  bars: { flexDirection: "row", alignItems: "flex-end", height: 64, gap: 2 },
  slot: { flex: 1, height: "100%", justifyContent: "flex-end" },
  bar: { width: "100%", borderTopLeftRadius: 3, borderTopRightRadius: 3 },

  axis: { flexDirection: "row", justifyContent: "space-between" },
  axisText: { fontSize: 12, color: colors.muted },
  insight: { ...ui.card, padding: 14, gap: 10, backgroundColor: colors.primarySoft, borderColor: colors.mint },
  questions: { ...ui.card, padding: 14, gap: 8 },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 2 },
  error: { color: colors.danger, fontSize: 14 },
  insightRow: { flexDirection: "row", gap: 10, alignItems: "flex-start" },
  insightLabel: { fontSize: 13, fontWeight: "700", color: colors.primary },
  insightText: { fontSize: 15, color: colors.text, lineHeight: 21 },
  ask: { flexDirection: "row", alignItems: "center", gap: 6, alignSelf: "flex-start", minHeight: 40, paddingHorizontal: 14, borderRadius: radius.pill, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.primary },
  askText: { color: colors.primary, fontWeight: "600", fontSize: 14 },
  tool: { ...ui.card, padding: 14, gap: 6, minHeight: 132 },
  toolIcon: { width: 46, height: 46, borderRadius: radius.md, alignItems: "center", justifyContent: "center", marginBottom: 4 },
  toolTitle: { fontSize: 16, fontWeight: "700", color: colors.text },
  toolDesc: { fontSize: 13, color: colors.muted, lineHeight: 18 },
}));

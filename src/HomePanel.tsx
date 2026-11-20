// The Health tools dashboard (convex/dashboard.ts): a grid of today's tiles (doses by time of day, the check-in,
// movement, the next appointment with its top 3 questions, and what's worth watching: tomorrow's flare forecast, the
// strongest pattern, and the weather), four weeks of charts for what the user tracks, and the emergency plan last.
// More columns on wider screens.
// The example dashboard (src/DemoPage.tsx) shows this same screen on sample data.
import { MedBand, MedLegend, MedPins, TrendDot } from "./ChartMarks";
import { ReactNode, useState } from "react";
import { ActivityIndicator, ScrollView, Text, useWindowDimensions, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useAction, useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { api } from "../convex/_generated/api";
import { Tap } from "./Tap";
import { Icon, IconName, METRIC_ICON } from "./Icon";
import { colors, kicker, radius, scaleColor, themed, tint, TOUCH, ui } from "./theme";
import { errorText } from "./feedback";
import type { Strings } from "./i18n";
import { DailyCard, localDate } from "./DailyCard";
import { DoseBlocks } from "./DoseBlocks";
import { type HubTab } from "./HubPanel";
import { TOP_QUESTIONS } from "./QuestionList";
import { Enter, SwapIcon } from "./Motion";
import type { Id } from "../convex/_generated/dataModel";
import { axisDay, formatDate } from "./format";
import { TapBars } from "./TapBars";
import { bpColor, tempColor } from "./vitalColors";
import { tempToC } from "../convex/lib/units";
import { useNow } from "./useNow";
import { EmergencyFull } from "./EmergencyCard";
import { useOpenSetup } from "./setup";

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
  const plan = useQuery(api.emergency.get);
  const [planOpen, setPlanOpen] = useState(false);
  if (data === undefined) return <ActivityIndicator style={styles.loading} color={colors.primary} />;
  if (data === null) return null;
  return (
    <DashboardView
      data={data}
      insights={insights ?? null}
      s={s}
      onOpen={onOpen}
      onChat={onChat}
      profile={data.finishProfile ? <FinishProfile missing={data.finishProfile} s={s} /> : null}
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

// Columns for the dashboard's width (the panel's, not the window's: the rail and the chat drawer take some).
const columnsFor = (w: number) => (w >= 1000 ? 3 : w >= 620 ? 2 : 1);
const GAP = 12;

// The dashboard: a calm "today" grid (doses by time of day, the check-in, movement, the next appointment, and what's
// worth watching), then four weeks of trends, then the emergency plan. Every tool is in the rail (./ToolRail.tsx) and
// what's waiting is under the bell (./NotificationsButton.tsx).
export function DashboardView(p: {
  data: DashboardData;
  insights: InsightsData | null;
  s: Strings;
  onOpen: (t: HubTab) => void;
  onChat: () => void;
  // A button that opens the emergency plan full screen, when there is one.
  emergency?: ReactNode;
  // "Finish your profile", while parts of setup are still to do.
  profile?: ReactNode;
}) {
  const { data, insights, s, onOpen, onChat } = p;
  const [w, setW] = useState(useWindowDimensions().width - 32);
  const cols = columnsFor(w);
  const wide = cols >= 2;
  const wider = cols >= 3;
  const m = data.meds;
  const [allPatterns, setAllPatterns] = useState(false);
  const watching = !!insights && (!!insights.patterns.length || !!insights.weather || !!insights.tomorrow.length);
  // Each tile's width in columns, laid out so every row is full and no card runs the whole width of a wide screen.
  const span = (n: number) => {
    const k = Math.min(n, cols);
    return { width: Math.floor(((w - GAP * (cols - 1)) / cols) * k + GAP * (k - 1)) };
  };
  // The second row: movement, the appointment, and what's worth watching side by side; without the last, the first
  // two share the row (on three columns) or the appointment takes the row (on two).
  const half = cols === 3 ? 1.5 : cols === 2 ? 2 : 1;

  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
      {p.profile}

      <View style={styles.bento} onLayout={(e) => setW(e.nativeEvent.layout.width)}>
        <Tile
          style={span(2)}
          icon="medications"
          tint="medications"
          title={s.todayDoses}
          sub={
            m.overdue === 1 ? s.homeOverdueOne
            : m.overdue ? s.homeOverdueMany.replace("{n}", String(m.overdue))
            : m.next ? `${s.homeNextDose}: ${when(m.next.at, s.locale)} · ${m.next.name}`
            : m.count ? s.homeMedsDone
            : s.homeNoDose
          }
          warn={m.overdue > 0}
          open={s.tabMeds}
          onOpen={() => onOpen("reminders")}
        >
          <DoseBlocks s={s} stacked={cols === 1} />
          {m.lowSupply > 0 && (
            <Text style={[styles.statSub, styles.warn]}>
              <Ionicons name="warning-outline" size={13} color={colors.warningText} /> {s.homeLowSupply.replace("{n}", String(m.lowSupply))}
            </Text>
          )}
        </Tile>

        <Tile
          style={span(1)}
          icon="journal"
          tint="journal"
          title={s.dailyTitle}
          sub={`${s.homeLogged}: ${s.homeLoggedOf.replace("{n}", String(data.logged))}`}
          open={s.tabJournal}
          onOpen={() => onOpen("journal")}
        >
          <DailyCard s={s} bare />
        </Tile>

        <Tile style={span(watching ? 1 : cols === 2 ? 1 : half)} icon="exercise" tint="exercise" title={s.homeMove} open={s.tabExercise} onOpen={() => onOpen("exercise")}>
          <MoveStreak move={data.move} s={s} />
        </Tile>

        <Tile
          style={span(watching ? 1 : cols === 2 ? 1 : half)}
          icon="appointments"
          tint="appointments"
          title={data.visit ? data.visit.title : s.homeNextVisit}
          sub={data.visit ? when(data.visit.startsAt, s.locale) : s.homeNoVisit}
          open={s.tabVisits}
          onOpen={() => onOpen("visits")}
        >
          {data.visit && <VisitQuestions visit={data.visit} s={s} onOpen={onOpen} />}
        </Tile>

        {watching && (
          <Tile style={span(cols === 2 ? 2 : 1)} icon="insights" tint="journal" title={s.homeWatching} open={s.journalTabTrends} onOpen={() => onOpen("journal")}>
            {!!insights.tomorrow.length && (
              <View style={styles.insightRow}>
                <Icon name="forecast" size={18} color={colors.warningText} />
                <View style={styles.flex}>
                  <Text style={styles.insightLabel}>{s.homeTomorrow}</Text>
                  {(allPatterns ? insights.tomorrow : insights.tomorrow.slice(0, 1)).map((line) => (
                    <Text key={line} style={styles.insightText}>
                      {line}
                    </Text>
                  ))}
                </View>
              </View>
            )}
            {!!insights.patterns.length && (
              <View style={styles.insightRow}>
                <Icon name="insights" size={18} color={colors.primary} />
                <View style={styles.flex}>
                  <Text style={styles.insightLabel}>{s.homePattern}</Text>
                  {(allPatterns ? insights.patterns : insights.patterns.slice(0, 1)).map((line) => (
                    <Text key={line} style={styles.insightText}>
                      {line}
                    </Text>
                  ))}
                  {(insights.patterns.length > 1 || insights.tomorrow.length > 1) && (
                    <Tap style={styles.morePatterns} onPress={() => setAllPatterns(!allPatterns)} accessibilityRole="button" accessibilityState={{ expanded: allPatterns }}>
                      <Text style={styles.askText}>{allPatterns ? s.journalShowFewer : insights.patterns.length > 1 ? s.homeAllPatterns.replace("{n}", String(insights.patterns.length)) : s.homeSeeAll}</Text>
                    </Tap>
                  )}
                  {allPatterns && <Text style={styles.small}>{s.journalNotCause}</Text>}
                </View>
              </View>
            )}
            {!!insights.weather && (
              <View style={styles.insightRow}>
                <Icon name="weather" size={18} color={colors.primary} />
                <View style={styles.flex}>
                  <Text style={styles.insightLabel}>{insights.weatherPlace ? s.weatherIn.replace("{place}", insights.weatherPlace) : s.insightsWeather}</Text>
                  <Text style={styles.insightText}>{insights.weather}</Text>
                </View>
              </View>
            )}
            <Tap style={styles.ask} onPress={onChat} accessibilityRole="button">
              <Icon name="chat" size={16} color={colors.primary} />
              <Text style={styles.askText}>{s.homeTalk}</Text>
            </Tap>
          </Tile>
        )}
      </View>

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

      {p.emergency}
    </ScrollView>
  );
}

// One tile of the dashboard grid: the tool's icon and a title, a line under it, an arrow that opens the tool, and
// what to do today.
function Tile(p: {
  style: { width: number };
  icon: IconName;
  tint: keyof typeof tint;
  title: string;
  sub?: string;
  warn?: boolean;
  // The tool's name, for the arrow's label.
  open: string;
  onOpen: () => void;
  children?: ReactNode;
}) {
  const c = tint[p.tint];
  return (
    <Enter style={[styles.tile, p.style]} from={10}>
      <Tap style={styles.tileHead} onPress={p.onOpen} accessibilityRole="button" accessibilityLabel={`${p.open}: ${p.title}${p.sub ? `, ${p.sub}` : ""}`}>
        <View style={[styles.tileIcon, { backgroundColor: c.bg }]}>
          <Icon name={p.icon} size={20} color={c.fg} />
        </View>
        <View style={styles.flex}>
          <Text style={styles.tileTitle} numberOfLines={2}>
            {p.title}
          </Text>
          {!!p.sub && (
            <Text style={[styles.statSub, p.warn && styles.warn]} numberOfLines={2}>
              {p.sub}
            </Text>
          )}
        </View>
        <Ionicons name="chevron-forward" size={18} color={colors.muted} />
      </Tap>
      {p.children}
    </Enter>
  );
}

// Four weeks of days as a grid of dots, one row a week: filled on days an exercise was done (convex/dashboard.ts move).
function MoveStreak({ move, s }: { move: DashboardData["move"]; s: Strings }) {
  if (!move.exercises && !move.days.length) return <Text style={styles.small}>{s.homeMoveNone}</Text>;
  const done = new Set(move.days);
  const start = Date.parse(`${move.from}T00:00:00Z`);
  const days = Array.from({ length: 28 }, (_, i) => new Date(start + i * 86_400_000).toISOString().slice(0, 10));
  const c = tint.exercise;
  return (
    <View style={styles.move}>
      <View style={styles.dots} accessibilityLabel={s.homeMoveDays.replace("{n}", String(move.days.length))}>
        {[0, 1, 2, 3].map((week) => (
          <View key={week} style={styles.dotRow}>
            {days.slice(week * 7, week * 7 + 7).map((d, i) => (
              <View key={d} style={[styles.dot, { backgroundColor: done.has(d) ? c.fg : c.bg }, week === 3 && i === 6 && styles.dotToday]} />
            ))}
          </View>
        ))}
      </View>
      <Text style={styles.small}>{s.homeMoveDays.replace("{n}", String(move.days.length))}</Text>
      {move.dueToday > 0 && (
        <Text style={[styles.small, styles.strong]}>{s.homeMoveToday.replace("{a}", String(move.doneToday)).replace("{b}", String(move.dueToday))}</Text>
      )}
    </View>
  );
}

type Visit = NonNullable<DashboardData["visit"]>;

// The next appointment's top 3 questions (convex/questions.ts, in the user's order), or a button to write some, and
// Prepare (the prep checklist) and Share (a summary for the doctor).
function VisitQuestions({ visit, s, onOpen }: { visit: Visit; s: Strings; onOpen: (t: HubTab) => void }) {
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
  return (
    <View style={styles.visit}>
      {visit.questions.length ? (
        <>
          <Text style={styles.kickerText}>{s.questionsTop}</Text>
          {visit.questions.slice(0, TOP_QUESTIONS).map((q, i) => (
            <View key={`${i}-${q}`} style={styles.qRow}>
              <View style={styles.qNum}>
                <Text style={styles.qNumText}>{i + 1}</Text>
              </View>
              <Text style={[styles.insightText, styles.flex]}>{q}</Text>
            </View>
          ))}
        </>
      ) : (
        <Text style={styles.small}>{s.homeQuestionsEmpty}</Text>
      )}
      <View style={styles.actions}>
        {!visit.questions.length && (
          <Tap style={styles.ask} onPress={() => void write()} disabled={busy} accessibilityRole="button" accessibilityState={{ busy }}>
            <SwapIcon id={busy ? "busy" : "idle"}>
              {busy ? <ActivityIndicator size="small" color={colors.primary} /> : <Icon name="suggest" size={16} color={colors.primary} />}
            </SwapIcon>
            <Text style={styles.askText}>{s.visitSuggestQuestions}</Text>
          </Tap>
        )}
        <Tap style={styles.ask} onPress={() => onOpen("prep")} accessibilityRole="button">
          <Icon name="guides" size={16} color={colors.primary} />
          <Text style={styles.askText}>{s.homePrepare}</Text>
        </Tap>
        <Tap style={styles.ask} onPress={() => onOpen("visit")} accessibilityRole="button">
          <Icon name="share" size={16} color={colors.primary} />
          <Text style={styles.askText}>{s.tabVisit}</Text>
        </Tap>
      </View>
      {error && <Text style={styles.error}>{error}</Text>}
    </View>
  );
}

// Read when drawing, so it follows the theme.
const bad = () => ({ better: colors.primary, worse: colors.danger, same: colors.muted });

// The parts of setup the first run left out, as one card: open them, or put them off for good ("Not now").
function FinishProfile({ missing, s }: { missing: ("about" | "conditions" | "city")[]; s: Strings }) {
  const open = useOpenSetup();
  const notNow = useMutation(api.onboarding.finishProfile);
  const parts = { about: s.homeProfileAbout, conditions: s.homeProfileConditions, city: s.homeProfileCity };
  return (
    <Enter style={styles.profile}>
      <View style={styles.trendHead}>
        <View style={[styles.iconDot, { backgroundColor: colors.primarySoft }]}>
          <Ionicons name="person-circle-outline" size={20} color={colors.primary} />
        </View>
        <Text style={styles.trendTitle}>{s.homeFinishProfile}</Text>
      </View>
      <Text style={styles.small}>{s.homeFinishProfileBody.replace("{list}", missing.map((m) => parts[m]).join(", "))}</Text>
      <View style={styles.profileButtons}>
        <Tap style={ui.button} onPress={() => open("rest")} accessibilityRole="button">
          <Text style={styles.profileButtonText}>{s.homeFinishNow}</Text>
        </Tap>
        <Tap style={styles.profileLater} onPress={() => void notNow({})} accessibilityRole="button">
          <Text style={styles.seeAllText}>{s.homeNotNow}</Text>
        </Tap>
      </View>
    </Enter>
  );
}

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
    // Vitals have fixed thresholds (src/vitalColors.ts); the rest are colored by their place in the range.
    if (chart.metric === "bp") return bpColor(v);
    if (chart.metric === "bodyTemp") return tempColor(chart.unit === "°F" ? tempToC(v, "F") : v);
    const f = Math.min(1, Math.max(0, (v - base) / (top - base || 1)));
    return scaleColor(chart.worse === "high" ? 1 - f : chart.worse === "low" ? f : 0.75 + 0.25 * f);
  };
  const label = t && { better: s.homeBetter, worse: s.homeWorse, same: s.homeSame }[t];
  // Tap a day's bar to read its value; the line takes the axis's place.
  const [picked, setPicked] = useState<string | null>(null);
  const pickedValue = picked ? byDate.get(picked) : undefined;
  const a11y = `${chart.title}: ${s.homeLatest} ${withUnit(chart.latest.value, chart.unit)}${label ? `, ${label}` : ""}`;
  const head = (
    <>
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
    </>
  );
  return (
    <View style={[styles.trend, wider ? styles.third : wide ? styles.half2 : styles.full]}>
      {/* The head opens the tool. The bars are a button of their own, so they sit beside it, not inside it. */}
      {onPress ? (
        <Tap style={styles.trendTop} onPress={onPress} accessibilityRole="button" accessibilityLabel={a11y}>
          {head}
        </Tap>
      ) : (
        // Read only for Care Circle members: a plain block, not a dimmed button.
        <View style={styles.trendTop} accessibilityLabel={a11y}>
          {head}
        </View>
      )}
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
  // Room at the bottom for the floating Chat button (src/HubPanel.tsx).
  content: { padding: 16, gap: 14, width: "100%", paddingBottom: 96 },
  flex: { flex: 1 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  emergency: { ...ui.card, flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 14, minHeight: 52, borderColor: colors.dangerBorder },
  emergencyText: { flex: 1, color: colors.danger, fontSize: 15, fontWeight: "700" },
  morePatterns: { minHeight: 36, justifyContent: "center", alignSelf: "flex-start" },
  slotOn: { backgroundColor: colors.primarySoft },
  picked: { color: colors.text, fontSize: 13, fontWeight: "600" },
  // Trend cards: one per row on phones, two or three on wider screens. The gap is taken out of each share.
  third: { flexBasis: "30%", flexGrow: 1 },
  half2: { flexBasis: "47%", flexGrow: 1 },
  full: { flexBasis: "100%" },
  iconDot: { width: 34, height: 34, borderRadius: 26, alignItems: "center", justifyContent: "center" },
  statSub: { color: colors.muted, fontSize: 13 },
  warn: { color: colors.warningText, fontWeight: "600" },
  sectionRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  seeAll: { flexDirection: "row", alignItems: "center", gap: 2, minHeight: 44, paddingHorizontal: 4, marginTop: 8 },
  seeAllText: { color: colors.primary, fontWeight: "600", fontSize: 14 },
  trend: { ...ui.card, padding: 12, gap: 8 },
  profile: { ...ui.card, padding: 14, gap: 10 },
  profileButtons: { flexDirection: "row", alignItems: "center", gap: 12, flexWrap: "wrap" },
  profileButtonText: { color: colors.onPrimary, fontWeight: "600", fontSize: 14 },
  profileLater: { minHeight: TOUCH, justifyContent: "center", paddingHorizontal: 8 },
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
  actions: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 2 },
  error: { color: colors.danger, fontSize: 14 },
  insightLabel: { fontSize: 13, fontWeight: "700", color: colors.primary },
  insightText: { fontSize: 15, color: colors.text, lineHeight: 21 },
  ask: { flexDirection: "row", alignItems: "center", gap: 6, alignSelf: "flex-start", minHeight: 40, paddingHorizontal: 14, borderRadius: radius.pill, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.primary },
  askText: { color: colors.primary, fontWeight: "600", fontSize: 14 },
  bento: { flexDirection: "row", flexWrap: "wrap", gap: GAP, alignItems: "stretch" },
  // flexGrow takes up what rounding leaves at the end of a row.
  tile: { ...ui.card, padding: 16, gap: 14, flexGrow: 1 },
  insightRow: { flexDirection: "row", gap: 10, alignItems: "flex-start" },
  tileHead: { flexDirection: "row", alignItems: "center", gap: 12, minHeight: 44 },
  tileIcon: { width: 40, height: 40, borderRadius: radius.sm, alignItems: "center", justifyContent: "center" },
  tileTitle: { fontSize: 16, fontWeight: "700", color: colors.text },
  strong: { color: colors.text, fontWeight: "600" },
  move: { gap: 8 },
  dots: { gap: 6, alignSelf: "flex-start" },
  dotRow: { flexDirection: "row", gap: 6 },
  dot: { width: 18, height: 18, borderRadius: 6 },
  dotToday: { borderWidth: 2, borderColor: colors.text },
  visit: { gap: 8 },
  kickerText: { color: colors.muted, fontWeight: "700", ...kicker() },
  qRow: { flexDirection: "row", alignItems: "flex-start", gap: 8 },
  qNum: { width: 22, height: 22, borderRadius: 11, marginTop: 0, alignItems: "center", justifyContent: "center", backgroundColor: colors.primary },
  qNumText: { color: colors.onPrimary, fontSize: 12, fontWeight: "700" },
}));

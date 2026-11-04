// The Health tools dashboard (convex/dashboard.ts): what's next and this week at a glance, today's check-in, questions
// to ask at an appointment in the coming week, four weeks of charts for what the user tracks, tomorrow's flare
// forecast, the strongest pattern, and every tool as a tile. It fills the window: more columns on wider screens.
import { useState } from "react";
import { ActivityIndicator, ScrollView, Text, useWindowDimensions, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useAction, useQuery } from "convex/react";
import { api } from "../convex/_generated/api";
import { Tap } from "./Tap";
import { Icon, IconName, METRIC_ICON } from "./Icon";
import { colors, radius, scaleColor, tint, ui, themed } from "./theme";
import type { Strings } from "./i18n";
import { DailyCard, localDate } from "./DailyCard";
import { TOOLS, type HubTab } from "./HubPanel";
import { Enter, SwapIcon } from "./Motion";
import type { Id } from "../convex/_generated/dataModel";

// Questions show on the dashboard in the week before an appointment.
const QUESTIONS_DAYS = 7;

type Chart = NonNullable<ReturnType<typeof useDashboard>>["charts"][number];

function useDashboard() {
  // Fixed while the screen is open, so the query isn't re-run on every render.
  const [now] = useState(() => Date.now());
  return useQuery(api.dashboard.view, { today: localDate(), now });
}

const fmt = (n: number) => (Math.round(n * 10) / 10).toLocaleString();
const withUnit = (n: number, unit: string) => (!unit ? fmt(n) : unit.startsWith("/") ? `${fmt(n)}${unit}` : `${fmt(n)} ${unit}`);

function when(at: number, locale: string) {
  const d = new Date(at);
  const time = d.toLocaleTimeString(locale, { hour: "numeric", minute: "2-digit" });
  return d.toDateString() === new Date().toDateString() ? time : `${d.toLocaleDateString(locale, { weekday: "short", month: "short", day: "numeric" })}, ${time}`;
}

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
  const { width } = useWindowDimensions();
  const wide = width >= 640;
  const wider = width >= 1100;
  const [now] = useState(() => Date.now());
  if (data === undefined) return <ActivityIndicator style={styles.loading} color={colors.primary} />;
  if (data === null) return null;
  const m = data.meds;

  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
      <View style={styles.stats}>
        <Stat
          icon="medications"
          tint="medications"
          label={s.homeNextDose}
          value={m.next ? when(m.next.at, s.locale) : s.homeNoDose}
          sub={m.next?.name}
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

      <DailyCard s={s} inChat flush />

      {data.visit && data.visit.startsAt - now < QUESTIONS_DAYS * 86_400_000 && <VisitQuestions visit={data.visit} s={s} onOpen={onOpen} />}

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
                <Text style={styles.insightText}>{insights.patterns[0]}</Text>
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
      <View style={styles.grid}>
        {TOOLS.map((t) => (
          <Tap key={t.tab} style={[styles.tool, wide ? styles.third : styles.half]} onPress={() => onOpen(t.tab)} accessibilityRole="button" accessibilityLabel={`${t.label(s)}. ${t.desc(s)}`}>
            <View style={[styles.toolIcon, { backgroundColor: tint[t.tint].bg }]}>
              <Icon name={t.icon} size={24} color={tint[t.tint].fg} />
            </View>
            <Text style={styles.toolTitle} numberOfLines={1}>
              {t.label(s)}
            </Text>
            <Text style={styles.toolDesc} numberOfLines={2}>
              {t.desc(s)}
            </Text>
          </Tap>
        ))}
      </View>
    </ScrollView>
  );
}

type Visit = NonNullable<NonNullable<ReturnType<typeof useDashboard>>["visit"]>;

// The next appointment's questions to ask (convex/questions.ts), or a button to write some, and the prep checklist.
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
      setError((e as Error).message.replace(/^.*Uncaught Error: /, "").split("\n")[0]);
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
        {!visit.questions.length && (
          <Tap style={styles.ask} onPress={() => void write()} disabled={busy} accessibilityRole="button" accessibilityState={{ busy }}>
            <SwapIcon id={busy ? "busy" : "idle"}>
              {busy ? <ActivityIndicator size="small" color={colors.primary} /> : <Ionicons name="sparkles-outline" size={16} color={colors.primary} />}
            </SwapIcon>
            <Text style={styles.askText}>{s.visitSuggestQuestions}</Text>
          </Tap>
        )}
        <Tap style={styles.ask} onPress={() => onOpen("guides")} accessibilityRole="button">
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

function TrendCard({ chart, s, wide, wider, onPress }: { chart: Chart; s: Strings; wide: boolean; wider: boolean; onPress: () => void }) {
  const t = trend(chart);
  const byDate = new Map(chart.points.map((p) => [p.date, p.value]));
  const dates: string[] = [];
  for (let d = Date.parse(`${chart.from}T00:00:00Z`); d <= Date.parse(`${chart.to}T00:00:00Z`); d += 86_400_000) dates.push(new Date(d).toISOString().slice(0, 10));
  const values = chart.points.map((p) => p.value);
  const top = Math.max(chart.max, ...values) || 1;
  // Measures without a fixed scale (peak flow, steps, heart rate) start just under their lowest day, so changes show.
  const floor = chart.unit.startsWith("/") ? 0 : Math.max(0, Math.min(...values) - (top - Math.min(...values)) * 0.5 - top * 0.02);

  // Each bar's colour says how good that day was: red to teal, by which direction is bad. 1-5 ratings start at 1.
  // Measures with no bad direction (steps) stay in the greens.
  const base = chart.unit === "/5" ? 1 : floor;
  const barColor = (v: number) => {
    const f = Math.min(1, Math.max(0, (v - base) / (top - base || 1)));
    return scaleColor(chart.worse === "high" ? 1 - f : chart.worse === "low" ? f : 0.75 + 0.25 * f);
  };
  const label = t && { better: s.homeBetter, worse: s.homeWorse, same: s.homeSame }[t];
  return (
    <Tap style={[styles.trend, wider ? styles.third : wide ? styles.half2 : styles.full]} onPress={onPress} accessibilityRole="button"
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
            <Ionicons name={t === "same" ? "remove" : t === "better" ? "trending-up" : "trending-down"} size={14} color={bad()[t]} />
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
      <View style={styles.bars}>
        {dates.map((d) => {
          const v = byDate.get(d);
          return (
            <View key={d} style={styles.slot}>
              {v !== undefined && (
                <View style={[styles.bar, { height: `${Math.max(6, ((v - floor) / (top - floor || 1)) * 100)}%`, backgroundColor: barColor(v) }]} />
              )}
            </View>
          );
        })}
      </View>
      <View style={styles.axis}>
        <Text style={styles.axisText}>{chart.from.slice(5)}</Text>
        <Text style={styles.axisText}>{chart.to.slice(5)}</Text>
      </View>
    </Tap>
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
  // Two per row on phones; four (stats) or three (tools) on wider screens. The gap is taken out of each share.
  half: { flexBasis: "47%", flexGrow: 1 },
  quarter: { flexBasis: "22%", flexGrow: 1 },
  third: { flexBasis: "30%", flexGrow: 1 },
  half2: { flexBasis: "47%", flexGrow: 1 },
  full: { flexBasis: "100%" },
  stat: { ...ui.card, padding: 12, gap: 4, minHeight: 124 },
  iconDot: { width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center" },
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

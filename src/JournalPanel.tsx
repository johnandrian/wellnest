// Symptom journal (convex/journal.ts) in three tabs: Log (today's check-in and the form to log a symptom with recent
// entries, ./SymptomLog.tsx), Trends (the check-in chart and a severity chart per symptom with sleep and period days
// underneath, and patterns), and Trackers (./TrackersSection.tsx). Trends and Trackers share the period picker at the
// top. Tap a chart to read one day's value. Most entries come from chat ("my headache's a 6 today").
import { useMemo, useState } from "react";
import { ScrollView, Text, View } from "react-native";
import { Tap } from "./Tap";
import { useQuery } from "convex/react";
import { api } from "../convex/_generated/api";
import { colors, radius, severityColor, themed, ui } from "./theme";
import type { Strings } from "./i18n";
import { DailyCard, DailyChart } from "./DailyCard";
import { TrackersSection } from "./TrackersSection";
import { InsightsCard, useHasInsights } from "./InsightsCard";
import { levelOf, SymptomLog } from "./SymptomLog";
import { axisDay, formatDate } from "./format";
import { TapBars } from "./TapBars";
import { Enter } from "./Motion";

const PERIODS = [14, 30, 90];
const FIRST_CHARTS = 5;
type Tab = "log" | "trends" | "trackers";

// Local calendar dates, oldest first.
function lastDays(n: number) {
  const out: string[] = [];
  const d = new Date();
  d.setDate(d.getDate() - (n - 1));
  for (let i = 0; i < n; i++) {
    out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`);
    d.setDate(d.getDate() + 1);
  }
  return out;
}

function Chart({ days, points, sleep, periodDays, s }: {
  days: string[];
  points: { date: string; severity: number }[];
  sleep: Map<string, number>;
  periodDays: Set<string>;
  s: Strings;
}) {
  const bySeverity = new Map(points.map((p) => [p.date, p.severity]));
  const [picked, setPicked] = useState<string | null>(null);
  const sev = picked ? bySeverity.get(picked) : undefined;
  const hours = picked ? sleep.get(picked) : undefined;
  return (
    <View>
      <TapBars count={days.length} onPick={(i) => setPicked(days[i] === picked ? null : days[i])} style={styles.bars} label={`${s.journalChartLabel}. ${s.chartTapHint}`}>
        {days.map((d) => {
          const v = bySeverity.get(d);
          return (
            <View key={d} style={[styles.barSlot, d === picked && styles.slotOn]}>
              {v !== undefined && <View style={[styles.bar, { height: `${Math.max(6, v * 10)}%`, backgroundColor: severityColor(v) }]} />}
            </View>
          );
        })}
      </TapBars>
      {sleep.size > 0 && (
        <View style={styles.sleepRow}>
          {days.map((d) => {
            const h = sleep.get(d);
            return (
              <View key={d} style={styles.barSlot}>
                {h !== undefined && <View style={[styles.sleepBar, { height: `${Math.min(100, (h / 10) * 100)}%`, opacity: h < 6 ? 1 : 0.45 }]} />}
              </View>
            );
          })}
        </View>
      )}
      {periodDays.size > 0 && (
        <View style={styles.periodRow}>
          {days.map((d) => (
            <View key={d} style={styles.barSlot}>
              {periodDays.has(d) && <View style={styles.periodDot} />}
            </View>
          ))}
        </View>
      )}
      {picked ? (
        <Enter from={4}>
          <Text style={styles.picked}>
            {formatDate(picked, s, { weekday: "short", month: "short", day: "numeric" })}:{" "}
            {sev !== undefined ? `${s.logOutOf.replace("{n}", String(sev))}, ${s.logLevels[levelOf(sev)]}` : s.chartNothing}
            {hours !== undefined ? ` · ${s.legendSleep} ${Math.round(hours * 10) / 10} h` : ""}
            {periodDays.has(picked) ? ` · ${s.legendPeriod}` : ""}
          </Text>
        </Enter>
      ) : (
        <View style={styles.axis}>
          <Text style={styles.axisText}>{axisDay(days[0], s)}</Text>
          <Text style={styles.axisText}>{axisDay(days[days.length - 1], s)}</Text>
        </View>
      )}
    </View>
  );
}

export function JournalPanel({ s }: { s: Strings }) {
  const [tab, setTab] = useState<Tab>("log");
  const [period, setPeriod] = useState(30);
  const [allCharts, setAllCharts] = useState(false);
  const days = useMemo(() => lastDays(period), [period]);
  const today = days[days.length - 1];
  const data = useQuery(api.journal.view, { since: days[0], today });
  const hasInsights = useHasInsights(today);

  const sleep = new Map((data?.sleep ?? []).map((x) => [x.date, x.hours]));
  const periodDays = new Set(data?.periodDays ?? []);
  const symptoms = data?.symptoms ?? [];
  const charts = allCharts ? symptoms : symptoms.slice(0, FIRST_CHARTS);
  const tabs: { key: Tab; label: string }[] = [
    { key: "log", label: s.journalTabLog },
    { key: "trends", label: s.journalTabTrends },
    { key: "trackers", label: s.journalTabTrackers },
  ];

  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.panel}>
      <View style={styles.tabs} accessibilityRole="tablist">
        {tabs.map((t) => (
          <Tap key={t.key} style={[styles.tab, tab === t.key && styles.tabOn]} onPress={() => setTab(t.key)} accessibilityRole="tab" accessibilityState={{ selected: tab === t.key }}>
            <Text style={[styles.tabText, tab === t.key && styles.tabTextOn]}>{t.label}</Text>
          </Tap>
        ))}
      </View>
      {tab !== "log" && (
        <View style={styles.chips}>
          {PERIODS.map((p) => (
            <Tap key={p} style={[styles.chip, period === p && styles.chipOn]} onPress={() => setPeriod(p)} accessibilityRole="radio" accessibilityState={{ selected: period === p }}>
              <Text style={[styles.chipText, period === p && styles.chipTextOn]}>{s.lastNDays.replace("{n}", String(p))}</Text>
            </Tap>
          ))}
        </View>
      )}

      {tab === "log" && (
        <Enter key="log" from={6} style={styles.group}>
          <DailyCard s={s} />
          <SymptomLog s={s} mine={symptoms.map((x) => x.name)} recent={data?.recent ?? []} />
          <Text style={styles.note}>{s.journalIntro}</Text>
        </Enter>
      )}

      {tab === "trends" && (
        <Enter key="trends" from={6} style={styles.group}>
          <InsightsCard today={today} s={s} />
          {!!data?.daily.length && <DailyChart days={days} daily={data.daily} s={s} />}
          {data && symptoms.length === 0 && <Text style={styles.empty}>{s.journalEmpty}</Text>}
          {charts.map((sym) => (
            <View key={sym.name} style={styles.card}>
              <Text style={styles.cardTitle}>
                {sym.name.charAt(0).toUpperCase() + sym.name.slice(1)} <Text style={styles.small}>· {sym.count === 1 ? s.timesLoggedOne : s.timesLogged.replace("{n}", String(sym.count))}</Text>
              </Text>
              <Chart days={days} points={sym.points} sleep={sleep} periodDays={periodDays} s={s} />
            </View>
          ))}
          {symptoms.length > FIRST_CHARTS && (
            <Tap style={styles.more} onPress={() => setAllCharts(!allCharts)} accessibilityRole="button" accessibilityState={{ expanded: allCharts }}>
              <Text style={styles.link}>{allCharts ? s.journalShowFewer : s.journalShowAll.replace("{n}", String(symptoms.length))}</Text>
            </Tap>
          )}
          {symptoms.length > 0 && (
            <View style={styles.legend}>
              <View style={[styles.legendSwatch, { backgroundColor: severityColor(5) }]} />
              <Text style={styles.small}>{s.legendSeverity}</Text>
              {sleep.size > 0 && <View style={[styles.legendSwatch, { backgroundColor: colors.sleep }]} />}
              {sleep.size > 0 && <Text style={styles.small}>{s.legendSleep}</Text>}
              {periodDays.size > 0 && <View style={[styles.legendSwatch, styles.periodDot]} />}
              {periodDays.size > 0 && <Text style={styles.small}>{s.legendPeriod}</Text>}
              <Text style={styles.small}>· {s.chartTapHint}</Text>
            </View>
          )}

          {!hasInsights && !!data?.patterns.length && (
            <View style={styles.insights}>
              <Text style={styles.section}>{s.journalPatterns}</Text>
              {data.patterns.map((p) => (
                <Text key={p} style={styles.line}>• {p}</Text>
              ))}
              <Text style={styles.small}>{s.journalNotCause}</Text>
            </View>
          )}
          {!!data?.summaries.length && (
            <View>
              {data.summaries.map((p) => (
                <Text key={p} style={styles.line}>{p}</Text>
              ))}
            </View>
          )}
        </Enter>
      )}

      {tab === "trackers" && (
        <Enter key="trackers" from={6} style={styles.group}>
          <TrackersSection s={s} days={days} since={days[0]} />
        </Enter>
      )}
    </ScrollView>
  );
}

const styles = themed(() => ({
  scroll: { flex: 1, backgroundColor: colors.bg },
  panel: { padding: 16, gap: 10, maxWidth: 760, width: "100%", alignSelf: "center" },
  group: { gap: 10 },
  tabs: { flexDirection: "row", gap: 4, padding: 4, borderRadius: radius.pill, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.hairline },
  tab: { flex: 1, minHeight: 40, alignItems: "center", justifyContent: "center", borderRadius: radius.pill },
  tabOn: { backgroundColor: colors.primary },
  tabText: { color: colors.text, fontSize: 14, fontWeight: "600" },
  tabTextOn: { color: colors.onPrimary },
  note: { color: colors.muted, fontSize: 14, lineHeight: 19 },
  empty: { ...ui.empty },
  small: { color: colors.muted, fontSize: 12, fontWeight: "400" },
  section: { fontSize: 17, fontWeight: "700", color: colors.text, marginTop: 6 },
  line: { color: colors.text, fontSize: 14, lineHeight: 20 },
  link: { color: colors.primary, fontWeight: "600", fontSize: 14 },
  more: { ...ui.addButton },
  chips: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
  chip: { ...ui.chip },
  chipOn: { backgroundColor: colors.primarySoft, borderColor: colors.primary },
  chipText: { color: colors.text, fontSize: 14 },
  chipTextOn: { color: colors.primary, fontWeight: "600" },
  card: { ...ui.card, padding: 10, gap: 6 },
  cardTitle: { fontSize: 15, fontWeight: "600", color: colors.text },
  bars: { height: 70, flexDirection: "row", alignItems: "flex-end", gap: 1, backgroundColor: colors.bg, borderRadius: 4 },
  barSlot: { flex: 1, height: "100%", justifyContent: "flex-end" },
  slotOn: { backgroundColor: colors.primarySoft },
  bar: { borderTopLeftRadius: 2, borderTopRightRadius: 2 },
  sleepRow: { height: 22, flexDirection: "row", alignItems: "flex-end", gap: 1, marginTop: 3 },
  sleepBar: { backgroundColor: colors.sleep, borderTopLeftRadius: 2, borderTopRightRadius: 2 },
  periodRow: { height: 8, flexDirection: "row", gap: 1, marginTop: 3 },
  periodDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.period, alignSelf: "center" },
  axis: { flexDirection: "row", justifyContent: "space-between", marginTop: 2 },
  axisText: { color: colors.muted, fontSize: 12 },
  picked: { color: colors.text, fontSize: 13, fontWeight: "600", marginTop: 4 },
  legend: { flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" },
  legendSwatch: { width: 10, height: 10, borderRadius: 2 },
  insights: { backgroundColor: colors.primarySoft, borderRadius: 15, padding: 10, gap: 4 },
}));

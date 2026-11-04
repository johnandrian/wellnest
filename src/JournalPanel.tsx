// Symptom journal (convex/journal.ts): a severity chart per symptom with sleep and period days underneath, patterns,
// and, near the top, the form to log a symptom with recent entries (./SymptomLog.tsx). Most entries come from chat
// ("my headache's a 6 today").
import { useMemo, useState } from "react";
import { ScrollView, Text, View } from "react-native";
import { Tap } from "./Tap";
import { useQuery } from "convex/react";
import { api } from "../convex/_generated/api";
import { colors, severityColor, ui, themed } from "./theme";
import type { Strings } from "./i18n";
import { DailyCard, DailyChart } from "./DailyCard";
import { TrackersSection } from "./TrackersSection";
import { InsightsCard, useHasInsights } from "./InsightsCard";
import { SymptomLog } from "./SymptomLog";

const PERIODS = [14, 30, 90];

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
  return (
    <View>
      <View style={styles.bars} accessibilityLabel={s.journalChartLabel}>
        {days.map((d) => {
          const sev = bySeverity.get(d);
          return (
            <View key={d} style={styles.barSlot}>
              {sev !== undefined && <View style={[styles.bar, { height: `${Math.max(6, sev * 10)}%`, backgroundColor: severityColor(sev) }]} />}
            </View>
          );
        })}
      </View>
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
      <View style={styles.axis}>
        <Text style={styles.axisText}>{days[0].slice(5)}</Text>
        <Text style={styles.axisText}>{days[days.length - 1].slice(5)}</Text>
      </View>
    </View>
  );
}

export function JournalPanel({ s }: { s: Strings }) {
  const [period, setPeriod] = useState(30);
  const days = useMemo(() => lastDays(period), [period]);
  const today = days[days.length - 1];
  const data = useQuery(api.journal.view, { since: days[0], today });
  const hasInsights = useHasInsights(today);

  const sleep = new Map((data?.sleep ?? []).map((x) => [x.date, x.hours]));
  const periodDays = new Set(data?.periodDays ?? []);

  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.panel}>
      <DailyCard s={s} />
      <SymptomLog s={s} mine={(data?.symptoms ?? []).map((x) => x.name)} recent={data?.recent ?? []} />
      <InsightsCard today={today} s={s} />
      <Text style={styles.note}>{s.journalIntro}</Text>
      <View style={styles.chips}>
        {PERIODS.map((p) => (
          <Tap key={p} style={[styles.chip, period === p && styles.chipOn]} onPress={() => setPeriod(p)} accessibilityRole="radio" accessibilityState={{ selected: period === p }}>
            <Text style={[styles.chipText, period === p && styles.chipTextOn]}>{s.lastNDays.replace("{n}", String(p))}</Text>
          </Tap>
        ))}
      </View>

      {!!data?.daily.length && <DailyChart days={days} daily={data.daily} s={s} />}
      {data && data.symptoms.length === 0 && <Text style={styles.empty}>{s.journalEmpty}</Text>}
      {data?.symptoms.slice(0, 5).map((sym) => (
        <View key={sym.name} style={styles.card}>
          <Text style={styles.cardTitle}>
            {sym.name.charAt(0).toUpperCase() + sym.name.slice(1)} <Text style={styles.small}>· {s.timesLogged.replace("{n}", String(sym.count))}</Text>
          </Text>
          <Chart days={days} points={sym.points} sleep={sleep} periodDays={periodDays} s={s} />
        </View>
      ))}
      {data && data.symptoms.length > 0 && (sleep.size > 0 || periodDays.size > 0) && (
        <View style={styles.legend}>
          <View style={[styles.legendSwatch, { backgroundColor: severityColor(5) }]} />
          <Text style={styles.small}>{s.legendSeverity}</Text>
          {sleep.size > 0 && <View style={[styles.legendSwatch, { backgroundColor: colors.sleep }]} />}
          {sleep.size > 0 && <Text style={styles.small}>{s.legendSleep}</Text>}
          {periodDays.size > 0 && <View style={[styles.legendSwatch, styles.periodDot]} />}
          {periodDays.size > 0 && <Text style={styles.small}>{s.legendPeriod}</Text>}
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

      <TrackersSection s={s} days={days} since={days[0]} />

    </ScrollView>
  );
}

const styles = themed(() => ({
  scroll: { flex: 1, backgroundColor: colors.bg },
  panel: { padding: 16, gap: 10, maxWidth: 760, width: "100%", alignSelf: "center" },
  note: { color: colors.muted, fontSize: 14, lineHeight: 19 },
  empty: { ...ui.empty },
  small: { color: colors.muted, fontSize: 12, fontWeight: "400" },
  section: { fontSize: 17, fontWeight: "700", color: colors.text, marginTop: 6 },
  line: { color: colors.text, fontSize: 14, lineHeight: 20 },
  flex: { flex: 1 },
  chips: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
  chip: { ...ui.chip },
  chipOn: { backgroundColor: colors.primarySoft, borderColor: colors.primary },
  chipText: { color: colors.text, fontSize: 14 },
  chipTextOn: { color: colors.primary, fontWeight: "600" },
  card: { ...ui.card, padding: 10, gap: 6 },
  cardTitle: { fontSize: 15, fontWeight: "600", color: colors.text },
  bars: { height: 70, flexDirection: "row", alignItems: "flex-end", gap: 1, backgroundColor: colors.bg, borderRadius: 4 },
  barSlot: { flex: 1, height: "100%", justifyContent: "flex-end" },
  bar: { borderTopLeftRadius: 2, borderTopRightRadius: 2 },
  sleepRow: { height: 22, flexDirection: "row", alignItems: "flex-end", gap: 1, marginTop: 3 },
  sleepBar: { backgroundColor: colors.sleep, borderTopLeftRadius: 2, borderTopRightRadius: 2 },
  periodRow: { height: 8, flexDirection: "row", gap: 1, marginTop: 3 },
  periodDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.period, alignSelf: "center" },
  axis: { flexDirection: "row", justifyContent: "space-between", marginTop: 2 },
  axisText: { color: colors.muted, fontSize: 12 },
  legend: { flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" },
  legendSwatch: { width: 10, height: 10, borderRadius: 2 },
  insights: { backgroundColor: colors.primarySoft, borderRadius: 10, padding: 10, gap: 4 },
}));

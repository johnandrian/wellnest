// A chart the model drew with show_chart (convex/insights.ts), under its reply: one bar per day with data, colored
// by how good or bad the value is for that measure, with the average, high and low underneath. Medication starts and
// dose changes are marked in green above their day, and weight gets its 7-day average as a line of dots.
import { Text, View } from "react-native";
import { colors, round, themed } from "./theme";
import type { Strings } from "./i18n";
import { MedBand, MedLegend, MedPins, TrendDot, type MedMark } from "./ChartMarks";

export type ChartData = {
  title: string;
  unit: string;
  max: number;
  worse: "high" | "low" | "none";
  from: string;
  to: string;
  points: { date: string; value: number }[];
  trend?: { date: string; value: number }[];
  meds?: MedMark[];
};

// Every day from `from` to `to`, so days without data show as gaps.
function days(from: string, to: string) {
  const out: string[] = [];
  for (let t = Date.parse(`${from}T00:00:00Z`); t <= Date.parse(`${to}T00:00:00Z`) && out.length < 200; t += 86_400_000) {
    out.push(new Date(t).toISOString().slice(0, 10));
  }
  return out;
}

// Green to red by where the value sits on the scale; one color when neither direction is bad.
function barColor(value: number, max: number, worse: ChartData["worse"]) {
  if (worse === "none") return colors.primary;
  const share = max ? value / max : 0;
  const bad = worse === "high" ? share : 1 - share;
  return bad >= 0.7 ? colors.danger : bad >= 0.4 ? colors.amber : colors.mint;
}

const fmt = (n: number) => (Math.round(n * 10) / 10).toLocaleString();

export function ChartCard({ chart, s }: { chart: ChartData; s: Strings }) {
  const byDate = new Map(chart.points.map((p) => [p.date, p.value]));
  const trend = new Map((chart.trend ?? []).map((p) => [p.date, p.value]));
  const meds = chart.meds ?? [];
  const marked = new Set(meds.map((m) => m.date));
  const dates = days(chart.from, chart.to);
  const values = chart.points.map((p) => p.value);
  const avg = values.reduce((a, b) => a + b, 0) / values.length;
  const top = Math.max(chart.max, ...values, ...trend.values()) || 1;
  // A measure with no bad direction and no fixed scale (weight) starts just under its lowest day, so changes show.
  const low = Math.min(...values, ...trend.values());
  const floor = chart.worse === "none" && !chart.unit.startsWith("/") ? Math.max(0, low - (top - low) * 0.5 - top * 0.02) : 0;
  const share = (v: number) => (v - floor) / (top - floor || 1);
  const unit = chart.unit && !chart.unit.startsWith("/") ? ` ${chart.unit}` : chart.unit;
  const gap = dates.length > 60 ? 0 : 1;
  return (
    <View style={styles.card}>
      <Text style={styles.title}>
        {chart.title}
        {chart.unit ? <Text style={styles.unit}> ({chart.unit.replace(/^\//, "0-")})</Text> : null}
      </Text>
      {meds.length > 0 && <MedPins dates={dates} meds={meds} gap={gap} />}
      <View
        style={[styles.bars, { gap }]}
        accessible
        accessibilityLabel={`${chart.title}: ${s.chartAvg} ${fmt(avg)}${unit}, ${s.chartHigh} ${fmt(Math.max(...values))}, ${s.chartLow} ${fmt(Math.min(...values))}`}
      >
        {dates.map((d) => {
          const value = byDate.get(d);
          const t = trend.get(d);
          return (
            <View key={d} style={styles.slot}>
              {marked.has(d) && <MedBand />}
              {value !== undefined && (
                <View style={[styles.bar, { height: `${Math.max(4, share(value) * 100)}%`, backgroundColor: barColor(value, chart.max, chart.worse) }]} />
              )}
              {t !== undefined && <TrendDot share={share(t)} color={colors.text} />}
            </View>
          );
        })}
      </View>
      <View style={styles.axis}>
        <Text style={styles.small}>{chart.from.slice(5)}</Text>
        <Text style={styles.small}>{chart.to.slice(5)}</Text>
      </View>
      <Text style={styles.small}>
        {s.chartAvg} {fmt(avg)}
        {unit} · {s.chartHigh} {fmt(Math.max(...values))} · {s.chartLow} {fmt(Math.min(...values))}
      </Text>
      {trend.size > 0 && <Text style={styles.small}>● {s.chartTrend}</Text>}
      <MedLegend meds={meds} s={s} />
    </View>
  );
}

const styles = themed(() => ({
  card: { marginTop: 8, padding: 10, borderRadius: round(10), backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, gap: 4 },
  title: { fontSize: 14, fontWeight: "700", color: colors.text },
  unit: { fontWeight: "400", color: colors.muted },
  bars: { flexDirection: "row", alignItems: "flex-end", height: 90 },
  slot: { flex: 1, height: "100%", justifyContent: "flex-end" },
  bar: { width: "100%", borderTopLeftRadius: 2, borderTopRightRadius: 2 },
  axis: { flexDirection: "row", justifyContent: "space-between" },
  small: { fontSize: 12, color: colors.muted },
}));

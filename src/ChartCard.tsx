// A chart the model drew with show_chart (convex/insights.ts), under its reply: one bar per day with data, coloured
// by how good or bad the value is for that measure, with the average, high and low underneath.
import { StyleSheet, Text, View } from "react-native";
import { colors } from "./theme";
import type { Strings } from "./i18n";

export type ChartData = {
  title: string;
  unit: string;
  max: number;
  worse: "high" | "low" | "none";
  from: string;
  to: string;
  points: { date: string; value: number }[];
};

// Every day from `from` to `to`, so days without data show as gaps.
function days(from: string, to: string) {
  const out: string[] = [];
  for (let t = Date.parse(`${from}T00:00:00Z`); t <= Date.parse(`${to}T00:00:00Z`) && out.length < 200; t += 86_400_000) {
    out.push(new Date(t).toISOString().slice(0, 10));
  }
  return out;
}

// Green to red by where the value sits on the scale; one colour when neither direction is bad.
function barColor(value: number, max: number, worse: ChartData["worse"]) {
  if (worse === "none") return colors.primary;
  const share = max ? value / max : 0;
  const bad = worse === "high" ? share : 1 - share;
  return bad >= 0.7 ? colors.danger : bad >= 0.4 ? "#D97706" : colors.mint;
}

const fmt = (n: number) => (Math.round(n * 10) / 10).toLocaleString();

export function ChartCard({ chart, s }: { chart: ChartData; s: Strings }) {
  const byDate = new Map(chart.points.map((p) => [p.date, p.value]));
  const dates = days(chart.from, chart.to);
  const values = chart.points.map((p) => p.value);
  const avg = values.reduce((a, b) => a + b, 0) / values.length;
  const top = Math.max(chart.max, ...values) || 1;
  const unit = chart.unit && !chart.unit.startsWith("/") ? ` ${chart.unit}` : chart.unit;
  return (
    <View style={styles.card}>
      <Text style={styles.title}>
        {chart.title}
        {chart.unit ? <Text style={styles.unit}> ({chart.unit.replace(/^\//, "0-")})</Text> : null}
      </Text>
      <View
        style={[styles.bars, dates.length > 60 && { gap: 0 }]}
        accessible
        accessibilityLabel={`${chart.title}: ${s.chartAvg} ${fmt(avg)}${unit}, ${s.chartHigh} ${fmt(Math.max(...values))}, ${s.chartLow} ${fmt(Math.min(...values))}`}
      >
        {dates.map((d) => {
          const value = byDate.get(d);
          return (
            <View key={d} style={styles.slot}>
              {value !== undefined && (
                <View style={[styles.bar, { height: `${Math.max(4, (value / top) * 100)}%`, backgroundColor: barColor(value, chart.max, chart.worse) }]} />
              )}
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
    </View>
  );
}

const styles = StyleSheet.create({
  card: { marginTop: 8, padding: 10, borderRadius: 10, backgroundColor: "#fff", borderWidth: 1, borderColor: colors.border, gap: 4 },
  title: { fontSize: 14, fontWeight: "700", color: colors.text },
  unit: { fontWeight: "400", color: colors.muted },
  bars: { flexDirection: "row", alignItems: "flex-end", height: 90, gap: 1 },
  slot: { flex: 1, height: "100%", justifyContent: "flex-end" },
  bar: { width: "100%", borderTopLeftRadius: 2, borderTopRightRadius: 2 },
  axis: { flexDirection: "row", justifyContent: "space-between" },
  small: { fontSize: 12, color: colors.muted },
});

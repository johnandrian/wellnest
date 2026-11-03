// The Journal tab's insights (convex/insights.ts): what goes with the user's worse days (sleep, activity, cycle,
// weather, air quality, pollen), how things changed after medication changes, and today's local weather.
import { StyleSheet, Text, View } from "react-native";
import { useQuery } from "convex/react";
import { Ionicons } from "@expo/vector-icons";
import { api } from "../convex/_generated/api";
import { colors, ui } from "./theme";
import type { Strings } from "./i18n";

export function InsightsCard({ today, s }: { today: string; s: Strings }) {
  const data = useQuery(api.insights.view, { today });
  if (!data) return null;
  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <Ionicons name="analytics-outline" size={18} color={colors.primary} />
        <Text style={styles.title}>{s.insightsTitle}</Text>
      </View>
      {data.patterns.length ? (
        data.patterns.map((p) => (
          <Text key={p} style={styles.line}>
            • {p}
          </Text>
        ))
      ) : (
        <Text style={styles.muted}>{s.insightsEmpty}</Text>
      )}
      {!!data.medEffects.length && (
        <>
          <Text style={styles.subtitle}>{s.insightsMeds}</Text>
          {data.medEffects.map((m) => (
            <Text key={m} style={styles.line}>
              • {m}
            </Text>
          ))}
        </>
      )}
      {data.weather ? (
        <Text style={styles.weather}>
          <Ionicons name="partly-sunny-outline" size={13} color={colors.muted} /> {s.insightsWeather}: {data.weather}
        </Text>
      ) : (
        !data.hasLocation && <Text style={styles.muted}>{s.insightsNoLocation}</Text>
      )}
      {(!!data.patterns.length || !!data.medEffects.length) && <Text style={styles.small}>{s.insightsNote}</Text>}
    </View>
  );
}

// Whether there are patterns, so the Journal can hide its simpler list (the same query, shared).
export function useHasInsights(today: string) {
  const data = useQuery(api.insights.view, { today });
  return !!data?.patterns.length;
}

const styles = StyleSheet.create({
  card: { ...ui.card, padding: 12, gap: 6, backgroundColor: colors.primarySoft },
  header: { flexDirection: "row", alignItems: "center", gap: 6 },
  title: { fontSize: 15, fontWeight: "700", color: colors.text, flexShrink: 1 },
  subtitle: { fontSize: 14, fontWeight: "600", color: colors.text, marginTop: 4 },
  line: { fontSize: 14, color: colors.text, lineHeight: 20 },
  muted: { fontSize: 14, color: colors.muted, lineHeight: 19 },
  weather: { fontSize: 13, color: colors.muted, marginTop: 2 },
  small: { fontSize: 12, color: colors.muted, lineHeight: 16 },
});

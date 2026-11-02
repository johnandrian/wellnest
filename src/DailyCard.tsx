// "How's today?": mood, energy and sleep quality in one tap each (convex/daily.ts). In the chat it shows until today
// is answered or skipped; in the Journal tab it's always there to change today's answers.
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useMutation, useQuery } from "convex/react";
import { api } from "../convex/_generated/api";
import { colors } from "./theme";
import type { Strings } from "./i18n";

const FACES = ["😣", "🙁", "😐", "🙂", "😄"];
const KEYS = ["mood", "energy", "sleepQuality"] as const;

export function localDate(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function DailyCard({ s, inChat = false }: { s: Strings; inChat?: boolean }) {
  const date = localDate();
  const today = useQuery(api.daily.today, { date });
  const log = useMutation(api.daily.log);
  const skip = useMutation(api.daily.skip);
  if (!today) return null;
  const answered = KEYS.every((k) => today[k] !== null);
  if (inChat && (answered || today.skipped)) return null;
  const label = { mood: s.dailyMood, energy: s.dailyEnergy, sleepQuality: s.dailySleep };

  return (
    <View style={[styles.card, inChat && styles.inChat]}>
      <Text style={styles.title}>{s.dailyTitle}</Text>
      {KEYS.map((k) => (
        <View key={k} style={styles.row}>
          <Text style={styles.label}>{label[k]}</Text>
          <View style={styles.faces}>
            {FACES.map((face, i) => (
              <Pressable
                key={face}
                style={[styles.face, today[k] === i + 1 && styles.faceOn]}
                onPress={() => void log({ [k]: i + 1, date })}
                accessibilityRole="radio"
                accessibilityLabel={`${label[k]} ${i + 1}/5`}
                accessibilityState={{ selected: today[k] === i + 1 }}
              >
                <Text style={styles.faceText}>{face}</Text>
              </Pressable>
            ))}
          </View>
        </View>
      ))}
      {inChat && (
        <Pressable onPress={() => void skip()} accessibilityRole="button">
          <Text style={styles.link}>{s.dailyNotToday}</Text>
        </Pressable>
      )}
    </View>
  );
}

// Three small rows of 1-5 bars, one per question, over the chosen days.
export function DailyChart({ days, daily, s }: { days: string[]; daily: { date: string; mood: number | null; energy: number | null; sleepQuality: number | null }[]; s: Strings }) {
  const byDate = new Map(daily.map((d) => [d.date, d]));
  const label = { mood: s.dailyMood, energy: s.dailyEnergy, sleepQuality: s.dailySleep };
  return (
    <View style={styles.chart}>
      {KEYS.map((k) => (
        <View key={k} style={styles.chartRow}>
          <Text style={styles.chartLabel}>{label[k]}</Text>
          <View style={styles.bars}>
            {days.map((d) => {
              const v = byDate.get(d)?.[k];
              return (
                <View key={d} style={styles.slot}>
                  {v != null && <View style={[styles.bar, { height: `${v * 20}%`, backgroundColor: v <= 2 ? "#D97706" : colors.primary }]} />}
                </View>
              );
            })}
          </View>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderColor: colors.border, borderRadius: 12, padding: 12, gap: 6, backgroundColor: "#fff" },
  inChat: { margin: 12, marginBottom: 0, maxWidth: 736, width: "100%", alignSelf: "center" },
  title: { fontSize: 15, fontWeight: "700", color: colors.text },
  row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  label: { color: colors.text, fontSize: 14, flexShrink: 1 },
  faces: { flexDirection: "row", gap: 4 },
  face: { width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: "transparent" },
  faceOn: { backgroundColor: colors.primarySoft, borderColor: colors.primary },
  faceText: { fontSize: 20 },
  link: { color: colors.muted, fontSize: 13, alignSelf: "flex-end" },
  chart: { gap: 4, borderWidth: 1, borderColor: colors.border, borderRadius: 10, padding: 10 },
  chartRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  chartLabel: { width: 70, fontSize: 12, color: colors.muted },
  bars: { flex: 1, height: 28, flexDirection: "row", alignItems: "flex-end", gap: 1, backgroundColor: colors.bg, borderRadius: 3 },
  slot: { flex: 1, height: "100%", justifyContent: "flex-end" },
  bar: { borderTopLeftRadius: 1, borderTopRightRadius: 1 },
});

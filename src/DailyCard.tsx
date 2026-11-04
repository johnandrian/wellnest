// "How's today?": mood, energy and sleep quality in one tap each (convex/daily.ts). In the chat it shows until today
// is answered or skipped; in the Journal tab it's always there to change today's answers.
import { Text, View } from "react-native";
import { Tap } from "./Tap";
import { useMutation, useQuery } from "convex/react";
import { api } from "../convex/_generated/api";
import { colors, scaleColor, ui, themed } from "./theme";
import type { Strings } from "./i18n";

const FACES = ["😣", "🙁", "😐", "🙂", "😄"];
const KEYS = ["mood", "energy", "sleepQuality"] as const;

export function localDate(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// `flush`: on the dashboard, which has its own margins.
export function DailyCard({ s, inChat = false, flush = false }: { s: Strings; inChat?: boolean; flush?: boolean }) {
  const date = localDate();
  const today = useQuery(api.daily.today, { date });
  const log = useMutation(api.daily.log);
  const skip = useMutation(api.daily.skip);
  if (!today) return null;
  const answered = KEYS.every((k) => today[k] !== null);
  if (inChat && (answered || today.skipped)) return null;
  return (
    <DailyCardView
      s={s}
      values={today}
      onPick={(k, v) => void log({ [k]: v, date })}
      onSkip={inChat ? () => void skip() : undefined}
      inset={inChat && !flush}
    />
  );
}

export type DailyKey = (typeof KEYS)[number];

// The card itself, from values passed in (the public demo keeps its answers on the page).
export function DailyCardView({ s, values, onPick, onSkip, inset = false }: {
  s: Strings;
  values: Record<DailyKey, number | null>;
  onPick: (k: DailyKey, v: number) => void;
  onSkip?: () => void;
  inset?: boolean;
}) {
  const label = { mood: s.dailyMood, energy: s.dailyEnergy, sleepQuality: s.dailySleep };
  return (
    <View style={[styles.card, inset && styles.inChat]}>
      <Text style={styles.title}>{s.dailyTitle}</Text>
      {KEYS.map((k) => (
        <View key={k} style={styles.row}>
          <Text style={styles.label}>{label[k]}</Text>
          <View style={styles.faces}>
            {FACES.map((face, i) => (
              <Tap
                key={face}
                style={[styles.face, values[k] === i + 1 && styles.faceOn]}
                onPress={() => onPick(k, i + 1)}
                accessibilityRole="radio"
                accessibilityLabel={`${label[k]} ${i + 1}/5`}
                accessibilityState={{ selected: values[k] === i + 1 }}
              >
                <Text style={styles.faceText}>{face}</Text>
              </Tap>
            ))}
          </View>
        </View>
      ))}
      {onSkip && (
        <Tap onPress={onSkip} accessibilityRole="button">
          <Text style={styles.link}>{s.dailyNotToday}</Text>
        </Tap>
      )}
    </View>
  );
}

// Three small rows of 1-5 bars, one per question, over the chosen days, coloured from red (1) to teal (5).
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
                  {v != null && <View style={[styles.bar, { height: `${v * 20}%`, backgroundColor: scaleColor((v - 1) / 4) }]} />}
                </View>
              );
            })}
          </View>
        </View>
      ))}
    </View>
  );
}

const styles = themed(() => ({
  card: { ...ui.card, padding: 12, gap: 6 },
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
}));

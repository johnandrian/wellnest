// "How's today?": mood, energy and sleep quality in one tap each (convex/daily.ts), each row with its icon and the two
// ends of its scale named under the faces. In the chat it's one line above the messages until today is answered or
// skipped, opening into the card when tapped; in the Journal tab and on the dashboard it's always the full card.
import { useState } from "react";
import { Text, View } from "react-native";
import { Tap } from "./Tap";
import { Ionicons } from "@expo/vector-icons";
import { useMutation, useQuery } from "convex/react";
import { api } from "../convex/_generated/api";
import { colors, radius, scaleColor, themed, TOUCH, ui } from "./theme";
import type { Strings } from "./i18n";
import { TapBars } from "./TapBars";
import { formatDate } from "./format";
import { Reveal, SwapIcon } from "./Motion";

const FACES = ["😣", "🙁", "😐", "🙂", "😄"];
const KEYS = ["mood", "energy", "sleepQuality"] as const;
const ICONS = { mood: "happy-outline", energy: "flash-outline", sleepQuality: "moon-outline" } as const;

export function localDate(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// `flush`: on the dashboard, which has its own margins.
export function DailyCard({ s, inChat = false, flush = false }: { s: Strings; inChat?: boolean; flush?: boolean }) {
  const date = localDate();
  const today = useQuery(api.daily.today, { date });
  const log = useMutation(api.daily.log);
  const skip = useMutation(api.daily.skip);
  const [open, setOpen] = useState(false);
  if (!today) return null;
  const answered = KEYS.every((k) => today[k] !== null);
  if (inChat && (answered || today.skipped)) return null;
  // In the chat: one line, so the messages keep the room.
  if (inChat && !flush) {
    const done = KEYS.filter((k) => today[k] !== null).length;
    return (
      <View style={[styles.line, styles.inChat]}>
        <Tap style={styles.lineHead} onPress={() => setOpen(!open)} accessibilityRole="button" accessibilityState={{ expanded: open }}>
          <Ionicons name="sunny-outline" size={18} color={colors.primary} />
          <Text style={styles.lineTitle} numberOfLines={1}>
            {s.dailyTitle}
            {done ? <Text style={styles.lineSub}> · {done}/3</Text> : null}
          </Text>
          <SwapIcon id={open ? "up" : "down"}>
            <Ionicons name={open ? "chevron-up" : "chevron-down"} size={18} color={colors.muted} />
          </SwapIcon>
        </Tap>
        <Reveal open={open}>
          <DailyCardView s={s} values={today} onPick={(k, v) => void log({ [k]: v, date })} onSkip={() => void skip()} bare />
        </Reveal>
      </View>
    );
  }
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
// `bare`: inside the chat's one-line check-in, which has its own title and frame.
export function DailyCardView({ s, values, onPick, onSkip, inset = false, bare = false }: {
  s: Strings;
  values: Record<DailyKey, number | null>;
  onPick: (k: DailyKey, v: number) => void;
  onSkip?: () => void;
  inset?: boolean;
  bare?: boolean;
}) {
  const label = { mood: s.dailyMood, energy: s.dailyEnergy, sleepQuality: s.dailySleep };
  const ends = { mood: [s.dailyMoodLow, s.dailyMoodHigh], energy: [s.dailyEnergyLow, s.dailyEnergyHigh], sleepQuality: [s.dailySleepLow, s.dailySleepHigh] };
  return (
    <View style={bare ? styles.bare : [styles.card, inset && styles.inChat]}>
      {!bare && <Text style={styles.title}>{s.dailyTitle}</Text>}
      {KEYS.map((k) => (
        <View key={k} style={styles.row}>
          <View style={styles.labelRow}>
            <Ionicons name={ICONS[k]} size={18} color={colors.primary} />
            <Text style={styles.label}>{label[k]}</Text>
          </View>
          <View>
            <View style={styles.faces} accessibilityRole="radiogroup" accessibilityLabel={label[k]}>
              {FACES.map((face, i) => (
                <Tap
                  key={face}
                  style={[styles.face, values[k] === i + 1 && styles.faceOn]}
                  onPress={() => onPick(k, i + 1)}
                  accessibilityRole="radio"
                  accessibilityLabel={`${label[k]} ${i + 1}/5${i === 0 ? `, ${ends[k][0]}` : i === 4 ? `, ${ends[k][1]}` : ""}`}
                  accessibilityState={{ selected: values[k] === i + 1 }}
                >
                  <Text style={styles.faceText}>{face}</Text>
                </Tap>
              ))}
            </View>
            <View style={styles.ends}>
              <Text style={styles.end}>{ends[k][0]}</Text>
              <Text style={styles.end}>{ends[k][1]}</Text>
            </View>
          </View>
        </View>
      ))}
      {onSkip && (
        <Tap style={styles.skip} onPress={onSkip} accessibilityRole="button">
          <Text style={styles.link}>{s.dailyNotToday}</Text>
        </Tap>
      )}
    </View>
  );
}

// Three small rows of 1-5 bars, one per question, over the chosen days, coloured from red (1) to teal (5). Tap a day
// to read its three answers.
export function DailyChart({ days, daily, s }: { days: string[]; daily: { date: string; mood: number | null; energy: number | null; sleepQuality: number | null }[]; s: Strings }) {
  const byDate = new Map(daily.map((d) => [d.date, d]));
  const label = { mood: s.dailyMood, energy: s.dailyEnergy, sleepQuality: s.dailySleep };
  const [picked, setPicked] = useState<string | null>(null);
  const day = picked ? byDate.get(picked) : undefined;
  return (
    <View style={styles.chart}>
      {KEYS.map((k) => (
        <View key={k} style={styles.chartRow}>
          <Text style={styles.chartLabel}>{label[k]}</Text>
          <TapBars count={days.length} onPick={(i) => setPicked(days[i] === picked ? null : days[i])} style={styles.bars} label={`${label[k]}. ${s.chartTapHint}`}>
            {days.map((d) => {
              const v = byDate.get(d)?.[k];
              return (
                <View key={d} style={[styles.slot, d === picked && styles.slotOn]}>
                  {v != null && <View style={[styles.bar, { height: `${v * 20}%`, backgroundColor: scaleColor((v - 1) / 4) }]} />}
                </View>
              );
            })}
          </TapBars>
        </View>
      ))}
      {picked && (
        <Text style={styles.picked}>
          {formatDate(picked, s, { weekday: "short", month: "short", day: "numeric" })}:{" "}
          {day ? KEYS.filter((k) => day[k] != null).map((k) => `${label[k]} ${day[k]}/5`).join(" · ") || s.chartNothing : s.chartNothing}
        </Text>
      )}
    </View>
  );
}

const styles = themed(() => ({
  card: { ...ui.card, padding: 12, gap: 6 },
  inChat: { margin: 12, marginBottom: 0, maxWidth: 736, width: "100%", alignSelf: "center" },
  title: { fontSize: 15, fontWeight: "700", color: colors.text },
  line: { ...ui.card, paddingHorizontal: 12, paddingVertical: 2 },
  lineHead: { flexDirection: "row", alignItems: "center", gap: 8, minHeight: TOUCH },
  lineTitle: { flex: 1, color: colors.text, fontSize: 15, fontWeight: "600" },
  lineSub: { color: colors.muted, fontWeight: "400" },
  bare: { gap: 6, paddingBottom: 6 },
  row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  labelRow: { flexDirection: "row", alignItems: "center", gap: 6, flexShrink: 1 },
  label: { color: colors.text, fontSize: 14, flexShrink: 1 },
  faces: { flexDirection: "row", gap: 2 },
  ends: { flexDirection: "row", justifyContent: "space-between" },
  end: { color: colors.muted, fontSize: 11 },
  face: { width: 40, height: 40, borderRadius: radius.pill, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: "transparent" },
  faceOn: { backgroundColor: colors.primarySoft, borderColor: colors.primary },
  faceText: { fontSize: 20 },
  // "Not today": small words, but a full-size tap area.
  skip: { alignSelf: "flex-end", minHeight: TOUCH, justifyContent: "center", paddingHorizontal: 8 },
  link: { color: colors.muted, fontSize: 14 },
  chart: { gap: 4, borderWidth: 1, borderColor: colors.border, borderRadius: 15, padding: 10 },
  chartRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  chartLabel: { width: 70, fontSize: 12, color: colors.muted },
  bars: { flex: 1, height: 28, flexDirection: "row", alignItems: "flex-end", gap: 1, backgroundColor: colors.bg, borderRadius: 3 },
  slot: { flex: 1, height: "100%", justifyContent: "flex-end" },
  slotOn: { backgroundColor: colors.primarySoft },
  bar: { borderTopLeftRadius: 1, borderTopRightRadius: 1 },
  picked: { color: colors.text, fontSize: 13, fontWeight: "600" },
}));

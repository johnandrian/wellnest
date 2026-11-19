// "How's today?": mood, energy and sleep quality in one tap each (convex/daily.ts), each row with its icon and the two
// ends of its scale named under the faces, and an optional Food and drinks row (foods and caffeine drinks) for
// patterns. In the chat it's one line above the messages until today is answered or
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
// convex/lib/journal.ts FOOD_TAGS.
const FOODS = ["alcohol", "dairy", "gluten", "sugar", "spicy", "fried", "late_meal", "skipped_meal"] as const;
type Food = { foods: string[] | null; caffeine: number | null; onFoods: (foods: string[]) => void; onCaffeine: (n: number) => void };

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
      food={
        // The chat's check-in leaves it out; the dashboard's (also inChat, but flush) keeps it.
        inChat && !flush
          ? undefined
          : { foods: today.foods, caffeine: today.caffeine, onFoods: (foods) => void log({ foods, date }), onCaffeine: (caffeine) => void log({ caffeine, date }) }
      }
    />
  );
}

export type DailyKey = (typeof KEYS)[number];

// The card itself, from values passed in (the public demo keeps its answers on the page).
// `bare`: inside the chat's one-line check-in, which has its own title and frame.
// `food`: the Food and drinks row, on the dashboard and in the Journal (not in the chat, or the demo).
export function DailyCardView({ s, values, onPick, onSkip, inset = false, bare = false, food }: {
  s: Strings;
  values: Record<DailyKey, number | null>;
  onPick: (k: DailyKey, v: number) => void;
  onSkip?: () => void;
  inset?: boolean;
  bare?: boolean;
  food?: Food;
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
      {food && <FoodRow s={s} food={food} />}
      {onSkip && (
        <Tap style={styles.skip} onPress={onSkip} accessibilityRole="button">
          <Text style={styles.link}>{s.dailyNotToday}</Text>
        </Tap>
      )}
    </View>
  );
}

// Folded until tapped, with what's been noted today in the header.
function FoodRow({ s, food }: { s: Strings; food: Food }) {
  const [open, setOpen] = useState(false);
  const foods = food.foods ?? [];
  const cups = food.caffeine ?? 0;
  const foodNames = foods.length ? foods.map((f) => s[`food_${f as (typeof FOODS)[number]}`]).join(", ") : s.foodNone;
  const noted = [food.caffeine !== null && `☕ ${cups}`, food.foods && foodNames].filter(Boolean).join(" · ");
  const toggle = (f: string) => food.onFoods(foods.includes(f) ? foods.filter((x) => x !== f) : [...foods, f]);
  return (
    <View style={styles.food}>
      <Tap style={styles.foodHead} onPress={() => setOpen(!open)} accessibilityRole="button" accessibilityState={{ expanded: open }}>
        <Ionicons name="restaurant-outline" size={18} color={colors.primary} />
        <Text style={styles.label} numberOfLines={1}>
          {s.dailyFood}
          {noted ? <Text style={styles.lineSub}> · {noted}</Text> : null}
        </Text>
        <View style={styles.flex} />
        <SwapIcon id={open ? "up" : "down"}>
          <Ionicons name={open ? "chevron-up" : "chevron-down"} size={18} color={colors.muted} />
        </SwapIcon>
      </Tap>
      <Reveal open={open}>
        <View style={styles.foodBody}>
          <Text style={styles.end}>{s.dailyFoodHint}</Text>
          <View style={styles.row}>
            <View style={styles.flexShrink}>
              <Text style={styles.label}>{s.dailyCaffeine}</Text>
              <Text style={styles.end}>{s.dailyCaffeineHint}</Text>
            </View>
            <View style={styles.stepper}>
              <Tap style={styles.step} onPress={() => food.onCaffeine(Math.max(0, cups - 1))} accessibilityRole="button" accessibilityLabel={`${s.dailyCaffeine}: ${s.dailyFewer}`}>
                <Ionicons name="remove" size={18} color={colors.primary} />
              </Tap>
              <Text style={styles.count} accessibilityLiveRegion="polite">
                {food.caffeine === null ? "–" : cups}
              </Text>
              <Tap style={styles.step} onPress={() => food.onCaffeine(Math.min(20, food.caffeine === null ? 1 : cups + 1))} accessibilityRole="button" accessibilityLabel={`${s.dailyCaffeine}: ${s.dailyMore}`}>
                <Ionicons name="add" size={18} color={colors.primary} />
              </Tap>
            </View>
          </View>
          <View style={styles.chips}>
            {FOODS.map((f) => (
              <Tap key={f} style={[styles.chip, foods.includes(f) && styles.chipOn]} onPress={() => toggle(f)} accessibilityRole="checkbox" accessibilityState={{ checked: foods.includes(f) }}>
                <Text style={[styles.chipText, foods.includes(f) && styles.chipTextOn]}>{s[`food_${f}`]}</Text>
              </Tap>
            ))}
            <Tap style={[styles.chip, food.foods !== null && !foods.length && styles.chipOn]} onPress={() => food.onFoods([])} accessibilityRole="radio" accessibilityState={{ selected: food.foods !== null && !foods.length }}>
              <Text style={[styles.chipText, food.foods !== null && !foods.length && styles.chipTextOn]}>{s.foodNone}</Text>
            </Tap>
          </View>
        </View>
      </Reveal>
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
  food: { borderTopWidth: 1, borderTopColor: colors.border, marginTop: 4 },
  foodHead: { flexDirection: "row", alignItems: "center", gap: 6, minHeight: TOUCH },
  foodBody: { gap: 8, paddingBottom: 6 },
  flex: { flex: 1 },
  flexShrink: { flexShrink: 1 },
  stepper: { flexDirection: "row", alignItems: "center", gap: 4 },
  step: { width: TOUCH, height: TOUCH, borderRadius: radius.pill, alignItems: "center", justifyContent: "center", backgroundColor: colors.primarySoft },
  count: { minWidth: 28, textAlign: "center", color: colors.text, fontSize: 16, fontWeight: "600" },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  chip: { ...ui.chip },
  chipOn: { backgroundColor: colors.primarySoft, borderColor: colors.primary },
  chipText: { color: colors.text, fontSize: 13 },
  chipTextOn: { color: colors.primary, fontWeight: "600" },
}));

// A month of one medication's doses (convex/medications.ts `calendar`): a day is filled teal when every due dose was
// taken, amber when some were, red when a past day's doses were skipped or never answered, and left plain when nothing
// was due. As-needed medications show how many were taken. Arrows step back and forward a month.
import { useState } from "react";
import { ActivityIndicator, Text, View } from "react-native";
import { useQuery } from "convex/react";
import { Ionicons } from "@expo/vector-icons";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { Tap } from "./Tap";
import { colors, radius, themed, TOUCH } from "./theme";
import type { Strings } from "./i18n";
import { formatDate } from "./format";
import { dayString } from "./DateTimeField";
import { monthBounds, weekdayName } from "./medSchedule";

type Day = { date: string; due: number; taken: number; skipped: number };

function tone(d: Day | undefined, past: boolean, asNeeded: boolean) {
  if (!d) return null;
  if (asNeeded) return d.taken ? "all" : null;
  if (d.due && d.taken >= d.due) return "all";
  if (d.taken) return "some";
  return past && d.due ? "none" : null;
}

export function DoseCalendar({ id, asNeeded, s }: { id: Id<"medications">; asNeeded: boolean; s: Strings }) {
  const now = new Date();
  const [month, setMonth] = useState({ y: now.getFullYear(), m: now.getMonth() });
  const { from, to } = monthBounds(month.y, month.m);
  const days = useQuery(api.medications.calendar, { id, from, to });
  const today = dayString(now);
  const first = new Date(month.y, month.m, 1);
  const count = new Date(month.y, month.m + 1, 0).getDate();
  const byDate = new Map((days ?? []).map((d) => [d.date, d]));
  const cells: (string | null)[] = [...Array(first.getDay()).fill(null), ...Array.from({ length: count }, (_, i) => dayString(new Date(month.y, month.m, i + 1)))];
  const step = (n: number) => setMonth(({ y, m }) => ({ y: new Date(y, m + n, 1).getFullYear(), m: new Date(y, m + n, 1).getMonth() }));
  const atNow = month.y === now.getFullYear() && month.m === now.getMonth();

  return (
    <View style={styles.wrap}>
      <View style={styles.head}>
        <Tap style={styles.arrow} onPress={() => step(-1)} accessibilityRole="button" accessibilityLabel={s.prevMonth}>
          <Ionicons name="chevron-back" size={18} color={colors.primary} />
        </Tap>
        <Text style={styles.month} accessibilityRole="header">
          {first.toLocaleDateString(s.locale, { month: "long", year: "numeric" })}
        </Text>
        <Tap style={styles.arrow} onPress={() => step(1)} disabled={atNow} accessibilityRole="button" accessibilityLabel={s.nextMonth} accessibilityState={{ disabled: atNow }}>
          <Ionicons name="chevron-forward" size={18} color={atNow ? colors.border : colors.primary} />
        </Tap>
      </View>
      {days === undefined ? (
        <ActivityIndicator color={colors.primary} />
      ) : (
        <View style={styles.grid}>
          {[0, 1, 2, 3, 4, 5, 6].map((d) => (
            <Text key={`h${d}`} style={styles.weekday}>
              {weekdayName(d, s).slice(0, 2)}
            </Text>
          ))}
          {cells.map((date, i) => {
            if (!date) return <View key={`e${i}`} style={styles.cell} />;
            const d = byDate.get(date);
            const t = tone(d, date < today, asNeeded);
            const label = [
              formatDate(date, s, { weekday: "long", month: "long", day: "numeric" }),
              d && (asNeeded ? s.calTakenN.replace("{n}", String(d.taken)) : s.calTakenOf.replace("{a}", String(d.taken)).replace("{b}", String(d.due))),
            ]
              .filter(Boolean)
              .join(", ");
            return (
              <View key={date} style={styles.cell} accessible accessibilityLabel={label}>
                <View style={[styles.dot, t === "all" && styles.all, t === "some" && styles.some, t === "none" && styles.none, date === today && styles.today]}>
                  <Text style={[styles.num, t === "all" && styles.numOn]}>{Number(date.slice(8))}</Text>
                </View>
              </View>
            );
          })}
        </View>
      )}
      <View style={styles.legend}>
        <Legend style={styles.all} text={asNeeded ? s.calTook : s.calAll} />
        {!asNeeded && <Legend style={styles.some} text={s.calSome} />}
        {!asNeeded && <Legend style={styles.none} text={s.calMissed} />}
      </View>
    </View>
  );
}

function Legend({ style, text }: { style: object; text: string }) {
  return (
    <View style={styles.legendItem}>
      <View style={[styles.swatch, style]} />
      <Text style={styles.legendText}>{text}</Text>
    </View>
  );
}

const styles = themed(() => ({
  wrap: { gap: 8 },
  head: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  arrow: { width: TOUCH, height: TOUCH, alignItems: "center", justifyContent: "center" },
  month: { fontSize: 15, fontWeight: "700", color: colors.text },
  grid: { flexDirection: "row", flexWrap: "wrap" },
  weekday: { width: "14.28%", textAlign: "center", fontSize: 12, color: colors.muted, paddingBottom: 4 },
  cell: { width: "14.28%", alignItems: "center", paddingVertical: 3 },
  dot: { width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center" },
  all: { backgroundColor: colors.primary },
  some: { backgroundColor: colors.warningSoft, borderWidth: 1, borderColor: colors.amber },
  none: { backgroundColor: colors.dangerSoft, borderWidth: 1, borderColor: colors.dangerBorder },
  today: { borderWidth: 2, borderColor: colors.text },
  num: { fontSize: 13, color: colors.text },
  numOn: { color: colors.onPrimary, fontWeight: "700" },
  legend: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 6 },
  swatch: { width: 14, height: 14, borderRadius: radius.pill },
  legendText: { fontSize: 12, color: colors.muted },
}));

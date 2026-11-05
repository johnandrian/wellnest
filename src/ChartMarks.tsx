// What charts draw over their bars, shared by the dashboard, charts in chat, and the welcome page example:
// a green medicine marker on the day a medicine was started or its dose changed, with a faint green column down
// that day (like the weather markers on the welcome page), and the dots of a 7-day average line (weight).
import { Text, View } from "react-native";
import { Icon } from "./Icon";
import { themed, tint } from "./theme";
import type { Strings } from "./i18n";

export type MedMark = { date: string; name: string; kind: "started" | "dose_changed" };

// The faint column behind a marked day's bar. Its parent slot needs no padding; this fills it.
export function MedBand() {
  return <View pointerEvents="none" style={styles.band} />;
}

// The row of markers above the bars, one slot per day.
export function MedPins({ dates, meds, size = 12, gap = 1 }: { dates: string[]; meds: MedMark[]; size?: number; gap?: number }) {
  const on = new Set(meds.map((m) => m.date));
  return (
    <View style={[styles.pins, { gap }]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {dates.map((d) => (
        <View key={d} style={styles.pinSlot}>
          {on.has(d) && <Icon name="medications" size={size} color={tint.guides.fg} />}
        </View>
      ))}
    </View>
  );
}

// "Started metformin (Oct 3) · Lisinopril dose changed (Oct 20)" under the chart.
export function MedLegend({ meds, s }: { meds: MedMark[]; s: Strings }) {
  if (!meds.length) return null;
  const day = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" });
  const text = meds
    .map((m) => `${(m.kind === "started" ? s.chartMedStarted : s.chartMedDose).replace("{name}", m.name)} (${day(m.date)})`)
    .join(" · ");
  return (
    <View style={styles.legend}>
      <Icon name="medications" size={13} color={tint.guides.fg} />
      <Text style={styles.legendText}>{text}</Text>
    </View>
  );
}

// One dot of the average line, `share` (0-1) of the way up its slot.
export function TrendDot({ share, color }: { share: number; color: string }) {
  return <View pointerEvents="none" style={[styles.dot, { bottom: `${Math.max(0, Math.min(1, share)) * 100}%`, backgroundColor: color }]} />;
}

const styles = themed(() => ({
  band: { position: "absolute", top: 0, bottom: 0, left: -1, right: -1, borderRadius: 3, backgroundColor: tint.guides.bg },
  pins: { flexDirection: "row", height: 16 },
  pinSlot: { flex: 1, minWidth: 0, alignItems: "center", justifyContent: "center", overflow: "visible" },
  legend: { flexDirection: "row", alignItems: "flex-start", gap: 5 },
  legendText: { flex: 1, fontSize: 12, lineHeight: 16, color: tint.guides.fg, fontWeight: "600" },
  dot: { position: "absolute", left: "50%", width: 5, height: 5, marginLeft: -2.5, marginBottom: -2.5, borderRadius: 3 },
}));

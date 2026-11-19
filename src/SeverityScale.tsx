// The one 0-10 scale for how bad something is, used for symptoms (./SymptomLog.tsx) and the pain tracker
// (./TrackersSection.tsx): eleven steps sharing the row, each outlined in its color and filled when chosen, the two
// ends named, and the chosen level said in words.
import { Text, View } from "react-native";
import { Tap } from "./Tap";
import { Enter } from "./Motion";
import { colors, inkOn, radius, severityColor, themed } from "./theme";
import type { Strings } from "./i18n";

// 0 none, 1-3 mild, 4-6 moderate, 7-8 severe, 9-10 the worst.
export const levelOf = (n: number) => (n === 0 ? 0 : n <= 3 ? 1 : n <= 6 ? 2 : n <= 8 ? 3 : 4);

export function SeverityScale({ value, onChange, label, s }: { value: number | null; onChange: (n: number | null) => void; label: string; s: Strings }) {
  return (
    <View style={styles.wrap}>
      <View style={styles.scale} accessibilityRole="radiogroup" accessibilityLabel={label}>
        {Array.from({ length: 11 }, (_, n) => {
          const on = value === n;
          return (
            <Tap
              key={n}
              style={[styles.step, { borderColor: severityColor(n) }, on && { backgroundColor: severityColor(n) }]}
              onPress={() => onChange(on ? null : n)}
              accessibilityRole="radio"
              accessibilityLabel={`${s.logOutOf.replace("{n}", String(n))}, ${s.logLevels[levelOf(n)]}`}
              accessibilityState={{ selected: on }}
            >
              <Text style={[styles.stepText, on && { color: inkOn(severityColor(n)) }]}>{n}</Text>
            </Tap>
          );
        })}
      </View>
      <View style={styles.ends}>
        <Text style={styles.small}>{s.logLevels[0]}</Text>
        <Text style={styles.small}>{s.logLevels[4]}</Text>
      </View>
      {value !== null && (
        <Enter key={levelOf(value)} from={6} style={styles.levelRow}>
          <View style={[styles.levelDot, { backgroundColor: severityColor(value) }]} />
          <Text style={styles.level}>
            {s.logOutOf.replace("{n}", String(value))} · {s.logLevels[levelOf(value)]}
          </Text>
        </Enter>
      )}
    </View>
  );
}

const styles = themed(() => ({
  wrap: { gap: 6 },
  scale: { flexDirection: "row", gap: 4 },
  step: { flex: 1, minWidth: 0, height: 52, borderRadius: radius.sm, borderWidth: 2, alignItems: "center", justifyContent: "center", backgroundColor: colors.surface },
  stepText: { fontSize: 16, fontWeight: "700", color: colors.text },
  ends: { flexDirection: "row", justifyContent: "space-between" },
  small: { fontSize: 13, color: colors.muted },
  levelRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  levelDot: { width: 12, height: 12, borderRadius: 9 },
  level: { fontSize: 16, fontWeight: "700", color: colors.text },
}));

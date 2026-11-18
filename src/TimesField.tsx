// A medication's reminder times: one time picker per time, a button to remove each, and "Add a time". The value is the
// same "08:00, 20:00" text the forms already keep, so saving doesn't change. Rows keep their place while a time is
// changed (so the browser's time box keeps focus) and are sorted when one is added or removed.
import { Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Tap } from "./Tap";
import { TimeField } from "./DateTimeField";
import { colors, themed, TOUCH, ui } from "./theme";
import type { Strings } from "./i18n";
import { joinTimes as join, nextTime, splitTimes } from "./times";

export function TimesField({ value, onChange, s }: { value: string; onChange: (v: string) => void; s: Strings }) {
  const times = splitTimes(value);
  return (
    <View style={styles.wrap}>
      {times.map((t, i) => (
        <View key={i} style={styles.row}>
          <TimeField value={t} onChange={(v) => onChange(times.map((x, j) => (j === i ? v : x)).join(", "))} label={s.timeLabel} s={s} />
          {times.length > 1 && (
            <Tap style={styles.remove} onPress={() => onChange(join(times.filter((_, j) => j !== i)))} accessibilityRole="button" accessibilityLabel={s.removeTime}>
              <Ionicons name="close" size={20} color={colors.muted} />
            </Tap>
          )}
        </View>
      ))}
      <Tap style={[ui.addButton, styles.add]} onPress={() => onChange(join([...times, nextTime(times)]))} accessibilityRole="button">
        <Ionicons name="add" size={18} color={colors.primary} />
        <Text style={styles.addText}>{s.addTime}</Text>
      </Tap>
    </View>
  );
}

const styles = themed(() => ({
  wrap: { gap: 8 },
  row: { flexDirection: "row", alignItems: "center", gap: 8 },
  remove: { width: TOUCH, height: TOUCH, alignItems: "center", justifyContent: "center" },
  add: { alignSelf: "flex-start" },
  addText: { color: colors.primary, fontWeight: "600", fontSize: 14 },
}));

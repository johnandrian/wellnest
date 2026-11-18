// Date and time fields for iPhone and Android (the browser has its own in ./DateTimeField.web.tsx). Values stay the
// plain strings the app already stores: "2026-11-18" for a day and "08:30" for a time (24-hour, local).
// iPhone shows the compact system picker in place; Android opens the system dialog from a field-shaped button.
import { Platform, Text, View } from "react-native";
import DateTimePicker, { DateTimePickerAndroid, type DateTimePickerEvent } from "@react-native-community/datetimepicker";
import { Ionicons } from "@expo/vector-icons";
import { Tap } from "./Tap";
import { colors, radius, themed, TOUCH } from "./theme";
import { formatDate, formatTime } from "./format";
import type { Strings } from "./i18n";

const pad = (n: number) => String(n).padStart(2, "0");
export const dayString = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const timeString = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
const fromDay = (v: string) => (/^\d{4}-\d{2}-\d{2}$/.test(v) ? new Date(`${v}T12:00:00`) : new Date());
const fromTime = (v: string) => {
  const m = v.match(/^(\d{1,2}):(\d{2})$/);
  const d = new Date();
  d.setHours(m ? Number(m[1]) : 8, m ? Number(m[2]) : 0, 0, 0);
  return d;
};

type Props = { value: string; onChange: (v: string) => void; label: string; s: Strings };

export function DateField({ value, onChange, label, s }: Props) {
  return <Field mode="date" value={fromDay(value)} text={formatDate(value, s, { weekday: "short", month: "short", day: "numeric", year: "numeric" })} onPick={(d) => onChange(dayString(d))} label={label} />;
}

export function TimeField({ value, onChange, label, s }: Props) {
  const d = fromTime(value);
  return <Field mode="time" value={d} text={formatTime(d.getTime(), s)} onPick={(t) => onChange(timeString(t))} label={label} />;
}

function Field({ mode, value, text, onPick, label }: { mode: "date" | "time"; value: Date; text: string; onPick: (d: Date) => void; label: string }) {
  const changed = (e: DateTimePickerEvent, d?: Date) => {
    if (e.type === "set" && d) onPick(d);
  };
  if (Platform.OS === "ios") {
    return (
      <View style={styles.ios} accessibilityLabel={label}>
        <DateTimePicker value={value} mode={mode} display="compact" onChange={changed} />
      </View>
    );
  }
  return (
    <Tap
      style={styles.field}
      onPress={() => DateTimePickerAndroid.open({ value, mode, onChange: changed })}
      accessibilityRole="button"
      accessibilityLabel={`${label}: ${text}`}
    >
      <Ionicons name={mode === "date" ? "calendar-outline" : "time-outline"} size={18} color={colors.primary} />
      <Text style={styles.text}>{text}</Text>
    </Tap>
  );
}

const styles = themed(() => ({
  ios: { minHeight: TOUCH, justifyContent: "center", alignItems: "flex-start" },
  field: { flexDirection: "row", alignItems: "center", gap: 8, minHeight: TOUCH, paddingHorizontal: 12, borderWidth: 1, borderColor: colors.inputBorder, borderRadius: radius.md, backgroundColor: colors.surface },
  text: { fontSize: 16, color: colors.text },
}));

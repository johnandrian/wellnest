// A medication's dose as a number and a unit picked from chips (mg, tablets, puffs…), or a unit typed under "Other".
// It's stored as one line of text ("500 mg", "2 tablets") in the user's language, as before, so the chat, reminders
// and older doses typed by hand keep working; an existing dose is read back into the number and the chip.
import { useEffect, useState } from "react";
import { Text, TextInput, View } from "react-native";
import { Tap } from "./Tap";
import { colors, radius, TOUCH, ui, themed } from "./theme";
import type { Strings } from "./i18n";
import { Dose, DOSE_UNITS, doseUnitForms as forms, formatDose, parseDose, Unit } from "./dose";

export function DoseInput({ value, onChange, s }: { value: string; onChange: (dose: string) => void; s: Strings }) {
  const [d, setD] = useState<Dose>(() => parseDose(value, s));
  // The parent cleared or replaced the dose (after saving, or a label scan): read it again.
  useEffect(() => {
    if (value !== formatDose(d, s)) setD(parseDose(value, s));
  }, [value]);
  const set = (next: Dose) => {
    setD(next);
    onChange(formatDose(next, s));
  };
  const chip = (key: Unit | "other", label: string) => {
    const on = d.unit === key;
    return (
      <Tap
        key={key}
        style={[styles.chip, on && styles.chipOn]}
        onPress={() => set({ ...d, unit: on ? null : key })}
        accessibilityRole="radio"
        accessibilityState={{ selected: on }}
      >
        <Text style={[styles.chipText, on && styles.chipTextOn]}>{label}</Text>
      </Tap>
    );
  };
  return (
    <View style={styles.wrap}>
      <View style={styles.row}>
        <TextInput
          style={[styles.input, styles.amount]}
          value={d.amount}
          onChangeText={(amount) => set({ ...d, amount: amount.replace(/[^\d.,/]/g, "").slice(0, 8) })}
          placeholder={s.doseAmount}
          placeholderTextColor={colors.muted}
          keyboardType="decimal-pad"
          accessibilityLabel={s.doseAmount}
        />
        {d.unit === "other" && (
          <TextInput
            style={[styles.input, styles.flex]}
            value={d.other}
            onChangeText={(other) => set({ ...d, other: other.slice(0, 40) })}
            placeholder={s.doseOtherPh}
            placeholderTextColor={colors.muted}
            accessibilityLabel={s.doseOtherPh}
          />
        )}
      </View>
      <View style={styles.chips} accessibilityRole="radiogroup">
        {DOSE_UNITS.map((u) => chip(u, d.amount.trim() === "1" ? forms(s, u).one : forms(s, u).many))}
        {chip("other", s.doseOther)}
      </View>
    </View>
  );
}

const styles = themed(() => ({
  wrap: { gap: 8 },
  row: { flexDirection: "row", gap: 8, alignItems: "center" },
  flex: { flex: 1, minWidth: 0 },
  input: { minHeight: TOUCH, borderWidth: 1, borderColor: colors.inputBorder, borderRadius: radius.md, paddingHorizontal: 12, fontSize: 16, color: colors.text, backgroundColor: colors.surface },
  amount: { width: 110 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  chip: { ...ui.chip, minHeight: 36, paddingHorizontal: 12, backgroundColor: colors.surface },
  chipOn: ui.chipOn,
  chipText: { fontSize: 14, color: colors.text },
  chipTextOn: { color: colors.primary, fontWeight: "600" },
}));

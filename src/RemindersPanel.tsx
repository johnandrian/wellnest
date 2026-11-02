// Medication reminders (convex/reminders.ts): the active list and a form to add one. Due doses show up in the chat.
import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useMutation, useQuery } from "convex/react";
import { Ionicons } from "@expo/vector-icons";
import { api } from "../convex/_generated/api";
import { colors } from "./theme";
import type { Strings } from "./i18n";

type Mode = "daily" | "interval";

function when(at: number, s: Strings) {
  const d = new Date(at);
  const today = new Date();
  const time = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  return d.toDateString() === today.toDateString() ? `${s.today} ${time}` : `${d.toLocaleDateString([], { weekday: "short" })} ${time}`;
}

type Rule = { kind: "daily"; times: string[] } | { kind: "interval"; everyHours: number };
const describe = (r: Rule, s: Strings) =>
  r.kind === "daily" ? s.dailyAt.replace("{times}", r.times.join(", ")) : s.everyNHours.replace("{n}", String(r.everyHours));

export function RemindersPanel({ s }: { s: Strings }) {
  const meds = useQuery(api.reminders.list);
  const add = useMutation(api.reminders.add);
  const remove = useMutation(api.reminders.remove);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [dose, setDose] = useState("");
  const [mode, setMode] = useState<Mode>("daily");
  const [times, setTimes] = useState("08:00");
  const [hours, setHours] = useState("8");
  const [days, setDays] = useState("");
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setError(null);
    const everyHours = Number(hours);
    try {
      await add({
        name,
        dose: dose || undefined,
        days: days ? Number(days) : undefined,
        schedule:
          mode === "daily"
            ? { kind: "daily", times: times.split(/[,\s]+/).filter(Boolean) }
            : { kind: "interval", everyHours, firstAt: Date.now() + everyHours * 3_600_000 },
      });
      setAdding(false);
      setName("");
      setDose("");
      setDays("");
    } catch (e) {
      setError((e as Error).message.replace(/^.*Uncaught Error: /, "").split("\n")[0]);
    }
  };

  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.panel}>
      <View style={styles.titleRow}>
        <Ionicons name="medkit-outline" size={20} color={colors.primary} />
        <Text style={styles.title}>{s.remindersTitle}</Text>
      </View>
      <Text style={styles.note}>{s.remindersIntro}</Text>

      {meds?.length === 0 && !adding && <Text style={styles.empty}>{s.remindersEmpty}</Text>}
      {meds?.map((m) => (
        <View key={m._id} style={styles.med}>
          <View style={styles.medText}>
            <Text style={styles.medName}>
              {m.name}
              {m.dose ? <Text style={styles.dose}> · {m.dose}</Text> : null}
            </Text>
            <Text style={styles.small}>
              {describe(m.rule, s)}
              {m.nextAt ? ` · ${s.nextAt.replace("{when}", when(m.nextAt, s))}` : ""}
              {m.endsAt ? ` · ${s.until.replace("{date}", new Date(m.endsAt).toLocaleDateString())}` : ""}
            </Text>
          </View>
          <Pressable onPress={() => void remove({ id: m._id })} accessibilityRole="button" accessibilityLabel={s.stopReminders.replace("{name}", m.name)}>
            <Ionicons name="trash-outline" size={20} color={colors.danger} />
          </Pressable>
        </View>
      ))}

      {adding ? (
        <View style={styles.form}>
          <TextInput style={styles.input} placeholder={s.medPlaceholder} placeholderTextColor={colors.muted} value={name} onChangeText={setName} />
          <TextInput style={styles.input} placeholder={s.dosePlaceholder} placeholderTextColor={colors.muted} value={dose} onChangeText={setDose} />
          <View style={styles.chips}>
            {(["daily", "interval"] as const).map((m) => (
              <Pressable
                key={m}
                style={[styles.chip, mode === m && styles.chipOn]}
                onPress={() => setMode(m)}
                accessibilityRole="radio"
                accessibilityState={{ selected: mode === m }}
              >
                <Text style={[styles.chipText, mode === m && styles.chipTextOn]}>{m === "daily" ? s.atSetTimes : s.everyFewHours}</Text>
              </Pressable>
            ))}
          </View>
          {mode === "daily" ? (
            <TextInput
              style={styles.input}
              placeholder={s.timesPlaceholder}
              placeholderTextColor={colors.muted}
              value={times}
              onChangeText={setTimes}
              autoCapitalize="none"
            />
          ) : (
            <View style={styles.inline}>
              <Text style={styles.label}>{s.every}</Text>
              <TextInput style={[styles.input, styles.short]} value={hours} onChangeText={setHours} keyboardType="numeric" />
              <Text style={styles.label}>{s.hoursFromNow}</Text>
            </View>
          )}
          <View style={styles.inline}>
            <Text style={styles.label}>{s.forLabel}</Text>
            <TextInput style={[styles.input, styles.short]} value={days} onChangeText={setDays} keyboardType="numeric" placeholder="∞" placeholderTextColor={colors.muted} />
            <Text style={styles.label}>{s.daysKeepGoing}</Text>
          </View>
          <View style={styles.inline}>
            <Pressable style={styles.button} onPress={() => void save()} accessibilityRole="button">
              <Text style={styles.buttonText}>{s.saveReminder}</Text>
            </Pressable>
            <Pressable onPress={() => setAdding(false)} accessibilityRole="button">
              <Text style={styles.link}>{s.cancel}</Text>
            </Pressable>
          </View>
        </View>
      ) : (
        <Pressable style={styles.addRow} onPress={() => setAdding(true)} accessibilityRole="button">
          <Ionicons name="add-circle-outline" size={20} color={colors.primary} />
          <Text style={styles.link}>{s.addReminder}</Text>
        </Pressable>
      )}
      {error && <Text style={styles.error}>{error}</Text>}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { maxHeight: "75%", flexGrow: 0, flexShrink: 1, backgroundColor: "#fff", borderBottomWidth: 1, borderBottomColor: colors.border },
  panel: { padding: 16, gap: 10, maxWidth: 760, width: "100%", alignSelf: "center" },
  titleRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  title: { fontSize: 17, fontWeight: "700", color: colors.text },
  note: { color: colors.muted, fontSize: 14, lineHeight: 19 },
  empty: { color: colors.muted, fontStyle: "italic" },
  small: { color: colors.muted, fontSize: 13 },
  med: { flexDirection: "row", alignItems: "center", gap: 10, borderWidth: 1, borderColor: colors.border, borderRadius: 10, padding: 10 },
  medText: { flex: 1, gap: 2 },
  medName: { fontSize: 15, fontWeight: "600", color: colors.text },
  dose: { fontWeight: "400", color: colors.muted },
  form: { gap: 8 },
  input: { borderWidth: 1, borderColor: colors.border, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8, fontSize: 15 },
  short: { width: 56, textAlign: "center" },
  inline: { flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" },
  label: { color: colors.text, fontSize: 14 },
  chips: { flexDirection: "row", gap: 8 },
  chip: { borderWidth: 1, borderColor: colors.border, borderRadius: 16, paddingHorizontal: 12, paddingVertical: 6 },
  chipOn: { backgroundColor: colors.primarySoft, borderColor: colors.primary },
  chipText: { color: colors.text, fontSize: 14 },
  chipTextOn: { color: colors.primary, fontWeight: "600" },
  button: { backgroundColor: colors.primary, borderRadius: 10, paddingVertical: 10, paddingHorizontal: 16 },
  buttonText: { color: "#fff", fontWeight: "600" },
  addRow: { flexDirection: "row", alignItems: "center", gap: 6, paddingVertical: 4 },
  link: { color: colors.primary, fontWeight: "600" },
  error: { color: colors.danger, fontSize: 13 },
});

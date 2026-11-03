// Exercises and physio (convex/exercises.ts): today's routine to tick off, the last two weeks at a glance, and
// adding or stopping an exercise. "Did my stretches" in chat ticks it off too.
import { useState } from "react";
import { ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { Tap } from "./Tap";
import { useMutation, useQuery } from "convex/react";
import { Ionicons } from "@expo/vector-icons";
import { api } from "../convex/_generated/api";
import { colors, ui, TOUCH } from "./theme";
import type { Strings } from "./i18n";
import { localDate } from "./DailyCard";

const cleanError = (e: unknown) => (e as Error).message.replace(/^.*Uncaught Error: /, "").split("\n")[0];
const num = (s: string) => (s.trim() && Number.isFinite(Number(s)) ? Number(s) : undefined);

export function ExercisePanel({ s }: { s: Strings }) {
  const today = localDate();
  const list = useQuery(api.exercises.list, { date: today });
  const add = useMutation(api.exercises.add);
  const toggle = useMutation(api.exercises.toggle);
  const stop = useMutation(api.exercises.stop);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [sets, setSets] = useState("");
  const [reps, setReps] = useState("");
  const [minutes, setMinutes] = useState("");
  const [days, setDays] = useState<number[]>([]);
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const weekdays = s.weekdaysShort.split(",");

  const save = async () => {
    setError(null);
    try {
      await add({ name, sets: num(sets), reps: num(reps), minutes: num(minutes), days, notes: notes || undefined });
      setAdding(false);
      setName(""); setSets(""); setReps(""); setMinutes(""); setDays([]); setNotes("");
    } catch (e) {
      setError(cleanError(e));
    }
  };

  const plan = (e: { sets: number | null; reps: number | null; minutes: number | null; days: number[] }) =>
    [
      e.sets && e.reps ? `${e.sets} × ${e.reps}` : e.reps ? `${e.reps} ${s.exReps}` : "",
      e.minutes ? `${e.minutes} min` : "",
      e.days.length ? e.days.map((d) => weekdays[d]).join(" ") : s.exEveryDay,
    ].filter(Boolean).join(" · ");

  const due = list?.filter((e) => e.dueToday) ?? [];
  const notDue = list?.filter((e) => !e.dueToday) ?? [];

  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.panel}>
      <Text style={styles.note}>{s.exIntro}</Text>
      {list?.length === 0 && !adding && <Text style={styles.empty}>{s.exEmpty}</Text>}
      {!!due.length && <Text style={styles.section}>{s.exToday}</Text>}
      {[...due, ...notDue].map((e, i) => (
        <View key={e._id}>
          {i === due.length && notDue.length > 0 && <Text style={styles.section}>{s.exNotToday}</Text>}
          <View style={styles.card}>
            <View style={styles.head}>
              {e.dueToday && (
                <Tap onPress={() => void toggle({ id: e._id, date: today, done: !e.doneToday })} accessibilityRole="checkbox" accessibilityState={{ checked: e.doneToday }} accessibilityLabel={e.name}>
                  <Ionicons name={e.doneToday ? "checkmark-circle" : "ellipse-outline"} size={28} color={e.doneToday ? colors.primary : colors.muted} />
                </Tap>
              )}
              <View style={styles.flex}>
                <Text style={[styles.title, e.doneToday && styles.done]}>{e.name}</Text>
                <Text style={styles.small}>{plan(e)}</Text>
                {e.notes && <Text style={styles.small}>{e.notes}</Text>}
              </View>
              <Tap onPress={() => void stop({ id: e._id })} accessibilityRole="button" accessibilityLabel={`${s.exStop} ${e.name}`}>
                <Ionicons name="close" size={18} color={colors.muted} />
              </Tap>
            </View>
            <View style={styles.strip} accessibilityLabel={s.exLast14}>
              {e.last14.map((d) => (
                <View key={d.date} style={[styles.dot, !d.scheduled && styles.dotOff, d.done && styles.dotDone, d.scheduled && !d.done && d.date < today && styles.dotMissed]} />
              ))}
            </View>
          </View>
        </View>
      ))}

      {adding ? (
        <View style={styles.form}>
          <TextInput style={styles.input} placeholder={s.exNamePlaceholder} placeholderTextColor={colors.muted} value={name} onChangeText={setName} />
          <View style={styles.inline}>
            <TextInput style={[styles.input, styles.short]} value={sets} onChangeText={setSets} keyboardType="numeric" accessibilityLabel={s.exSets} />
            <Text style={styles.label}>{s.exSets}</Text>
            <TextInput style={[styles.input, styles.short]} value={reps} onChangeText={setReps} keyboardType="numeric" accessibilityLabel={s.exReps} />
            <Text style={styles.label}>{s.exReps}</Text>
            <TextInput style={[styles.input, styles.short]} value={minutes} onChangeText={setMinutes} keyboardType="numeric" accessibilityLabel="min" />
            <Text style={styles.label}>min</Text>
          </View>
          <View style={styles.chips}>
            {weekdays.map((w, d) => (
              <Tap key={w} style={[styles.chip, days.includes(d) && styles.chipOn]} onPress={() => setDays(days.includes(d) ? days.filter((x) => x !== d) : [...days, d])} accessibilityRole="checkbox" accessibilityState={{ checked: days.includes(d) }}>
                <Text style={[styles.chipText, days.includes(d) && styles.chipTextOn]}>{w}</Text>
              </Tap>
            ))}
          </View>
          <Text style={styles.small}>{s.exDaysHint}</Text>
          <TextInput style={styles.input} placeholder={s.exNotesPlaceholder} placeholderTextColor={colors.muted} value={notes} onChangeText={setNotes} />
          <View style={styles.inline}>
            <Tap style={styles.button} onPress={() => void save()} accessibilityRole="button">
              <Text style={styles.buttonText}>{s.save}</Text>
            </Tap>
            <Tap onPress={() => setAdding(false)} accessibilityRole="button">
              <Text style={styles.link}>{s.cancel}</Text>
            </Tap>
          </View>
          {error && <Text style={styles.error}>{error}</Text>}
        </View>
      ) : (
        <Tap style={styles.addRow} onPress={() => setAdding(true)} accessibilityRole="button">
          <Ionicons name="add-circle-outline" size={20} color={colors.primary} />
          <Text style={styles.link}>{s.exAdd}</Text>
        </Tap>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1, backgroundColor: colors.bg },
  panel: { padding: 16, gap: 10, maxWidth: 760, width: "100%", alignSelf: "center" },
  note: { color: colors.muted, fontSize: 14, lineHeight: 19 },
  empty: { ...ui.empty },
  section: { fontSize: 17, fontWeight: "700", color: colors.text, marginTop: 4, marginBottom: 6 },
  small: { color: colors.muted, fontSize: 13 },
  card: { ...ui.card, padding: 10, gap: 8 },
  head: { flexDirection: "row", alignItems: "center", gap: 10 },
  flex: { flex: 1, minWidth: 0 },
  title: { fontSize: 15, fontWeight: "600", color: colors.text },
  done: { color: colors.muted, textDecorationLine: "line-through" },
  strip: { flexDirection: "row", gap: 3 },
  dot: { flex: 1, height: 8, borderRadius: 4, backgroundColor: colors.border },
  dotOff: { backgroundColor: colors.bg },
  dotDone: { backgroundColor: colors.primary },
  dotMissed: { backgroundColor: "#F59E0B" },
  form: { gap: 8 },
  input: { borderWidth: 1, borderColor: colors.inputBorder, backgroundColor: colors.surface, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8, fontSize: 15, minWidth: 0 },
  short: { width: 56, textAlign: "center" },
  inline: { flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" },
  label: { color: colors.text, fontSize: 14 },
  chips: { flexDirection: "row", gap: 6, flexWrap: "wrap" },
  chip: { ...ui.chip },
  chipOn: { backgroundColor: colors.primarySoft, borderColor: colors.primary },
  chipText: { color: colors.text, fontSize: 13 },
  chipTextOn: { color: colors.primary, fontWeight: "600" },
  button: { backgroundColor: colors.primary, borderRadius: 10, paddingVertical: 9, paddingHorizontal: 16, minHeight: TOUCH, justifyContent: "center" },
  buttonText: { color: colors.onPrimary, fontWeight: "600" },
  addRow: { ...ui.addButton },
  link: { color: colors.primary, fontWeight: "600" },
  error: { color: colors.danger, fontSize: 13 },
});

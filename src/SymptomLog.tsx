// "Log a symptom" in the Journal (convex/journal.ts), built to be done in a few taps: pick what's bothering you from
// big buttons (your own recent symptoms first, then common ones) or type it, tap how bad it is on a 0-10 bar that says
// the level in words, pick today or yesterday, add a note if you like, and save. Recent entries list below it.
import { useState } from "react";
import { Text, TextInput, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useMutation } from "convex/react";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { Tap } from "./Tap";
import { colors, inkOn, radius, severityColor, TOUCH, ui, themed } from "./theme";
import type { Strings } from "./i18n";
import { Enter, Reveal, SwapIcon } from "./Motion";
import { localDate } from "./DailyCard";

const MAX_CHOICES = 10;

// 0 none, 1-3 mild, 4-6 moderate, 7-8 severe, 9-10 the worst.
export const levelOf = (n: number) => (n === 0 ? 0 : n <= 3 ? 1 : n <= 6 ? 2 : n <= 8 ? 3 : 4);
const cap = (x: string) => x.charAt(0).toUpperCase() + x.slice(1);

function dayName(date: string, s: Strings) {
  const today = localDate();
  const d = new Date();
  d.setDate(d.getDate() - 1);
  if (date === today) return s.chatToday;
  if (date === localDate(d)) return s.chatYesterday;
  return new Date(`${date}T12:00:00`).toLocaleDateString(s.locale, { weekday: "short", month: "short", day: "numeric" });
}

type Entry = { _id: Id<"symptomEntries">; date: string; symptom: string; severity: number | null; note: string | null };

export function SymptomLog({ s, mine, recent }: { s: Strings; mine: string[]; recent: Entry[] }) {
  const add = useMutation(api.journal.add);
  const remove = useMutation(api.journal.remove);
  const [picked, setPicked] = useState<string | null>(null);
  const [typing, setTyping] = useState(false);
  const [other, setOther] = useState("");
  const [severity, setSeverity] = useState<number | null>(null);
  const [yesterday, setYesterday] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  // Their own symptoms first, then common ones, without repeats.
  const seen = new Set<string>();
  const choices = [...mine.map(cap), ...s.logCommon].filter((x) => {
    const k = x.toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  }).slice(0, MAX_CHOICES);

  const symptom = (typing ? other : picked ?? "").trim();

  const pick = (x: string) => {
    setSaved(null);
    setTyping(false);
    setPicked(picked === x ? null : x);
  };

  const save = async () => {
    if (!symptom || busy) return;
    setBusy(true);
    setError(null);
    try {
      const d = new Date();
      d.setDate(d.getDate() - 1);
      await add({ symptom, severity: severity ?? undefined, note: note.trim() || undefined, date: yesterday ? localDate(d) : localDate() });
      setSaved(severity === null ? symptom : `${symptom} · ${s.logOutOf.replace("{n}", String(severity))}`);
      setPicked(null);
      setTyping(false);
      setOther("");
      setSeverity(null);
      setNote("");
      setYesterday(false);
    } catch (e) {
      setError((e as Error).message.replace(/^.*Uncaught Error: /, "").split("\n")[0]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <View style={styles.card}>
        <View style={styles.head}>
          <View style={styles.headIcon}>
            <Ionicons name="add" size={20} color={colors.primary} />
          </View>
          <Text style={styles.title} accessibilityRole="header">
            {s.journalAdd}
          </Text>
        </View>

        <Text style={styles.question}>{s.logWhat}</Text>
        <View style={styles.choices}>
          {choices.map((x) => {
            const on = !typing && picked === x;
            return (
              <Tap key={x} style={[styles.choice, on && styles.choiceOn]} onPress={() => pick(x)} accessibilityRole="radio" accessibilityState={{ selected: on }}>
                {on && <Ionicons name="checkmark" size={18} color={colors.primary} />}
                <Text style={[styles.choiceText, on && styles.choiceTextOn]}>{x}</Text>
              </Tap>
            );
          })}
          <Tap
            style={[styles.choice, typing && styles.choiceOn]}
            onPress={() => (setSaved(null), setTyping(!typing))}
            accessibilityRole="radio"
            accessibilityState={{ selected: typing }}
          >
            <Ionicons name="create-outline" size={18} color={typing ? colors.primary : colors.text} />
            <Text style={[styles.choiceText, typing && styles.choiceTextOn]}>{s.logOther}</Text>
          </Tap>
        </View>
        <Reveal open={typing}>
          <TextInput
            style={styles.input}
            value={other}
            onChangeText={setOther}
            placeholder={s.journalSymptomPlaceholder}
            placeholderTextColor={colors.muted}
            maxLength={60}
            autoFocus
            accessibilityLabel={s.logOther}
            returnKeyType="done"
          />
        </Reveal>

        <Text style={styles.question}>{s.logHowBad}</Text>
        <View style={styles.scale} accessibilityRole="radiogroup" accessibilityLabel={s.logHowBad}>
          {Array.from({ length: 11 }, (_, n) => {
            const on = severity === n;
            return (
              <Tap
                key={n}
                style={[styles.step, { borderColor: severityColor(n) }, on && { backgroundColor: severityColor(n) }]}
                onPress={() => setSeverity(on ? null : n)}
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
        {severity !== null && (
          <Enter key={levelOf(severity)} from={6} style={styles.levelRow}>
            <View style={[styles.levelDot, { backgroundColor: severityColor(severity) }]} />
            <Text style={styles.level}>
              {s.logOutOf.replace("{n}", String(severity))} · {s.logLevels[levelOf(severity)]}
            </Text>
          </Enter>
        )}

        <Text style={styles.question}>{s.logWhen}</Text>
        <View style={styles.choices}>
          {[false, true].map((y) => (
            <Tap key={String(y)} style={[styles.choice, yesterday === y && styles.choiceOn]} onPress={() => setYesterday(y)} accessibilityRole="radio" accessibilityState={{ selected: yesterday === y }}>
              <Text style={[styles.choiceText, yesterday === y && styles.choiceTextOn]}>{y ? s.chatYesterday : s.chatToday}</Text>
            </Tap>
          ))}
        </View>

        <TextInput
          style={[styles.input, styles.note]}
          value={note}
          onChangeText={setNote}
          placeholder={s.journalNotePlaceholder}
          placeholderTextColor={colors.muted}
          maxLength={300}
          multiline
          accessibilityLabel={s.journalNotePlaceholder}
        />

        <Tap style={[styles.save, !symptom && styles.saveOff]} onPress={() => void save()} disabled={!symptom || busy} accessibilityRole="button" accessibilityState={{ disabled: !symptom, busy }}>
          <SwapIcon id={busy ? "busy" : "save"}>
            <Ionicons name={busy ? "hourglass-outline" : "checkmark-circle-outline"} size={20} color={symptom ? colors.onPrimary : colors.muted} />
          </SwapIcon>
          <Text style={[styles.saveText, !symptom && styles.saveTextOff]}>{symptom ? s.logSave.replace("{what}", symptom) : s.logPickFirst}</Text>
        </Tap>
        {saved && (
          <Enter style={styles.saved} from={6}>
            <Ionicons name="checkmark-circle" size={20} color={colors.primary} />
            <Text style={[styles.savedText, styles.flex]}>{s.logSaved.replace("{what}", saved)}</Text>
          </Enter>
        )}
        {error && <Text style={styles.error}>{error}</Text>}
      </View>

      {recent.length > 0 && (
        <>
          <Text style={styles.section}>{s.journalRecent}</Text>
          <View style={styles.list}>
            {recent.map((e) => (
              <View key={e._id} style={styles.entry}>
                <View style={[styles.badge, { backgroundColor: e.severity === null ? colors.border : severityColor(e.severity) }]}>
                  <Text style={[styles.badgeText, { color: e.severity === null ? colors.muted : inkOn(severityColor(e.severity)) }]}>{e.severity ?? "–"}</Text>
                </View>
                <View style={styles.flex}>
                  <Text style={styles.entryName}>{cap(e.symptom)}</Text>
                  <Text style={styles.small}>
                    {dayName(e.date, s)}
                    {e.severity !== null ? ` · ${s.logLevels[levelOf(e.severity)]}` : ""}
                  </Text>
                  {!!e.note && <Text style={styles.entryNote}>{e.note}</Text>}
                </View>
                <Tap style={styles.trash} onPress={() => void remove({ id: e._id })} accessibilityRole="button" accessibilityLabel={`${s.remove}: ${e.symptom}, ${dayName(e.date, s)}`}>
                  <Ionicons name="trash-outline" size={20} color={colors.muted} />
                </Tap>
              </View>
            ))}
          </View>
        </>
      )}
    </>
  );
}

const styles = themed(() => ({
  card: { ...ui.card, padding: 16, gap: 10 },
  head: { flexDirection: "row", alignItems: "center", gap: 10 },
  headIcon: { width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center", backgroundColor: colors.primarySoft },
  title: { fontSize: 18, fontWeight: "700", color: colors.text },
  question: { fontSize: 16, fontWeight: "600", color: colors.text, marginTop: 6 },
  choices: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  choice: { flexDirection: "row", alignItems: "center", gap: 6, minHeight: 48, paddingHorizontal: 16, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.inputBorder, backgroundColor: colors.surface },
  choiceOn: { borderColor: colors.primary, borderWidth: 2, backgroundColor: colors.primarySoft, paddingHorizontal: 15 },
  choiceText: { fontSize: 16, color: colors.text },
  choiceTextOn: { color: colors.primary, fontWeight: "700" },
  input: { minHeight: TOUCH + 4, borderWidth: 1, borderColor: colors.inputBorder, borderRadius: radius.md, paddingHorizontal: 14, paddingVertical: 10, fontSize: 16, color: colors.text, backgroundColor: colors.surface, marginTop: 2 },
  note: { minHeight: 72, textAlignVertical: "top" },
  // Eleven steps that share the row, each outlined in its colour and filled when chosen.
  scale: { flexDirection: "row", gap: 4 },
  step: { flex: 1, minWidth: 0, height: 52, borderRadius: radius.sm, borderWidth: 2, alignItems: "center", justifyContent: "center", backgroundColor: colors.surface },
  stepText: { fontSize: 16, fontWeight: "700", color: colors.text },
  ends: { flexDirection: "row", justifyContent: "space-between" },
  levelRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  levelDot: { width: 12, height: 12, borderRadius: 6 },
  level: { fontSize: 16, fontWeight: "700", color: colors.text },
  small: { fontSize: 13, color: colors.muted },
  save: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, minHeight: 52, borderRadius: radius.md, backgroundColor: colors.primary, paddingHorizontal: 16, marginTop: 6 },
  saveOff: { backgroundColor: colors.border },
  saveText: { color: colors.onPrimary, fontSize: 16, fontWeight: "700", flexShrink: 1 },
  saveTextOff: { color: colors.muted },
  saved: { flexDirection: "row", alignItems: "center", gap: 8, padding: 10, borderRadius: radius.md, backgroundColor: colors.primarySoft },
  savedText: { fontSize: 15, color: colors.text },
  flex: { flex: 1, minWidth: 0 },
  error: { color: colors.danger, fontSize: 14 },
  section: { ...ui.section },
  list: { gap: 8 },
  entry: { ...ui.card, flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 10, paddingLeft: 12, paddingRight: 4 },
  badge: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  badgeText: { fontSize: 16, fontWeight: "800", color: colors.text },
  entryName: { fontSize: 16, fontWeight: "600", color: colors.text },
  entryNote: { fontSize: 14, color: colors.text, marginTop: 2 },
  trash: { width: TOUCH, height: TOUCH, alignItems: "center", justifyContent: "center", borderRadius: TOUCH / 2 },
}));

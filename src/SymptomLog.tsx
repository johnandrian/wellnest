// "Log a symptom" in the Journal (convex/journal.ts), built to be done in a few taps: pick what's bothering you from
// big buttons (your own recent symptoms first, then common ones) or type it, tap how bad it is on the 0-10 scale
// (./SeverityScale.tsx), pick today, yesterday, or any earlier day (with a time if you like), add a note, and save.
// Recent entries list below it; tap one to change it in the same form.
import { useState } from "react";
import { Text, TextInput, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useMutation } from "convex/react";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { Tap } from "./Tap";
import { colors, inkOn, radius, severityColor, themed, TOUCH, ui } from "./theme";
import { errorText, removeWithUndo, showToast, useHidden } from "./feedback";
import type { Strings } from "./i18n";
import { Enter, Reveal, SwapIcon } from "./Motion";
import { localDate } from "./DailyCard";
import { DateField, TimeField } from "./DateTimeField";
import { formatDate, formatTime } from "./format";
import { levelOf, SeverityScale } from "./SeverityScale";

export { levelOf } from "./SeverityScale";

const MAX_CHOICES = 10;
const cap = (x: string) => x.charAt(0).toUpperCase() + x.slice(1);

function yesterday() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return localDate(d);
}

function dayName(date: string, s: Strings) {
  if (date === localDate()) return s.chatToday;
  if (date === yesterday()) return s.chatYesterday;
  return formatDate(date, s, { weekday: "short", month: "short", day: "numeric" });
}

// "14:30" as the app's language writes a time.
const timeText = (hhmm: string, s: Strings) => {
  const [h, m] = hhmm.split(":").map(Number);
  const d = new Date();
  d.setHours(h, m, 0, 0);
  return formatTime(d.getTime(), s);
};

type Entry = { _id: Id<"symptomEntries">; date: string; symptom: string; severity: number | null; note: string | null; time?: string | null };

export function SymptomLog({ s, mine, recent }: { s: Strings; mine: string[]; recent: Entry[] }) {
  const add = useMutation(api.journal.add);
  const update = useMutation(api.journal.update);
  const remove = useMutation(api.journal.remove);
  const [editing, setEditing] = useState<Entry | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const [typing, setTyping] = useState(false);
  const [other, setOther] = useState("");
  const [severity, setSeverity] = useState<number | null>(null);
  const [date, setDate] = useState(localDate);
  const [pickDay, setPickDay] = useState(false);
  const [time, setTime] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isHidden = useHidden();
  const shown = recent.filter((e) => !isHidden(e._id));

  // Their own symptoms first, then common ones, without repeats.
  const seen = new Set<string>();
  const choices = [...mine.map(cap), ...s.logCommon].filter((x) => {
    const k = x.toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  }).slice(0, MAX_CHOICES);

  const symptom = (typing ? other : picked ?? "").trim();
  const today = localDate();
  const when = date === today ? "today" : date === yesterday() && !pickDay ? "yesterday" : "other";

  const clear = () => {
    setEditing(null);
    setPicked(null);
    setTyping(false);
    setOther("");
    setSeverity(null);
    setNote("");
    setDate(localDate());
    setPickDay(false);
    setTime(null);
  };

  const pick = (x: string) => {
    setTyping(false);
    setPicked(picked === x ? null : x);
  };

  // An entry goes back into the form to be changed.
  const startEdit = (e: Entry) => {
    const name = cap(e.symptom);
    const inChoices = choices.some((c) => c.toLowerCase() === e.symptom);
    setEditing(e);
    setPicked(inChoices ? choices.find((c) => c.toLowerCase() === e.symptom)! : null);
    setTyping(!inChoices);
    setOther(inChoices ? "" : name);
    setSeverity(e.severity);
    setNote(e.note ?? "");
    setDate(e.date);
    setPickDay(e.date !== today && e.date !== yesterday());
    setTime(e.time ?? null);
    setError(null);
  };

  const save = async () => {
    if (!symptom || busy) return;
    setBusy(true);
    setError(null);
    try {
      if (editing) {
        await update({ id: editing._id, symptom, severity, note: note.trim(), date, time: time ?? "" });
        showToast(`${s.saved}: ${symptom}`);
      } else {
        await add({ symptom, severity: severity ?? undefined, note: note.trim() || undefined, date, ...(time && { time }) });
        showToast(s.logSaved.replace("{what}", severity === null ? symptom : `${symptom} · ${s.logOutOf.replace("{n}", String(severity))}`));
      }
      clear();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <View style={styles.card}>
        <View style={styles.head}>
          <View style={styles.headIcon}>
            <SwapIcon id={editing ? "edit" : "add"}>
              <Ionicons name={editing ? "create-outline" : "add"} size={20} color={colors.primary} />
            </SwapIcon>
          </View>
          <Text style={[styles.title, styles.flex]} accessibilityRole="header">
            {editing ? s.logEditTitle : s.journalAdd}
          </Text>
          {editing && (
            <Tap style={styles.cancel} onPress={clear} accessibilityRole="button">
              <Text style={styles.link}>{s.cancel}</Text>
            </Tap>
          )}
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
          <Tap style={[styles.choice, typing && styles.choiceOn]} onPress={() => setTyping(!typing)} accessibilityRole="radio" accessibilityState={{ selected: typing }}>
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
            autoFocus={!editing}
            accessibilityLabel={s.logOther}
            returnKeyType="done"
          />
        </Reveal>

        <Text style={styles.question}>{s.logHowBad}</Text>
        <SeverityScale value={severity} onChange={setSeverity} label={s.logHowBad} s={s} />

        <Text style={styles.question}>{s.logWhen}</Text>
        <View style={styles.choices}>
          {(["today", "yesterday", "other"] as const).map((w) => (
            <Tap
              key={w}
              style={[styles.choice, when === w && styles.choiceOn]}
              onPress={() => {
                setPickDay(w === "other");
                if (w === "today") setDate(today);
                if (w === "yesterday") setDate(yesterday());
              }}
              accessibilityRole="radio"
              accessibilityState={{ selected: when === w }}
            >
              {w === "other" && <Ionicons name="calendar-outline" size={18} color={when === w ? colors.primary : colors.text} />}
              <Text style={[styles.choiceText, when === w && styles.choiceTextOn]}>
                {w === "today" ? s.chatToday
                : w === "yesterday" ? s.chatYesterday
                : s.logOtherDay}
              </Text>
            </Tap>
          ))}
        </View>
        <Reveal open={when === "other"}>
          <View style={styles.inline}>
            <DateField value={date} onChange={(d) => setDate(d > today ? today : d)} label={s.logOtherDay} s={s} />
          </View>
        </Reveal>
        {time === null ? (
          <Tap style={styles.addTime} onPress={() => setTime(`${String(new Date().getHours()).padStart(2, "0")}:00`)} accessibilityRole="button">
            <Ionicons name="time-outline" size={18} color={colors.primary} />
            <Text style={styles.link}>{s.logAddTime}</Text>
          </Tap>
        ) : (
          <View style={styles.inline}>
            <TimeField value={time} onChange={setTime} label={s.timeLabel} s={s} />
            <Tap style={styles.iconButton} onPress={() => setTime(null)} accessibilityRole="button" accessibilityLabel={s.logNoTime}>
              <Ionicons name="close" size={20} color={colors.muted} />
            </Tap>
          </View>
        )}

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
          <Text style={[styles.saveText, !symptom && styles.saveTextOff]}>
            {!symptom ? s.logPickFirst
            : editing ? s.logSaveChanges
            : s.logSave.replace("{what}", symptom)}
          </Text>
        </Tap>
        {error && <Text style={styles.error}>{error}</Text>}
      </View>

      {shown.length > 0 && (
        <>
          <Text style={styles.section}>{s.journalRecent}</Text>
          <View style={styles.list}>
            {shown.map((e) => (
              <View key={e._id} style={[styles.entry, editing?._id === e._id && styles.entryOn]}>
                <Tap style={styles.entryMain} onPress={() => startEdit(e)} accessibilityRole="button" accessibilityLabel={`${s.edit}: ${e.symptom}, ${dayName(e.date, s)}`}>
                  <View style={[styles.badge, { backgroundColor: e.severity === null ? colors.border : severityColor(e.severity) }]}>
                    <Text style={[styles.badgeText, { color: e.severity === null ? colors.muted : inkOn(severityColor(e.severity)) }]}>{e.severity ?? "–"}</Text>
                  </View>
                  <View style={styles.flex}>
                    <Text style={styles.entryName}>{cap(e.symptom)}</Text>
                    <Text style={styles.small}>
                      {dayName(e.date, s)}
                      {e.time ? ` ${timeText(e.time, s)}` : ""}
                      {e.severity !== null ? ` · ${s.logLevels[levelOf(e.severity)]}` : ""}
                    </Text>
                    {!!e.note && <Text style={styles.entryNote}>{e.note}</Text>}
                  </View>
                </Tap>
                <Tap
                  style={styles.iconButton}
                  onPress={() => {
                    if (editing?._id === e._id) clear();
                    removeWithUndo({ key: e._id, text: `${s.removed}: ${cap(e.symptom)}`, run: () => remove({ id: e._id }), onError: (err) => setError(errorText(err)) });
                  }}
                  accessibilityRole="button"
                  accessibilityLabel={`${s.remove}: ${e.symptom}, ${dayName(e.date, s)}`}
                >
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
  headIcon: { width: 34, height: 34, borderRadius: 26, alignItems: "center", justifyContent: "center", backgroundColor: colors.primarySoft },
  title: { fontSize: 18, fontWeight: "700", color: colors.text },
  cancel: { minHeight: TOUCH, justifyContent: "center", paddingHorizontal: 8 },
  question: { fontSize: 16, fontWeight: "600", color: colors.text, marginTop: 6 },
  choices: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  choice: { flexDirection: "row", alignItems: "center", gap: 6, minHeight: 48, paddingHorizontal: 16, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.inputBorder, backgroundColor: colors.surface },
  choiceOn: { borderColor: colors.primary, borderWidth: 2, backgroundColor: colors.primarySoft, paddingHorizontal: 15 },
  choiceText: { fontSize: 16, color: colors.text },
  choiceTextOn: { color: colors.primary, fontWeight: "700" },
  input: { minHeight: TOUCH + 4, borderWidth: 1, borderColor: colors.inputBorder, borderRadius: radius.md, paddingHorizontal: 14, paddingVertical: 10, fontSize: 16, color: colors.text, backgroundColor: colors.surface, marginTop: 2 },
  note: { minHeight: 72, textAlignVertical: "top" },
  inline: { flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" },
  addTime: { flexDirection: "row", alignItems: "center", gap: 6, minHeight: TOUCH, alignSelf: "flex-start" },
  link: { color: colors.primary, fontWeight: "600", fontSize: 15 },
  small: { fontSize: 13, color: colors.muted },
  save: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, minHeight: 52, borderRadius: radius.pill, backgroundColor: colors.primary, paddingHorizontal: 16, marginTop: 6 },
  saveOff: { backgroundColor: colors.border },
  saveText: { color: colors.onPrimary, fontSize: 16, fontWeight: "700", flexShrink: 1 },
  saveTextOff: { color: colors.muted },
  flex: { flex: 1, minWidth: 0 },
  error: { color: colors.danger, fontSize: 14 },
  section: { ...ui.section },
  list: { gap: 8 },
  entry: { ...ui.card, flexDirection: "row", alignItems: "center", gap: 4, paddingVertical: 6, paddingLeft: 12, paddingRight: 4 },
  entryOn: { borderColor: colors.primary },
  entryMain: { flex: 1, flexDirection: "row", alignItems: "center", gap: 12, minHeight: TOUCH, paddingVertical: 4 },
  badge: { width: 40, height: 40, borderRadius: 30, alignItems: "center", justifyContent: "center" },
  badgeText: { fontSize: 16, fontWeight: "800", color: colors.text },
  entryName: { fontSize: 16, fontWeight: "600", color: colors.text },
  entryNote: { fontSize: 14, color: colors.text, marginTop: 2 },
  iconButton: { width: TOUCH, height: TOUCH, alignItems: "center", justifyContent: "center", borderRadius: TOUCH / 2 },
}));

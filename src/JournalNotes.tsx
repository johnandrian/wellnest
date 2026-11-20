// "Write about today" on the Journal's Log tab (convex/journal.ts addNote): a note in your own words, kept with the time
// it was written. A moment later Wellnest picks out any symptoms in it and logs them (shown under the note), as the
// chat would. Works offline: the note is sent when the connection is back (./offline.tsx).
import { useState } from "react";
import { ActivityIndicator, Text, TextInput, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useMutation, useQuery } from "convex/react";
import { api } from "../convex/_generated/api";
import { Tap } from "./Tap";
import { Icon } from "./Icon";
import { colors, radius, themed, TOUCH, ui } from "./theme";
import type { Strings } from "./i18n";
import { errorText, removeWithUndo, showToast, useHidden } from "./feedback";
import { formatDate, formatTime } from "./format";
import { useOfflineSend } from "./offline";
import { Enter } from "./Motion";

export function JournalNotes({ s, since, today }: { s: Strings; since: string; today: string }) {
  const notes = useQuery(api.journal.notes, { since });
  const send = useOfflineSend();
  const remove = useMutation(api.journal.removeNote);
  const isHidden = useHidden();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    if (!text.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const r = await send({ fn: "journal.addNote", args: { text: text.trim() } });
      setText("");
      showToast(r === "queued" ? s.noteQueued : s.noteSaved);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const shown = (notes ?? []).filter((n) => !isHidden(n._id));
  return (
    <View style={styles.card}>
      <View style={styles.head}>
        <Icon name="journalLog" size={18} color={colors.primary} />
        <Text style={styles.title} accessibilityRole="header">
          {s.noteTitle}
        </Text>
      </View>
      <TextInput
        style={styles.input}
        value={text}
        onChangeText={setText}
        placeholder={s.notePlaceholder}
        placeholderTextColor={colors.muted}
        accessibilityLabel={s.noteTitle}
        multiline
        maxLength={2000}
      />
      <Text style={styles.small}>{s.noteHint}</Text>
      <Tap style={[ui.button, styles.save, !text.trim() && styles.off]} onPress={() => void save()} disabled={busy || !text.trim()} accessibilityRole="button" accessibilityState={{ busy }}>
        {busy ? <ActivityIndicator color={colors.onPrimary} /> : <Text style={styles.saveText}>{s.noteSave}</Text>}
      </Tap>
      {error && <Text style={styles.error}>{error}</Text>}
      {shown.map((n) => (
        <Enter key={n._id} style={styles.note} from={6}>
          <View style={styles.noteHead}>
            <Text style={styles.when}>
              {n.date === today ? formatTime(n.at, s) : `${formatDate(n.date, s, { weekday: "short", month: "short", day: "numeric" })}, ${formatTime(n.at, s)}`}
            </Text>
            <Tap
              style={styles.remove}
              onPress={() => removeWithUndo({ key: n._id, text: s.noteRemoved, run: () => remove({ id: n._id }), onError: (e) => setError(errorText(e)) })}
              accessibilityRole="button"
              accessibilityLabel={`${s.remove}: ${n.text.slice(0, 40)}`}
            >
              <Ionicons name="close" size={16} color={colors.muted} />
            </Tap>
          </View>
          <Text style={styles.text}>{n.text}</Text>
          {n.logged === null ? (
            <Text style={styles.small}>{s.noteLooking}</Text>
          ) : n.logged.length ? (
            <View style={styles.logged}>
              <Icon name="symptoms" size={14} color={colors.primary} />
              <Text style={styles.loggedText}>
                {s.noteLogged} {n.logged.map((x) => (x.severity !== undefined ? `${x.symptom} ${x.severity}/10` : x.symptom)).join(", ")}
              </Text>
            </View>
          ) : null}
        </Enter>
      ))}
    </View>
  );
}

const styles = themed(() => ({
  card: { ...ui.card, padding: 14, gap: 10 },
  head: { flexDirection: "row", alignItems: "center", gap: 8 },
  title: { fontSize: 16, fontWeight: "700", color: colors.text },
  input: { minHeight: 96, color: colors.text, fontSize: 15, lineHeight: 21, borderWidth: 1, borderColor: colors.inputBorder, backgroundColor: colors.surface, borderRadius: radius.sm, padding: 12, textAlignVertical: "top" },
  small: { color: colors.muted, fontSize: 13 },
  save: { alignSelf: "flex-start" },
  off: { opacity: 0.5 },
  saveText: { color: colors.onPrimary, fontWeight: "700", fontSize: 15 },
  error: { color: colors.danger, fontSize: 14 },
  note: { gap: 4, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 10 },
  noteHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  when: { color: colors.muted, fontSize: 13, fontWeight: "600" },
  remove: { width: TOUCH - 8, height: TOUCH - 8, alignItems: "center", justifyContent: "center" },
  text: { color: colors.text, fontSize: 15, lineHeight: 21 },
  logged: { flexDirection: "row", alignItems: "center", gap: 6, alignSelf: "flex-start", paddingHorizontal: 10, paddingVertical: 4, borderRadius: radius.pill, backgroundColor: colors.primarySoft },
  loggedText: { color: colors.primary, fontSize: 13, fontWeight: "600" },
}));

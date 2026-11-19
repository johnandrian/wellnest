// Today's doses (convex/reminders.ts `today`), on the Medications tab and the dashboard: each due dose with Taken and
// Skip (Taken late once it's more than an hour past due, Snooze before it's answered), and each as-needed medication
// with "Took one" and what was taken today. Answers can be changed; an as-needed dose can be removed with Undo.
import { useState } from "react";
import { ActivityIndicator, Text, View } from "react-native";
import { useMutation, useQuery } from "convex/react";
import { Ionicons } from "@expo/vector-icons";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { Tap } from "./Tap";
import { Enter } from "./Motion";
import { Icon } from "./Icon";
import { colors, radius, themed, tint, TOUCH, ui } from "./theme";
import type { Strings } from "./i18n";
import { errorText, removeWithUndo, showToast, useHidden } from "./feedback";
import { formatTime } from "./format";
import { dayBounds } from "./medSchedule";
import { useOfflineSend } from "./offline";

const LATE_MS = 60 * 60_000;

export function TodayDoses({ s, compact }: { s: Strings; compact?: boolean }) {
  // The day is fixed when the card mounts; reopening the tab tomorrow shows tomorrow.
  const [{ from, to }] = useState(() => dayBounds());
  const today = useQuery(api.reminders.today, { from, to });
  // Taken, Skip, and Took one still work offline (./offline.tsx).
  const send = useOfflineSend();
  const snooze = useMutation(api.reminders.snooze);
  const unmark = useMutation(api.reminders.unmark);
  const isHidden = useHidden();
  const [error, setError] = useState<string | null>(null);
  const now = Date.now();

  if (today === undefined) return <ActivityIndicator color={colors.primary} />;
  if (!today || (!today.doses.length && !today.asNeeded.length)) return compact ? null : <Text style={styles.empty}>{s.todayNone}</Text>;

  const run = (fn: () => Promise<unknown>, done?: string) => {
    setError(null);
    fn().then(
      (r) => done && r !== "queued" && showToast(done),
      (e) => setError(errorText(e)),
    );
  };
  const taken = today.doses.filter((d) => d.status === "taken").length;

  return (
    <Enter style={styles.card}>
      <View style={styles.head}>
        <View style={styles.icon}>
          <Icon name="doses" size={18} color={tint.medications.fg} />
        </View>
        <Text style={styles.title} accessibilityRole="header">
          {s.todayDoses}
        </Text>
        {today.doses.length > 0 && <Text style={styles.count}>{s.homeDosesOf.replace("{a}", String(taken)).replace("{b}", String(today.doses.length))}</Text>}
      </View>
      {today.doses.map((d) => {
        const late = d.status === null && now - d.dueAt > LATE_MS;
        const wasLate = d.status === "taken" && d.takenAt !== null && d.takenAt - d.dueAt > LATE_MS;
        const answer =
          d.status === "taken"
            ? (wasLate ? s.takenLateAt : s.takenAt).replace("{time}", formatTime(d.takenAt ?? d.dueAt, s))
            : d.status === "skipped"
              ? s.skippedLabel
              : null;
        return (
          <View key={`${d.medicationId}-${d.dueAt}`} style={styles.row}>
            <View style={styles.flex}>
              <Text style={[styles.name, d.status && styles.done]}>
                {formatTime(d.dueAt, s)} · {d.name}
                {d.dose ? ` ${d.dose}` : ""}
              </Text>
              {answer ? (
                <Text style={styles.answer}>{answer}</Text>
              ) : late ? (
                <Text style={styles.late}>{s.doseOverdue}</Text>
              ) : null}
            </View>
            <View style={styles.buttons}>
              <Tap
                style={[styles.button, d.status === "taken" && styles.buttonOn]}
                onPress={() => run(() => send({ fn: "reminders.mark", args: { medicationId: d.medicationId, dueAt: d.dueAt, status: "taken" } }))}
                accessibilityRole="button"
                accessibilityState={{ selected: d.status === "taken" }}
                accessibilityLabel={`${late ? s.takenLate : s.taken}: ${d.name}`}
              >
                <Ionicons name="checkmark" size={15} color={d.status === "taken" ? colors.onPrimary : colors.primary} />
                <Text style={[styles.buttonText, d.status === "taken" && styles.buttonTextOn]}>{late ? s.takenLate : s.taken}</Text>
              </Tap>
              <Tap
                style={[styles.button, d.status === "skipped" && styles.buttonOn]}
                onPress={() => run(() => send({ fn: "reminders.mark", args: { medicationId: d.medicationId, dueAt: d.dueAt, status: "skipped" } }))}
                accessibilityRole="button"
                accessibilityState={{ selected: d.status === "skipped" }}
                accessibilityLabel={`${s.skip}: ${d.name}`}
              >
                <Ionicons name="close" size={15} color={d.status === "skipped" ? colors.onPrimary : colors.primary} />
                <Text style={[styles.buttonText, d.status === "skipped" && styles.buttonTextOn]}>{s.skip}</Text>
              </Tap>
              {d.status === null && d.dueAt <= now && (
                <Tap style={styles.iconButton} onPress={() => run(() => snooze({ medicationId: d.medicationId, dueAt: d.dueAt }), s.snoozed)} accessibilityRole="button" accessibilityLabel={`${s.snooze}: ${d.name}`}>
                  <Ionicons name="alarm-outline" size={18} color={colors.primary} />
                </Tap>
              )}
            </View>
          </View>
        );
      })}
      {today.asNeeded.map((m) => {
        const times = m.taken.filter((at) => !isHidden(`${m.medicationId}-${at}`));
        return (
          <View key={m.medicationId} style={styles.row}>
            <View style={styles.flex}>
              <Text style={styles.name}>
                {m.name}
                {m.dose ? ` ${m.dose}` : ""}
              </Text>
              <Text style={styles.answer}>{s.medAsNeededRule}</Text>
              {times.length > 0 && (
                <View style={styles.chips}>
                  {times.map((at) => (
                    <Tap
                      key={at}
                      style={styles.timeChip}
                      onPress={() => removeWithUndo({ key: `${m.medicationId}-${at}`, text: `${s.removed}: ${m.name} ${formatTime(at, s)}`, run: () => unmark({ medicationId: m.medicationId as Id<"medications">, dueAt: at }), onError: (e) => setError(errorText(e)) })}
                      accessibilityRole="button"
                      accessibilityLabel={`${s.remove}: ${m.name} ${formatTime(at, s)}`}
                    >
                      <Text style={styles.timeChipText}>{formatTime(at, s)}</Text>
                      <Ionicons name="close" size={14} color={colors.muted} />
                    </Tap>
                  ))}
                </View>
              )}
            </View>
            <Tap style={styles.button} onPress={() => run(() => send({ fn: "reminders.takeNow", args: { medicationId: m.medicationId } }), `${s.saved}: ${m.name}`)} accessibilityRole="button" accessibilityLabel={`${s.tookOne}: ${m.name}`}>
              <Ionicons name="add" size={15} color={colors.primary} />
              <Text style={styles.buttonText}>{s.tookOne}</Text>
            </Tap>
          </View>
        );
      })}
      {error && <Text style={styles.error}>{error}</Text>}
    </Enter>
  );
}

const styles = themed(() => ({
  card: { ...ui.card, padding: 14, gap: 10 },
  empty: { ...ui.empty },
  head: { flexDirection: "row", alignItems: "center", gap: 8 },
  icon: { width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center", backgroundColor: tint.medications.bg },
  title: { flex: 1, fontSize: 16, fontWeight: "700", color: colors.text },
  count: { fontSize: 13, fontWeight: "600", color: colors.muted },
  row: { flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap", borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 10 },
  flex: { flex: 1, minWidth: 160, gap: 2 },
  name: { fontSize: 15, fontWeight: "600", color: colors.text },
  done: { color: colors.muted },
  answer: { fontSize: 13, color: colors.muted },
  late: { fontSize: 13, fontWeight: "600", color: colors.warningText },
  buttons: { flexDirection: "row", gap: 6, alignItems: "center" },
  button: { flexDirection: "row", alignItems: "center", gap: 4, minHeight: TOUCH, paddingHorizontal: 12, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.primary, backgroundColor: colors.surface },
  buttonOn: { backgroundColor: colors.primary },
  buttonText: { fontSize: 14, fontWeight: "600", color: colors.primary },
  buttonTextOn: { color: colors.onPrimary },
  iconButton: { width: TOUCH, height: TOUCH, alignItems: "center", justifyContent: "center", borderRadius: TOUCH / 2 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 4 },
  timeChip: { flexDirection: "row", alignItems: "center", gap: 4, minHeight: 32, paddingHorizontal: 10, borderRadius: radius.pill, backgroundColor: colors.primarySoft },
  timeChipText: { fontSize: 13, color: colors.text },
  error: { color: colors.danger, fontSize: 13 },
}));

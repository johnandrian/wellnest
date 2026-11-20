// Today's scheduled doses on the dashboard (convex/reminders.ts `today`) in time blocks, Morning, Midday, and Evening
// (only the ones with a dose in them), each dose one tap to mark taken (and one more to undo). As-needed medications,
// Skip, Snooze, and Taken late are in the Medications tool (./TodayDoses.tsx).
import { useState } from "react";
import { ActivityIndicator, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useMutation, useQuery } from "convex/react";
import { api } from "../convex/_generated/api";
import { Tap } from "./Tap";
import { colors, kicker, radius, themed, tint } from "./theme";
import type { Strings } from "./i18n";
import { errorText, showToast } from "./feedback";
import { formatTime } from "./format";
import { dayBounds } from "./medSchedule";
import { useOfflineSend } from "./offline";

const LATE_MS = 60 * 60_000;
type Block = "morning" | "midday" | "evening";
const BLOCKS: Block[] = ["morning", "midday", "evening"];

// By the dose's own clock time ("08:00"), so it lands in the same block wherever the phone is.
export function blockOf(time: string): Block {
  const h = Number(time.slice(0, 2));
  return h < 11 ? "morning" : h < 17 ? "midday" : "evening";
}

export function DoseBlocks({ s, stacked }: { s: Strings; stacked: boolean }) {
  const [{ from, to }] = useState(() => dayBounds());
  const today = useQuery(api.reminders.today, { from, to });
  const send = useOfflineSend();
  const unmark = useMutation(api.reminders.unmark);
  const [error, setError] = useState<string | null>(null);
  const now = Date.now();
  if (today === undefined) return <ActivityIndicator color={colors.primary} />;
  if (!today || !today.doses.length) return null;

  const run = (fn: () => Promise<unknown>, done?: string) => {
    setError(null);
    fn().then(
      (r) => done && r !== "queued" && showToast(done),
      (e) => setError(errorText(e)),
    );
  };
  const label = { morning: s.homeMorning, midday: s.homeMidday, evening: s.homeEvening };

  return (
    <View style={styles.wrap}>
      {!!today.doses.length && (
        <View style={[styles.blocks, stacked && styles.blocksStacked]}>
          {BLOCKS.filter((b) => today.doses.some((d) => blockOf(d.time) === b)).map((b) => {
            const doses = today.doses.filter((d) => blockOf(d.time) === b);
            return (
              <View key={b} style={[styles.block, stacked && styles.blockStacked]}>
                <Text style={styles.blockTitle}>{label[b]}</Text>
                {doses.map((d) => {
                    const taken = d.status === "taken";
                    const late = d.status === null && now - d.dueAt > LATE_MS;
                    return (
                      <Tap
                        key={`${d.medicationId}-${d.dueAt}`}
                        style={[styles.dose, taken && styles.doseOn, late && styles.doseLate]}
                        onPress={() =>
                          taken
                            ? run(() => unmark({ medicationId: d.medicationId, dueAt: d.dueAt }))
                            : run(() => send({ fn: "reminders.mark", args: { medicationId: d.medicationId, dueAt: d.dueAt, status: "taken" } }))
                        }
                        accessibilityRole="checkbox"
                        accessibilityState={{ checked: taken }}
                        accessibilityLabel={`${formatTime(d.dueAt, s)} ${d.name}${late ? `, ${s.doseOverdue}` : ""}${d.status === "skipped" ? `, ${s.skippedLabel}` : ""}`}
                      >
                        <View style={[styles.check, taken && styles.checkOn]}>{taken && <Ionicons name="checkmark" size={13} color={colors.onPrimary} />}</View>
                        <View style={styles.flex}>
                          <Text style={[styles.name, d.status === "skipped" && styles.skipped]} numberOfLines={1}>
                            {d.name}
                          </Text>
                          <Text style={[styles.time, late && styles.late]} numberOfLines={1}>
                            {formatTime(d.dueAt, s)}
                            {d.dose ? ` · ${d.dose}` : ""}
                          </Text>
                        </View>
                      </Tap>
                    );
                  })}
              </View>
            );
          })}
        </View>
      )}
      {error && <Text style={styles.error}>{error}</Text>}
    </View>
  );
}

const styles = themed(() => ({
  wrap: { gap: 12 },
  blocks: { flexDirection: "row", gap: 10 },
  blocksStacked: { flexDirection: "column" },
  block: { flex: 1, minWidth: 0, gap: 6, padding: 10, borderRadius: radius.sm, backgroundColor: colors.bg },
  blockStacked: { flexGrow: 0, flexShrink: 0, flexBasis: "auto" },
  blockTitle: { color: colors.muted, fontWeight: "700", ...kicker() },
  dose: { flexDirection: "row", alignItems: "center", gap: 8, minHeight: 44, paddingHorizontal: 8, borderRadius: radius.sm, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.hairline },
  doseOn: { borderColor: tint.medications.bg },
  doseLate: { borderColor: colors.amber },
  check: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: colors.inputBorder, alignItems: "center", justifyContent: "center" },
  checkOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  flex: { flex: 1, minWidth: 0 },
  name: { color: colors.text, fontSize: 14, fontWeight: "600" },
  skipped: { color: colors.muted, textDecorationLine: "line-through" },
  time: { color: colors.muted, fontSize: 12 },
  late: { color: colors.warningText, fontWeight: "600" },
  error: { color: colors.danger, fontSize: 13 },
}));

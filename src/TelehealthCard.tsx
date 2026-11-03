// Telehealth video visits (convex/telehealth.ts). AppointmentCard sits under the chat message that offers times;
// TelehealthCard is the Care tab's view of the current visit, with a way to ask for one.
import { useState } from "react";
import { ActivityIndicator, Alert, Linking, Platform, Text, TextInput, View } from "react-native";
import { Tap } from "./Tap";
import { useMutation, useQuery } from "convex/react";
import { Ionicons } from "@expo/vector-icons";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { colors, ui, TOUCH, themed } from "./theme";
import type { Strings } from "./i18n";

type Visit = NonNullable<(typeof api.telehealth.get)["_returnType"]>;

const timeOf = (ms: number) =>
  new Date(ms).toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" });

function ask(title: string, message: string, ok: string, cancel: string): Promise<boolean> {
  if (Platform.OS === "web") return Promise.resolve(window.confirm(`${title}\n\n${message}`));
  return new Promise((resolve) =>
    Alert.alert(title, message, [
      { text: cancel, style: "cancel", onPress: () => resolve(false) },
      { text: ok, onPress: () => resolve(true) },
    ]),
  );
}

const cleanError = (e: unknown) => (e as Error).message.replace(/^.*Uncaught Error: /, "").split("\n")[0];

function VisitBody({ visit, s }: { visit: Visit; s: Strings }) {
  const confirm = useMutation(api.telehealth.confirm);
  const cancel = useMutation(api.telehealth.cancel);
  const [error, setError] = useState<string | null>(null);

  const pick = async (slot: Visit["slots"][number]) => {
    const message = s.visitConfirmBody
      .replace("{who}", slot.clinician)
      .replace("{time}", timeOf(slot.startsAt))
      .replace("{provider}", visit.providerName ?? "");
    if (!(await ask(s.visitConfirmTitle, message, s.visitBook, s.cancel))) return;
    setError(null);
    await confirm({ id: visit._id, slotId: slot.id }).catch((e) => setError(cleanError(e)));
  };

  const stop = async () => {
    if (visit.status === "booked" && !(await ask(s.visitCancelTitle, s.visitCancelBody, s.visitCancelYes, s.visitKeep))) return;
    setError(null);
    await cancel({ id: visit._id }).catch((e) => setError(cleanError(e)));
  };

  const booked = visit.slots.find((x) => x.id === visit.slotId);
  return (
    <View style={styles.body}>
      {visit.testProvider && <Text style={styles.test}>{s.visitTestProvider}</Text>}
      {(visit.status === "finding" || visit.status === "booking" || visit.status === "cancelling") && (
        <View style={styles.row}>
          <ActivityIndicator color={colors.primary} />
          <Text style={styles.muted}>{visit.status === "finding" ? s.visitFinding : visit.status === "booking" ? s.visitBooking : s.visitCancelling}</Text>
        </View>
      )}
      {visit.status === "suggested" && (
        <>
          {visit.slots.map((slot) => (
            <Tap key={slot.id} style={styles.slot} onPress={() => void pick(slot)} accessibilityRole="button">
              <Ionicons name="videocam-outline" size={18} color={colors.primary} />
              <Text style={styles.slotText}>
                {timeOf(slot.startsAt)} · {slot.clinician}
              </Text>
            </Tap>
          ))}
          <Tap onPress={() => void stop()} accessibilityRole="button">
            <Text style={styles.link}>{s.visitNotNow}</Text>
          </Tap>
        </>
      )}
      {visit.status === "booked" && (
        <>
          <Text style={styles.line}>
            ✅ {s.visitBookedLine.replace("{who}", booked?.clinician ?? "").replace("{time}", visit.startsAt ? timeOf(visit.startsAt) : "")}
          </Text>
          <View style={styles.row}>
            {visit.joinUrl && (
              <Tap style={styles.button} onPress={() => void Linking.openURL(visit.joinUrl!)} accessibilityRole="link">
                <Ionicons name="videocam" size={16} color={colors.onPrimary} />
                <Text style={styles.buttonText}>{s.visitJoin}</Text>
              </Tap>
            )}
            <Tap onPress={() => void stop()} accessibilityRole="button">
              <Text style={[styles.link, styles.danger]}>{s.visitCancelYes}</Text>
            </Tap>
          </View>
        </>
      )}
      {visit.status === "expired" && <Text style={styles.muted}>{s.visitExpired}</Text>}
      {visit.status === "dismissed" && <Text style={styles.muted}>{s.visitDismissed}</Text>}
      {visit.status === "cancelled" && <Text style={styles.muted}>{s.visitCancelledLine}</Text>}
      {visit.status === "failed" && <Text style={styles.error}>{s.visitFailedLine}</Text>}
      {error && <Text style={styles.error}>{error}</Text>}
    </View>
  );
}

export function AppointmentCard({ id, s }: { id: Id<"appointments">; s: Strings }) {
  const visit = useQuery(api.telehealth.get, { id });
  if (!visit) return null;
  return <VisitBody visit={visit} s={s} />;
}

export function TelehealthCard({ s }: { s: Strings }) {
  const visit = useQuery(api.telehealth.current);
  const request = useMutation(api.telehealth.request);
  const [asking, setAsking] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  // A visit that ended over an hour ago isn't "current" any more.
  const live = visit && !(visit.status === "booked" && visit.startsAt && visit.startsAt < Date.now() - 60 * 60_000) ? visit : null;

  const submit = async () => {
    setError(null);
    try {
      await request({ reason: reason || s.visitDefaultReason, urgency: "today" });
      setAsking(false);
      setReason("");
    } catch (e) {
      setError(cleanError(e));
    }
  };

  return (
    <View style={styles.card}>
      <View style={styles.row}>
        <Ionicons name="videocam-outline" size={20} color={colors.primary} />
        <Text style={styles.title}>{s.visitTitle}</Text>
      </View>
      {live ? (
        <VisitBody visit={live} s={s} />
      ) : asking ? (
        <View style={styles.body}>
          <TextInput
            style={styles.input}
            placeholder={s.visitReasonPlaceholder}
            placeholderTextColor={colors.muted}
            value={reason}
            onChangeText={setReason}
            maxLength={300}
          />
          <View style={styles.row}>
            <Tap style={styles.button} onPress={() => void submit()} accessibilityRole="button">
              <Text style={styles.buttonText}>{s.visitFindTimes}</Text>
            </Tap>
            <Tap onPress={() => setAsking(false)} accessibilityRole="button">
              <Text style={styles.link}>{s.cancel}</Text>
            </Tap>
          </View>
        </View>
      ) : (
        <>
          <Text style={styles.muted}>{s.visitIntro}</Text>
          <Tap onPress={() => setAsking(true)} accessibilityRole="button">
            <Text style={styles.link}>{s.visitRequest}</Text>
          </Tap>
        </>
      )}
      {error && <Text style={styles.error}>{error}</Text>}
    </View>
  );
}

const styles = themed(() => ({
  card: { ...ui.card, padding: 12, gap: 8 },
  title: { fontSize: 15, fontWeight: "700", color: colors.text },
  body: { gap: 8, marginTop: 6 },
  row: { flexDirection: "row", alignItems: "center", gap: 10, flexWrap: "wrap" },
  muted: { color: colors.muted, fontSize: 14, lineHeight: 19, flexShrink: 1 },
  line: { color: colors.text, fontSize: 14 },
  test: { color: colors.warningText, backgroundColor: colors.warningSoft, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 4, fontSize: 12, alignSelf: "flex-start" },
  slot: { flexDirection: "row", alignItems: "center", gap: 8, borderWidth: 1, borderColor: colors.primary, borderRadius: 10, paddingVertical: 8, paddingHorizontal: 10, backgroundColor: colors.surface },
  slotText: { color: colors.primary, fontWeight: "600", flexShrink: 1 },
  input: { color: colors.text, borderWidth: 1, borderColor: colors.inputBorder, backgroundColor: colors.surface, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8, fontSize: 15, minWidth: 0 },
  button: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: colors.primary, borderRadius: 10, paddingVertical: 9, paddingHorizontal: 14, minHeight: TOUCH, justifyContent: "center" },
  buttonText: { color: colors.onPrimary, fontWeight: "600", fontSize: 14 },
  link: { color: colors.primary, fontWeight: "600", fontSize: 14 },
  danger: { color: colors.danger },
  error: { color: colors.danger, fontSize: 13 },
}));

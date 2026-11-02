// Appointments and care team (convex/visits.ts): upcoming and past visits with questions to ask beforehand and
// notes afterwards, a shortcut to a visit summary for each, and the people in your care with tap-to-call.
import { useMemo, useState } from "react";
import { Alert, Linking, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useMutation, useQuery } from "convex/react";
import { Ionicons } from "@expo/vector-icons";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { colors } from "./theme";
import type { Strings } from "./i18n";
import { localDate } from "./DailyCard";

type Kind = "in_person" | "video" | "phone";
type Item = NonNullable<(typeof api.visits.list)["_returnType"]>["upcoming"][number];
const KIND_ICON: Record<Kind, keyof typeof Ionicons.glyphMap> = { in_person: "business-outline", video: "videocam-outline", phone: "call-outline" };
const cleanError = (e: unknown) => (e as Error).message.replace(/^.*Uncaught Error: /, "").split("\n")[0];

const whenText = (ms: number) => new Date(ms).toLocaleString([], { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

// A local date + time typed in the app, as a timestamp.
function toMs(date: string, time: string) {
  const m = date.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const t = time.match(/^(\d{1,2}):(\d{2})$/);
  if (!m || !t) return NaN;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(t[1]), Number(t[2])).getTime();
}

function confirm(title: string, ok: string, cancel: string): Promise<boolean> {
  if (Platform.OS === "web") return Promise.resolve(window.confirm(title));
  return new Promise((resolve) =>
    Alert.alert(title, undefined, [
      { text: cancel, style: "cancel", onPress: () => resolve(false) },
      { text: ok, style: "destructive", onPress: () => resolve(true) },
    ]),
  );
}

function VisitCard({ item, s, onPrepare }: { item: Item; s: Strings; onPrepare: (reason: string) => void }) {
  const update = useMutation(api.visits.update);
  const setStatus = useMutation(api.visits.setStatus);
  const remove = useMutation(api.visits.remove);
  const [open, setOpen] = useState(false);
  const [prep, setPrep] = useState(item.prep ?? "");
  const [notes, setNotes] = useState(item.notes ?? "");
  const [error, setError] = useState<string | null>(null);
  const id = item._id as Id<"visits">;
  const isVisit = item.source === "visit";
  const run = (fn: () => Promise<unknown>) => fn().catch((e) => setError(cleanError(e)));

  return (
    <View style={[styles.card, item.status === "cancelled" && styles.faded]}>
      <Pressable style={styles.head} onPress={() => setOpen(!open)} accessibilityRole="button" accessibilityState={{ expanded: open }}>
        <Ionicons name={KIND_ICON[item.kind]} size={20} color={colors.primary} />
        <View style={styles.flex}>
          <Text style={styles.title}>
            {item.title}
            {item.status !== "upcoming" && <Text style={styles.tag}>  {item.status === "done" ? s.visitDone : s.visitCancelledTag}</Text>}
          </Text>
          <Text style={styles.small}>{[whenText(item.startsAt), item.clinician, item.location].filter(Boolean).join(" · ")}</Text>
        </View>
        <Ionicons name={open ? "chevron-up" : "chevron-down"} size={18} color={colors.muted} />
      </Pressable>
      {open && (
        <View style={styles.body}>
          <View style={styles.row}>
            {item.phone && (
              <Pressable style={styles.action} onPress={() => void Linking.openURL(`tel:${item.phone!.replace(/[^\d+]/g, "")}`)} accessibilityRole="button">
                <Ionicons name="call-outline" size={16} color={colors.primary} />
                <Text style={styles.link}>{s.careCall}</Text>
              </Pressable>
            )}
            {item.joinUrl && (
              <Pressable style={styles.action} onPress={() => void Linking.openURL(item.joinUrl!)} accessibilityRole="link">
                <Ionicons name="videocam-outline" size={16} color={colors.primary} />
                <Text style={styles.link}>{s.visitJoin}</Text>
              </Pressable>
            )}
            <Pressable style={styles.action} onPress={() => onPrepare(item.title)} accessibilityRole="button">
              <Ionicons name="clipboard-outline" size={16} color={colors.primary} />
              <Text style={styles.link}>{s.visitsMakeSummary}</Text>
            </Pressable>
          </View>
          {isVisit && (
            <>
              <Text style={styles.label}>{s.visitsPrep}</Text>
              <TextInput style={[styles.input, styles.multi]} value={prep} onChangeText={setPrep} onBlur={() => prep !== (item.prep ?? "") && void run(() => update({ id, prep }))} placeholder={s.visitsPrepPlaceholder} placeholderTextColor={colors.muted} multiline />
              <Text style={styles.label}>{s.visitsNotes}</Text>
              <TextInput style={[styles.input, styles.multi]} value={notes} onChangeText={setNotes} onBlur={() => notes !== (item.notes ?? "") && void run(() => update({ id, notes }))} placeholder={s.visitsNotesPlaceholder} placeholderTextColor={colors.muted} multiline />
              <View style={styles.row}>
                {item.status === "upcoming" ? (
                  <>
                    <Pressable onPress={() => void run(() => setStatus({ id, status: "done" }))} accessibilityRole="button">
                      <Text style={styles.link}>{s.visitsMarkDone}</Text>
                    </Pressable>
                    <Pressable onPress={() => void run(() => setStatus({ id, status: "cancelled" }))} accessibilityRole="button">
                      <Text style={styles.link}>{s.visitsMarkCancelled}</Text>
                    </Pressable>
                  </>
                ) : (
                  <Pressable onPress={() => void run(() => setStatus({ id, status: "upcoming" }))} accessibilityRole="button">
                    <Text style={styles.link}>{s.visitsReopen}</Text>
                  </Pressable>
                )}
                <Pressable onPress={async () => (await confirm(s.visitsDeleteConfirm, s.delete, s.cancel)) && void run(() => remove({ id }))} accessibilityRole="button">
                  <Text style={[styles.link, styles.danger]}>{s.delete}</Text>
                </Pressable>
              </View>
            </>
          )}
          {error && <Text style={styles.error}>{error}</Text>}
        </View>
      )}
    </View>
  );
}

function TeamSection({ s }: { s: Strings }) {
  const team = useQuery(api.visits.team);
  const add = useMutation(api.visits.addTeamMember);
  const updateMember = useMutation(api.visits.updateTeamMember);
  const remove = useMutation(api.visits.removeTeamMember);
  const empty = { name: "", role: "", phone: "", email: "", clinic: "" };
  const [draft, setDraft] = useState<typeof empty & { id?: Id<"careTeam"> }>(empty);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setError(null);
    try {
      const { id, ...fields } = draft;
      if (id) await updateMember({ id, ...fields });
      else await add(fields);
      setDraft(empty);
      setEditing(false);
    } catch (e) {
      setError(cleanError(e));
    }
  };

  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{s.careTeamTitle}</Text>
      {team?.length === 0 && !editing && <Text style={styles.empty}>{s.careTeamEmpty}</Text>}
      {team?.map((m) => (
        <View key={m._id} style={styles.member}>
          <View style={styles.flex}>
            <Text style={styles.title}>{m.name}</Text>
            <Text style={styles.small}>{[m.role, m.clinic, m.phone, m.email].filter(Boolean).join(" · ")}</Text>
          </View>
          {m.phone && (
            <Pressable onPress={() => void Linking.openURL(`tel:${m.phone!.replace(/[^\d+]/g, "")}`)} accessibilityRole="button" accessibilityLabel={`${s.careCall} ${m.name}`}>
              <Ionicons name="call-outline" size={20} color={colors.primary} />
            </Pressable>
          )}
          {m.email && (
            <Pressable onPress={() => void Linking.openURL(`mailto:${m.email}`)} accessibilityRole="button" accessibilityLabel={`Email ${m.name}`}>
              <Ionicons name="mail-outline" size={20} color={colors.primary} />
            </Pressable>
          )}
          <Pressable onPress={() => (setDraft({ id: m._id, name: m.name, role: m.role ?? "", phone: m.phone ?? "", email: m.email ?? "", clinic: m.clinic ?? "" }), setEditing(true))} accessibilityRole="button" accessibilityLabel={`${s.edit} ${m.name}`}>
            <Ionicons name="create-outline" size={19} color={colors.muted} />
          </Pressable>
          <Pressable onPress={async () => (await confirm(s.careTeamRemoveConfirm.replace("{name}", m.name), s.remove, s.cancel)) && void remove({ id: m._id })} accessibilityRole="button" accessibilityLabel={`${s.remove} ${m.name}`}>
            <Ionicons name="close" size={20} color={colors.danger} />
          </Pressable>
        </View>
      ))}
      {editing ? (
        <View style={styles.form}>
          {(["name", "role", "clinic", "phone", "email"] as const).map((k) => (
            <TextInput
              key={k}
              style={styles.input}
              placeholder={s[`careTeam_${k}`]}
              placeholderTextColor={colors.muted}
              value={draft[k]}
              onChangeText={(v) => setDraft({ ...draft, [k]: v })}
              keyboardType={k === "phone" ? "phone-pad" : k === "email" ? "email-address" : "default"}
              autoCapitalize={k === "email" ? "none" : "words"}
            />
          ))}
          <View style={styles.row}>
            <Pressable style={styles.button} onPress={() => void save()} accessibilityRole="button">
              <Text style={styles.buttonText}>{s.save}</Text>
            </Pressable>
            <Pressable onPress={() => (setEditing(false), setDraft(empty))} accessibilityRole="button">
              <Text style={styles.link}>{s.cancel}</Text>
            </Pressable>
          </View>
        </View>
      ) : (
        <Pressable style={styles.addRow} onPress={() => setEditing(true)} accessibilityRole="button">
          <Ionicons name="person-add-outline" size={18} color={colors.primary} />
          <Text style={styles.link}>{s.careTeamAdd}</Text>
        </Pressable>
      )}
      {error && <Text style={styles.error}>{error}</Text>}
    </View>
  );
}

export function VisitsPanel({ s, onPrepare }: { s: Strings; onPrepare: (reason: string) => void }) {
  // Re-read "now" each time the tab opens; good enough for sorting upcoming vs past.
  const now = useMemo(() => Math.floor(Date.now() / 60_000) * 60_000, []);
  const data = useQuery(api.visits.list, { now });
  const team = useQuery(api.visits.team);
  const add = useMutation(api.visits.add);
  const [adding, setAdding] = useState(false);
  const [showPast, setShowPast] = useState(false);
  const [title, setTitle] = useState("");
  const [date, setDate] = useState(localDate());
  const [time, setTime] = useState("09:00");
  const [kind, setKind] = useState<Kind>("in_person");
  const [clinicianId, setClinicianId] = useState<Id<"careTeam"> | null>(null);
  const [location, setLocation] = useState("");
  const [prep, setPrep] = useState("");
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setError(null);
    const startsAt = toMs(date, time);
    if (Number.isNaN(startsAt)) return setError(s.visitsBadDate);
    try {
      await add({ title, kind, startsAt, location: location || undefined, prep: prep || undefined, ...(clinicianId && { clinicianId }) });
      setAdding(false);
      setTitle("");
      setLocation("");
      setPrep("");
      setClinicianId(null);
    } catch (e) {
      setError(cleanError(e));
    }
  };

  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.panel}>
      <Text style={styles.note}>{s.visitsIntro}</Text>
      <Text style={styles.sectionTitle}>{s.visitsUpcoming}</Text>
      {data?.upcoming.length === 0 && !adding && <Text style={styles.empty}>{s.visitsNone}</Text>}
      {data?.upcoming.map((item) => <VisitCard key={item._id} item={item} s={s} onPrepare={onPrepare} />)}

      {adding ? (
        <View style={styles.form}>
          <TextInput style={styles.input} placeholder={s.visitsTitlePlaceholder} placeholderTextColor={colors.muted} value={title} onChangeText={setTitle} />
          <View style={styles.row}>
            <TextInput style={[styles.input, styles.date]} value={date} onChangeText={setDate} placeholder="YYYY-MM-DD" placeholderTextColor={colors.muted} accessibilityLabel={s.visitsDate} />
            <TextInput style={[styles.input, styles.time]} value={time} onChangeText={setTime} placeholder="HH:MM" placeholderTextColor={colors.muted} accessibilityLabel={s.visitsTime} />
          </View>
          <View style={styles.chips}>
            {(["in_person", "video", "phone"] as const).map((k) => (
              <Pressable key={k} style={[styles.chip, kind === k && styles.chipOn]} onPress={() => setKind(k)} accessibilityRole="radio" accessibilityState={{ selected: kind === k }}>
                <Ionicons name={KIND_ICON[k]} size={14} color={kind === k ? colors.primary : colors.text} />
                <Text style={[styles.chipText, kind === k && styles.chipTextOn]}>{s[`visitKind_${k}`]}</Text>
              </Pressable>
            ))}
          </View>
          {!!team?.length && (
            <View style={styles.chips}>
              {team.map((m) => (
                <Pressable key={m._id} style={[styles.chip, clinicianId === m._id && styles.chipOn]} onPress={() => setClinicianId(clinicianId === m._id ? null : m._id)} accessibilityRole="radio" accessibilityState={{ selected: clinicianId === m._id }}>
                  <Text style={[styles.chipText, clinicianId === m._id && styles.chipTextOn]}>{m.name}</Text>
                </Pressable>
              ))}
            </View>
          )}
          <TextInput style={styles.input} placeholder={s.visitsLocationPlaceholder} placeholderTextColor={colors.muted} value={location} onChangeText={setLocation} />
          <TextInput style={[styles.input, styles.multi]} placeholder={s.visitsPrepPlaceholder} placeholderTextColor={colors.muted} value={prep} onChangeText={setPrep} multiline />
          <View style={styles.row}>
            <Pressable style={styles.button} onPress={() => void save()} accessibilityRole="button">
              <Text style={styles.buttonText}>{s.save}</Text>
            </Pressable>
            <Pressable onPress={() => setAdding(false)} accessibilityRole="button">
              <Text style={styles.link}>{s.cancel}</Text>
            </Pressable>
          </View>
          {error && <Text style={styles.error}>{error}</Text>}
        </View>
      ) : (
        <Pressable style={styles.addRow} onPress={() => setAdding(true)} accessibilityRole="button">
          <Ionicons name="add-circle-outline" size={20} color={colors.primary} />
          <Text style={styles.link}>{s.visitsAdd}</Text>
        </Pressable>
      )}

      {!!data?.past.length && (
        <Pressable onPress={() => setShowPast(!showPast)} accessibilityRole="button">
          <Text style={styles.link}>{(showPast ? s.visitsHidePast : s.visitsShowPast).replace("{n}", String(data.past.length))}</Text>
        </Pressable>
      )}
      {showPast && data?.past.map((item) => <VisitCard key={item._id} item={item} s={s} onPrepare={onPrepare} />)}

      <TeamSection s={s} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { maxHeight: "75%", flexGrow: 0, flexShrink: 1, backgroundColor: "#fff", borderBottomWidth: 1, borderBottomColor: colors.border },
  panel: { padding: 16, gap: 10, maxWidth: 760, width: "100%", alignSelf: "center" },
  note: { color: colors.muted, fontSize: 14, lineHeight: 19 },
  empty: { color: colors.muted, fontStyle: "italic" },
  small: { color: colors.muted, fontSize: 13 },
  section: { gap: 8, marginTop: 8 },
  sectionTitle: { fontSize: 15, fontWeight: "700", color: colors.text, marginTop: 4 },
  card: { borderWidth: 1, borderColor: colors.border, borderRadius: 10, padding: 10, gap: 6 },
  faded: { opacity: 0.6 },
  head: { flexDirection: "row", alignItems: "center", gap: 10 },
  flex: { flex: 1, minWidth: 0 },
  title: { fontSize: 15, fontWeight: "600", color: colors.text },
  tag: { fontSize: 12, fontWeight: "600", color: colors.muted },
  body: { gap: 6, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 8 },
  label: { fontSize: 13, fontWeight: "600", color: colors.text },
  row: { flexDirection: "row", alignItems: "center", gap: 14, flexWrap: "wrap" },
  action: { flexDirection: "row", alignItems: "center", gap: 4 },
  member: { flexDirection: "row", alignItems: "center", gap: 12, borderWidth: 1, borderColor: colors.border, borderRadius: 10, padding: 10 },
  form: { gap: 8 },
  input: { borderWidth: 1, borderColor: colors.border, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8, fontSize: 15, minWidth: 0 },
  multi: { minHeight: 60, textAlignVertical: "top" },
  date: { width: 130 },
  time: { width: 80 },
  chips: { flexDirection: "row", gap: 6, flexWrap: "wrap" },
  chip: { flexDirection: "row", alignItems: "center", gap: 4, borderWidth: 1, borderColor: colors.border, borderRadius: 16, paddingHorizontal: 10, paddingVertical: 5 },
  chipOn: { backgroundColor: colors.primarySoft, borderColor: colors.primary },
  chipText: { color: colors.text, fontSize: 13 },
  chipTextOn: { color: colors.primary, fontWeight: "600" },
  button: { backgroundColor: colors.primary, borderRadius: 10, paddingVertical: 9, paddingHorizontal: 14 },
  buttonText: { color: "#fff", fontWeight: "600" },
  addRow: { flexDirection: "row", alignItems: "center", gap: 6, paddingVertical: 4 },
  link: { color: colors.primary, fontWeight: "600" },
  danger: { color: colors.danger },
  error: { color: colors.danger, fontSize: 13 },
});

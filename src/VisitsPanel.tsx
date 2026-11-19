// Appointments and care team (convex/visits.ts): upcoming and past visits with questions to ask beforehand and
// notes afterwards (both saved as you type), their title, time, kind, and place editable, a shortcut to a visit summary
// for each, and the people in your care with tap-to-call.
import { useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Linking, ScrollView, Text, TextInput, View } from "react-native";
import { Tap } from "./Tap";
import { useAction, useMutation, useQuery } from "convex/react";
import { Ionicons } from "@expo/vector-icons";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { colors, themed, TOUCH, ui, radius } from "./theme";
import type { Strings } from "./i18n";
import { localDate } from "./DailyCard";
import { Enter, SwapIcon } from "./Motion";
import { confirmAsk, errorText, showToast } from "./feedback";
import { formatDateTime } from "./format";
import { DateField, TimeField, dayString, timeString } from "./DateTimeField";
import { VisitPrep } from "./VisitPrep";
import { icsFile, Repeat, repeatTimes } from "./ics";
import { saveTextFile } from "./saveFile";

const REPEATS: (Repeat | null)[] = [null, "week", "twoWeeks", "month"];
const COUNTS = [4, 6, 12];

// Hands the appointment to the calendar app (a download on the web).
async function addToCalendar(item: { _id: string; title: string; startsAt: number; location?: string | null; prep?: string | null; clinician?: string | null }) {
  const notes = [item.clinician, item.prep].filter(Boolean).join("\n");
  await saveTextFile(`${item.title.replace(/[^\w\- ]+/g, "").trim() || "appointment"}.ics`, icsFile([{ uid: item._id, title: item.title, startsAt: item.startsAt, location: item.location, notes }]), "text/calendar", "com.apple.ical.ics");
}

type Kind = "in_person" | "video" | "phone";
type Item = NonNullable<(typeof api.visits.list)["_returnType"]>["upcoming"][number];
const KIND_ICON: Record<Kind, keyof typeof Ionicons.glyphMap> = { in_person: "business-outline", video: "videocam-outline", phone: "call-outline" };

const whenText = (ms: number, s: Strings) => formatDateTime(ms, s, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

// A local date + time typed in the app, as a timestamp.
function toMs(date: string, time: string) {
  const m = date.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const t = time.match(/^(\d{1,2}):(\d{2})$/);
  if (!m || !t) return NaN;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(t[1]), Number(t[2])).getTime();
}

// Saves a text field a moment after typing stops (and when it loses focus), and says when it's saved.
function useAutosave(value: string, saved: string, save: (v: string) => Promise<unknown>, onError: (e: unknown) => void) {
  const [state, setState] = useState<"idle" | "saving" | "saved">("idle");
  const latest = useRef(saved);
  latest.current = saved;
  const flush = () => {
    if (value === latest.current) return;
    setState("saving");
    save(value).then(
      () => setState("saved"),
      (e) => (setState("idle"), onError(e)),
    );
  };
  useEffect(() => {
    if (value === saved) return;
    const t = setTimeout(flush, 900);
    return () => clearTimeout(t);
  }, [value]);
  return { state, flush };
}

function VisitCard({ item, s, onPrepare }: { item: Item; s: Strings; onPrepare: (reason: string) => void }) {
  const update = useMutation(api.visits.update);
  const setStatus = useMutation(api.visits.setStatus);
  const remove = useMutation(api.visits.remove);
  const suggest = useAction(api.questions.suggest);
  const removeQuestion = useMutation(api.questions.remove);
  const [suggesting, setSuggesting] = useState(false);
  const [open, setOpen] = useState(false);
  const [prep, setPrep] = useState(item.prep ?? "");
  const [notes, setNotes] = useState(item.notes ?? "");
  const [error, setError] = useState<string | null>(null);
  const id = item._id as Id<"visits">;
  const isVisit = item.source === "visit";
  const run = (fn: () => Promise<unknown>) => fn().catch((e) => setError(errorText(e)));
  const fail = (e: unknown) => setError(errorText(e));
  const prepSave = useAutosave(prep, item.prep ?? "", (v) => update({ id, prep: v }), fail);
  const notesSave = useAutosave(notes, item.notes ?? "", (v) => update({ id, notes: v }), fail);
  // Changing the title, time, kind, or place.
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({ title: "", date: "", time: "", kind: "in_person" as Kind, location: "" });
  const startEdit = () => {
    const at = new Date(item.startsAt);
    setDraft({ title: item.title, date: dayString(at), time: timeString(at), kind: item.kind, location: item.location ?? "" });
    setEditing(true);
  };
  const saveEdit = async () => {
    setError(null);
    const startsAt = toMs(draft.date, draft.time);
    if (Number.isNaN(startsAt)) return setError(s.visitsBadDate);
    if (!draft.title.trim()) return setError(s.visitsNeedTitle);
    try {
      await update({ id, title: draft.title, startsAt, kind: draft.kind, location: draft.location });
      setEditing(false);
      showToast(s.saved);
    } catch (e) {
      fail(e);
    }
  };
  const savedNote = (st: "idle" | "saving" | "saved") => (st === "saving" ? s.visitsSaving : st === "saved" ? s.saved : "");

  return (
    <View style={[styles.card, item.status === "cancelled" && styles.faded]}>
      <Tap style={styles.head} onPress={() => setOpen(!open)} accessibilityRole="button" accessibilityState={{ expanded: open }}>
        <Ionicons name={KIND_ICON[item.kind]} size={20} color={colors.primary} />
        <View style={styles.flex}>
          <Text style={styles.title}>
            {item.title}
            {item.status !== "upcoming" && <Text style={styles.tag}>  {item.status === "done" ? s.visitDone : s.visitCancelledTag}</Text>}
          </Text>
          <Text style={styles.small}>{[whenText(item.startsAt, s), item.clinician, item.location].filter(Boolean).join(" · ")}</Text>
        </View>
        <SwapIcon id={open ? "up" : "down"}>
          <Ionicons name={open ? "chevron-up" : "chevron-down"} size={18} color={colors.muted} />
        </SwapIcon>
      </Tap>
      {open && (
        <View style={styles.body}>
          <View style={styles.row}>
            {item.phone && (
              <Tap style={styles.action} onPress={() => void Linking.openURL(`tel:${item.phone!.replace(/[^\d+]/g, "")}`)} accessibilityRole="button">
                <Ionicons name="call-outline" size={16} color={colors.primary} />
                <Text style={styles.link}>{s.careCall}</Text>
              </Tap>
            )}
            {item.joinUrl && (
              <Tap style={styles.action} onPress={() => void Linking.openURL(item.joinUrl!)} accessibilityRole="link">
                <Ionicons name="videocam-outline" size={16} color={colors.primary} />
                <Text style={styles.link}>{s.visitJoin}</Text>
              </Tap>
            )}
            <Tap style={styles.action} onPress={() => onPrepare(item.title)} accessibilityRole="button">
              <Ionicons name="clipboard-outline" size={16} color={colors.primary} />
              <Text style={styles.link}>{s.visitsMakeSummary}</Text>
            </Tap>
            {item.status === "upcoming" && (
              <Tap style={styles.action} onPress={() => void addToCalendar(item).catch(fail)} accessibilityRole="button">
                <Ionicons name="calendar-outline" size={16} color={colors.primary} />
                <Text style={styles.link}>{s.visitsAddToCalendar}</Text>
              </Tap>
            )}
          </View>
          {isVisit && item.status === "upcoming" && (
            <View style={styles.questions}>
              <Text style={styles.label}>{s.visitQuestions}</Text>
              {item.questions?.map((q, i) => (
                <View key={`${i}-${q}`} style={styles.question}>
                  <Text style={[styles.questionText, styles.flex]}>• {q}</Text>
                  <Tap onPress={() => void run(() => removeQuestion({ id, index: i }))} accessibilityRole="button" accessibilityLabel={s.remove} hitSlop={8}>
                    <Ionicons name="close" size={16} color={colors.muted} />
                  </Tap>
                </View>
              ))}
              {!!item.questions?.length && <Text style={styles.small}>{s.visitQuestionsNote}</Text>}
              <Tap
                style={styles.action}
                disabled={suggesting}
                onPress={() => {
                  setSuggesting(true);
                  setError(null);
                  void run(() => suggest({ id })).finally(() => setSuggesting(false));
                }}
                accessibilityRole="button"
                accessibilityState={{ busy: suggesting }}
              >
                {suggesting ? <ActivityIndicator size="small" color={colors.primary} /> : <Ionicons name="sparkles-outline" size={16} color={colors.primary} />}
                <Text style={styles.link}>{item.questions?.length ? s.visitNewQuestions : s.visitSuggestQuestions}</Text>
              </Tap>
            </View>
          )}
          {isVisit && editing && (
            <View style={styles.form}>
              <TextInput style={styles.input} value={draft.title} onChangeText={(title) => setDraft({ ...draft, title })} placeholder={s.visitsTitlePlaceholder} placeholderTextColor={colors.muted} accessibilityLabel={s.visitsTitlePlaceholder} />
              <View style={styles.row}>
                <DateField value={draft.date} onChange={(date) => setDraft({ ...draft, date })} label={s.visitsDate} s={s} />
                <TimeField value={draft.time} onChange={(time) => setDraft({ ...draft, time })} label={s.visitsTime} s={s} />
              </View>
              <View style={styles.chips}>
                {(["in_person", "video", "phone"] as const).map((k) => (
                  <Tap key={k} style={[styles.chip, draft.kind === k && styles.chipOn]} onPress={() => setDraft({ ...draft, kind: k })} accessibilityRole="radio" accessibilityState={{ selected: draft.kind === k }}>
                    <Ionicons name={KIND_ICON[k]} size={14} color={draft.kind === k ? colors.primary : colors.text} />
                    <Text style={[styles.chipText, draft.kind === k && styles.chipTextOn]}>{s[`visitKind_${k}`]}</Text>
                  </Tap>
                ))}
              </View>
              <TextInput style={styles.input} value={draft.location} onChangeText={(location) => setDraft({ ...draft, location })} placeholder={s.visitsLocationPlaceholder} placeholderTextColor={colors.muted} accessibilityLabel={s.visitsLocationPlaceholder} />
              <View style={styles.row}>
                <Tap style={styles.button} onPress={() => void saveEdit()} accessibilityRole="button">
                  <Text style={styles.buttonText}>{s.logSaveChanges}</Text>
                </Tap>
                <Tap style={styles.action} onPress={() => setEditing(false)} accessibilityRole="button">
                  <Text style={styles.link}>{s.cancel}</Text>
                </Tap>
              </View>
            </View>
          )}
          {isVisit && (
            <>
              <View style={styles.labelRow}>
                <Text style={styles.label}>{s.visitsPrep}</Text>
                <Text style={styles.savedNote} accessibilityLiveRegion="polite">{savedNote(prepSave.state)}</Text>
              </View>
              <TextInput style={[styles.input, styles.multi]} value={prep} onChangeText={setPrep} onBlur={prepSave.flush} placeholder={s.visitsPrepPlaceholder} placeholderTextColor={colors.muted} accessibilityLabel={s.visitsPrep} multiline />
              <View style={styles.labelRow}>
                <Text style={styles.label}>{s.visitsNotes}</Text>
                <Text style={styles.savedNote} accessibilityLiveRegion="polite">{savedNote(notesSave.state)}</Text>
              </View>
              <TextInput style={[styles.input, styles.multi]} value={notes} onChangeText={setNotes} onBlur={notesSave.flush} placeholder={s.visitsNotesPlaceholder} placeholderTextColor={colors.muted} accessibilityLabel={s.visitsNotes} multiline />
              <View style={styles.row}>
                {!editing && (
                  <Tap style={styles.action} onPress={startEdit} accessibilityRole="button">
                    <Ionicons name="create-outline" size={16} color={colors.primary} />
                    <Text style={styles.link}>{s.visitsEdit}</Text>
                  </Tap>
                )}
                {item.status === "upcoming" ? (
                  <>
                    <Tap onPress={() => void run(() => setStatus({ id, status: "done" }))} accessibilityRole="button">
                      <Text style={styles.link}>{s.visitsMarkDone}</Text>
                    </Tap>
                    <Tap onPress={() => void run(() => setStatus({ id, status: "cancelled" }))} accessibilityRole="button">
                      <Text style={styles.link}>{s.visitsMarkCancelled}</Text>
                    </Tap>
                  </>
                ) : (
                  <Tap onPress={() => void run(() => setStatus({ id, status: "upcoming" }))} accessibilityRole="button">
                    <Text style={styles.link}>{s.visitsReopen}</Text>
                  </Tap>
                )}
                <Tap onPress={async () => (await confirmAsk({ title: s.visitsDeleteConfirm, ok: s.delete, cancel: s.cancel })) && void run(() => remove({ id }))} accessibilityRole="button">
                  <Text style={[styles.link, styles.danger]}>{s.delete}</Text>
                </Tap>
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
      setError(errorText(e));
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
            <Tap onPress={() => void Linking.openURL(`tel:${m.phone!.replace(/[^\d+]/g, "")}`)} accessibilityRole="button" accessibilityLabel={`${s.careCall} ${m.name}`}>
              <Ionicons name="call-outline" size={20} color={colors.primary} />
            </Tap>
          )}
          {m.email && (
            <Tap onPress={() => void Linking.openURL(`mailto:${m.email}`)} accessibilityRole="button" accessibilityLabel={`Email ${m.name}`}>
              <Ionicons name="mail-outline" size={20} color={colors.primary} />
            </Tap>
          )}
          <Tap onPress={() => (setDraft({ id: m._id, name: m.name, role: m.role ?? "", phone: m.phone ?? "", email: m.email ?? "", clinic: m.clinic ?? "" }), setEditing(true))} accessibilityRole="button" accessibilityLabel={`${s.edit} ${m.name}`}>
            <Ionicons name="create-outline" size={19} color={colors.muted} />
          </Tap>
          <Tap onPress={async () => (await confirmAsk({ title: s.careTeamRemoveConfirm.replace("{name}", m.name), ok: s.remove, cancel: s.cancel })) && void remove({ id: m._id })} accessibilityRole="button" accessibilityLabel={`${s.remove} ${m.name}`}>
            <Ionicons name="close" size={20} color={colors.danger} />
          </Tap>
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
            <Tap style={styles.button} onPress={() => void save()} accessibilityRole="button">
              <Text style={styles.buttonText}>{s.save}</Text>
            </Tap>
            <Tap onPress={() => (setEditing(false), setDraft(empty))} accessibilityRole="button">
              <Text style={styles.link}>{s.cancel}</Text>
            </Tap>
          </View>
        </View>
      ) : (
        <Tap style={styles.addRow} onPress={() => setEditing(true)} accessibilityRole="button">
          <Ionicons name="person-add-outline" size={18} color={colors.primary} />
          <Text style={styles.link}>{s.careTeamAdd}</Text>
        </Tap>
      )}
      {error && <Text style={styles.error}>{error}</Text>}
    </View>
  );
}

// `openPrep`: open on the Prep view (the dashboard's checklist button).
export function VisitsPanel({ s, onPrepare, openPrep = false }: { s: Strings; onPrepare: (reason: string) => void; openPrep?: boolean }) {
  const [view, setView] = useState<"list" | "prep">(openPrep ? "prep" : "list");
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
  const [repeat, setRepeat] = useState<Repeat | null>(null);
  const [count, setCount] = useState(COUNTS[0]);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setError(null);
    const startsAt = toMs(date, time);
    if (Number.isNaN(startsAt)) return setError(s.visitsBadDate);
    try {
      const repeats = repeat ? repeatTimes(startsAt, repeat, count).slice(1) : undefined;
      await add({ title, kind, startsAt, location: location || undefined, prep: prep || undefined, ...(clinicianId && { clinicianId }), ...(repeats && { repeats }) });
      if (repeats) showToast(s.visitsRepeatAdded.replace("{n}", String(repeats.length + 1)));
      setAdding(false);
      setRepeat(null);
      setTitle("");
      setLocation("");
      setPrep("");
      setClinicianId(null);
    } catch (e) {
      setError(errorText(e));
    }
  };

  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.panel}>
      <View style={styles.views} accessibilityRole="tablist">
        {(["list", "prep"] as const).map((v) => (
          <Tap key={v} style={[styles.view, view === v && styles.viewOn]} onPress={() => setView(v)} accessibilityRole="tab" accessibilityState={{ selected: view === v }}>
            <Text style={[styles.viewText, view === v && styles.viewTextOn]}>{v === "list" ? s.visitsTabList : s.visitsTabPrep}</Text>
          </Tap>
        ))}
      </View>
      {view === "prep" ? (
        <Enter key="prep" from={6}>
          <VisitPrep s={s} onAdd={() => (setView("list"), setAdding(true))} />
        </Enter>
      ) : (
      <Enter key="list" from={6} style={styles.list}>
      <Text style={styles.note}>{s.visitsIntro}</Text>
      <Text style={styles.sectionTitle}>{s.visitsUpcoming}</Text>
      {data?.upcoming.length === 0 && !adding && <Text style={styles.empty}>{s.visitsNone}</Text>}
      {data?.upcoming.map((item) => <VisitCard key={item._id} item={item} s={s} onPrepare={onPrepare} />)}

      {adding ? (
        <View style={styles.form}>
          <TextInput style={styles.input} placeholder={s.visitsTitlePlaceholder} placeholderTextColor={colors.muted} value={title} onChangeText={setTitle} />
          <View style={styles.row}>
            <DateField value={date} onChange={setDate} label={s.visitsDate} s={s} />
            <TimeField value={time} onChange={setTime} label={s.visitsTime} s={s} />
          </View>
          <View style={styles.chips}>
            {(["in_person", "video", "phone"] as const).map((k) => (
              <Tap key={k} style={[styles.chip, kind === k && styles.chipOn]} onPress={() => setKind(k)} accessibilityRole="radio" accessibilityState={{ selected: kind === k }}>
                <Ionicons name={KIND_ICON[k]} size={14} color={kind === k ? colors.primary : colors.text} />
                <Text style={[styles.chipText, kind === k && styles.chipTextOn]}>{s[`visitKind_${k}`]}</Text>
              </Tap>
            ))}
          </View>
          {!!team?.length && (
            <View style={styles.chips}>
              {team.map((m) => (
                <Tap key={m._id} style={[styles.chip, clinicianId === m._id && styles.chipOn]} onPress={() => setClinicianId(clinicianId === m._id ? null : m._id)} accessibilityRole="radio" accessibilityState={{ selected: clinicianId === m._id }}>
                  <Text style={[styles.chipText, clinicianId === m._id && styles.chipTextOn]}>{m.name}</Text>
                </Tap>
              ))}
            </View>
          )}
          <TextInput style={styles.input} placeholder={s.visitsLocationPlaceholder} placeholderTextColor={colors.muted} value={location} onChangeText={setLocation} />
          <TextInput style={[styles.input, styles.multi]} placeholder={s.visitsPrepPlaceholder} placeholderTextColor={colors.muted} value={prep} onChangeText={setPrep} multiline />
          <Text style={styles.label}>{s.visitsRepeat}</Text>
          <View style={styles.chips} accessibilityRole="radiogroup" accessibilityLabel={s.visitsRepeat}>
            {REPEATS.map((r) => (
              <Tap key={r ?? "none"} style={[styles.chip, repeat === r && styles.chipOn]} onPress={() => setRepeat(r)} accessibilityRole="radio" accessibilityState={{ selected: repeat === r }}>
                <Text style={[styles.chipText, repeat === r && styles.chipTextOn]}>{r ? s.visitsRepeatEvery[r] : s.visitsRepeatNone}</Text>
              </Tap>
            ))}
          </View>
          {repeat && (
            <View style={styles.chips} accessibilityRole="radiogroup" accessibilityLabel={s.visitsRepeatTimes}>
              {COUNTS.map((n) => (
                <Tap key={n} style={[styles.chip, count === n && styles.chipOn]} onPress={() => setCount(n)} accessibilityRole="radio" accessibilityState={{ selected: count === n }}>
                  <Text style={[styles.chipText, count === n && styles.chipTextOn]}>{s.visitsRepeatCount.replace("{n}", String(n))}</Text>
                </Tap>
              ))}
            </View>
          )}
          <View style={styles.row}>
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
          <Text style={styles.link}>{s.visitsAdd}</Text>
        </Tap>
      )}

      {!!data?.past.length && (
        <Tap onPress={() => setShowPast(!showPast)} accessibilityRole="button">
          <Text style={styles.link}>{(showPast ? s.visitsHidePast : s.visitsShowPast).replace("{n}", String(data.past.length))}</Text>
        </Tap>
      )}
      {showPast && data?.past.map((item) => <VisitCard key={item._id} item={item} s={s} onPrepare={onPrepare} />)}

      <TeamSection s={s} />
      </Enter>
      )}
    </ScrollView>
  );
}

const styles = themed(() => ({
  scroll: { flex: 1, backgroundColor: colors.bg },
  panel: { padding: 16, gap: 10, maxWidth: 760, width: "100%", alignSelf: "center" },
  list: { gap: 10 },
  labelRow: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", gap: 8 },
  savedNote: { color: colors.muted, fontSize: 12 },
  views: { flexDirection: "row", gap: 4, padding: 4, borderRadius: radius.pill, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.hairline },
  view: { flex: 1, minHeight: 40, alignItems: "center", justifyContent: "center", borderRadius: radius.pill },
  viewOn: { backgroundColor: colors.primary },
  viewText: { color: colors.text, fontSize: 14, fontWeight: "600" },
  viewTextOn: { color: colors.onPrimary },
  note: { color: colors.muted, fontSize: 14, lineHeight: 19 },
  empty: { ...ui.empty },
  small: { color: colors.muted, fontSize: 13 },
  section: { gap: 8, marginTop: 8 },
  sectionTitle: { fontSize: 17, fontWeight: "700", color: colors.text, marginTop: 4 },
  card: { ...ui.card, padding: 10, gap: 6 },
  faded: { opacity: 0.6 },
  head: { flexDirection: "row", alignItems: "center", gap: 10 },
  flex: { flex: 1, minWidth: 0 },
  title: { fontSize: 15, fontWeight: "600", color: colors.text },
  tag: { fontSize: 12, fontWeight: "600", color: colors.muted },
  body: { gap: 6, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 8 },
  label: { fontSize: 13, fontWeight: "600", color: colors.text },
  questions: { gap: 4, backgroundColor: colors.primarySoft, borderRadius: 12, padding: 8 },
  question: { flexDirection: "row", alignItems: "flex-start", gap: 8 },
  questionText: { fontSize: 14, color: colors.text, lineHeight: 20 },
  row: { flexDirection: "row", alignItems: "center", gap: 14, flexWrap: "wrap" },
  action: { flexDirection: "row", alignItems: "center", gap: 4 },
  member: { flexDirection: "row", alignItems: "center", gap: 12, borderWidth: 1, borderColor: colors.border, borderRadius: 15, padding: 10 },
  form: { gap: 8 },
  input: { color: colors.text, borderWidth: 1, borderColor: colors.inputBorder, backgroundColor: colors.surface, borderRadius: 12, paddingHorizontal: 10, paddingVertical: 8, fontSize: 15, minWidth: 0 },
  multi: { minHeight: 60, textAlignVertical: "top" },
  chips: { flexDirection: "row", gap: 6, flexWrap: "wrap" },
  chip: { ...ui.chip, flexDirection: "row", alignItems: "center", gap: 4 },
  chipOn: { backgroundColor: colors.primarySoft, borderColor: colors.primary },
  chipText: { color: colors.text, fontSize: 13 },
  chipTextOn: { color: colors.primary, fontWeight: "600" },
  button: { backgroundColor: colors.primary, borderRadius: radius.pill, paddingVertical: 9, paddingHorizontal: 14, minHeight: TOUCH, justifyContent: "center" },
  buttonText: { color: colors.onPrimary, fontWeight: "600", fontSize: 14 },
  addRow: { ...ui.addButton },
  link: { color: colors.primary, fontWeight: "600", fontSize: 14 },
  danger: { color: colors.danger },
  error: { color: colors.danger, fontSize: 13 },
}));

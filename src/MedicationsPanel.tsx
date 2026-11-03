// Medications (convex/medications.ts, convex/reminders.ts): the list with status and supply, and each medication's
// details: generic name, form, prescriber, per-time doses, refills, the eScript photo, side effects and history.
// Reminder messages with Taken / Skip appear in the chat.
import { useState } from "react";
import { ActivityIndicator, Alert, Image, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useMutation, useQuery } from "convex/react";
import { Ionicons } from "@expo/vector-icons";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { colors } from "./theme";
import type { Strings } from "./i18n";
import { pickPhoto, uploadPhoto } from "./photo";

type Mode = "daily" | "interval";
type Rule = { kind: "daily"; times: string[] } | { kind: "interval"; everyHours: number };
const FORMS = ["tablet", "capsule", "liquid", "inhaler", "patch", "injection", "cream", "drops", "other"] as const;
type Form = (typeof FORMS)[number];

const cleanError = (e: unknown) => (e as Error).message.replace(/^.*Uncaught Error: /, "").split("\n")[0];
const describe = (r: Rule, s: Strings) =>
  r.kind === "daily" ? s.dailyAt.replace("{times}", r.times.join(", ")) : s.everyNHours.replace("{n}", String(r.everyHours));

function when(at: number, s: Strings) {
  const d = new Date(at);
  const time = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  return d.toDateString() === new Date().toDateString() ? `${s.today} ${time}` : `${d.toLocaleDateString([], { weekday: "short" })} ${time}`;
}

function confirm(title: string, message: string, ok: string, cancel: string): Promise<boolean> {
  if (Platform.OS === "web") return Promise.resolve(window.confirm(`${title}\n\n${message}`));
  return new Promise((resolve) =>
    Alert.alert(title, message, [
      { text: cancel, style: "cancel", onPress: () => resolve(false) },
      { text: ok, style: "destructive", onPress: () => resolve(true) },
    ]),
  );
}

const parseTimes = (text: string) => text.split(/[,\s]+/).filter(Boolean);

function FormChips({ value, onChange, s }: { value: Form | null; onChange: (f: Form | null) => void; s: Strings }) {
  return (
    <View style={styles.chips}>
      {FORMS.map((f) => (
        <Pressable key={f} style={[styles.chip, value === f && styles.chipOn]} onPress={() => onChange(value === f ? null : f)} accessibilityRole="radio" accessibilityState={{ selected: value === f }}>
          <Text style={[styles.chipText, value === f && styles.chipTextOn]}>{s[`form_${f}`]}</Text>
        </Pressable>
      ))}
    </View>
  );
}

function Detail({ id, s }: { id: Id<"medications">; s: Strings }) {
  const med = useQuery(api.medications.detail, { id });
  const update = useMutation(api.medications.update);
  const pause = useMutation(api.medications.pause);
  const resume = useMutation(api.medications.resume);
  const stop = useMutation(api.reminders.remove);
  const addEffect = useMutation(api.medications.addSideEffect);
  const removeEffect = useMutation(api.medications.removeSideEffect);
  const setSupply = useMutation(api.medications.setSupply);
  const refill = useMutation(api.medications.refill);
  const setScript = useMutation(api.medications.setScript);
  const uploadUrl = useMutation(api.chat.generateUploadUrl);
  const claim = useMutation(api.chat.claimUpload);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<{ genericName: string; prescriber: string; notes: string; dose: string; form: Form | null; timeDoses: Record<string, string> } | null>(null);
  const [effect, setEffect] = useState("");
  const [supplyDraft, setSupplyDraft] = useState<{ left: string; perDose: string; warnDays: string } | null>(null);
  const [refillAmount, setRefillAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (med === undefined) return <ActivityIndicator color={colors.primary} />;
  if (med === null) return null;

  const run = async (fn: () => Promise<unknown>) => {
    setError(null);
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      setError(cleanError(e));
    } finally {
      setBusy(false);
    }
  };

  const startEdit = () => {
    setDraft({
      genericName: med.genericName ?? "",
      prescriber: med.prescriber ?? "",
      notes: med.notes ?? "",
      dose: med.dose ?? "",
      form: med.form,
      timeDoses: Object.fromEntries(med.timeDoses.map((t) => [t.time, t.dose])),
    });
    setEditing(true);
  };

  const saveEdit = () =>
    run(async () => {
      if (!draft) return;
      await update({
        id,
        genericName: draft.genericName,
        prescriber: draft.prescriber,
        notes: draft.notes,
        dose: draft.dose,
        ...(draft.form && { form: draft.form }),
        ...(med.rule.kind === "daily" && {
          timeDoses: Object.entries(draft.timeDoses).filter(([, d]) => d.trim()).map(([time, dose]) => ({ time, dose })),
        }),
      });
      setEditing(false);
    });

  const addScript = () =>
    run(async () => {
      const photo = await pickPhoto(Platform.OS === "web" ? "library" : "camera");
      if (!photo) return;
      const storageId = await uploadPhoto(photo, () => uploadUrl(), (sid) => claim({ storageId: sid as Id<"_storage"> }));
      await setScript({ id, storageId: storageId as Id<"_storage"> });
    });

  const eventLabel = (k: string) => s[`medEvent_${k}` as "medEvent_started"] ?? k;

  return (
    <View style={styles.detail}>
      {editing && draft ? (
        <View style={styles.form}>
          <TextInput style={styles.input} placeholder={s.dosePlaceholder} placeholderTextColor={colors.muted} value={draft.dose} onChangeText={(dose) => setDraft({ ...draft, dose })} />
          {med.rule.kind === "daily" && med.rule.times.length > 1 && (
            <>
              <Text style={styles.small}>{s.medDosePerTime}</Text>
              {med.rule.times.map((time) => (
                <View key={time} style={styles.inline}>
                  <Text style={styles.label}>{time}</Text>
                  <TextInput
                    style={[styles.input, styles.flex]}
                    placeholder={draft.dose || s.dosePlaceholder}
                    placeholderTextColor={colors.muted}
                    value={draft.timeDoses[time] ?? ""}
                    onChangeText={(d) => setDraft({ ...draft, timeDoses: { ...draft.timeDoses, [time]: d } })}
                  />
                </View>
              ))}
            </>
          )}
          <TextInput style={styles.input} placeholder={s.medGenericPlaceholder} placeholderTextColor={colors.muted} value={draft.genericName} onChangeText={(genericName) => setDraft({ ...draft, genericName })} />
          <FormChips value={draft.form} onChange={(form) => setDraft({ ...draft, form })} s={s} />
          <TextInput style={styles.input} placeholder={s.medPrescriberPlaceholder} placeholderTextColor={colors.muted} value={draft.prescriber} onChangeText={(prescriber) => setDraft({ ...draft, prescriber })} />
          <TextInput style={styles.input} placeholder={s.medNotesPlaceholder} placeholderTextColor={colors.muted} value={draft.notes} onChangeText={(notes) => setDraft({ ...draft, notes })} multiline />
          <View style={styles.inline}>
            <Pressable style={styles.button} onPress={() => void saveEdit()} disabled={busy} accessibilityRole="button">
              <Text style={styles.buttonText}>{s.save}</Text>
            </Pressable>
            <Pressable onPress={() => setEditing(false)} accessibilityRole="button">
              <Text style={styles.link}>{s.cancel}</Text>
            </Pressable>
          </View>
        </View>
      ) : (
        <>
          {(med.genericName || med.form || med.prescriber) && (
            <Text style={styles.line}>
              {[med.genericName, med.form && s[`form_${med.form}`], med.prescriber && s.medPrescribedBy.replace("{who}", med.prescriber)].filter(Boolean).join(" · ")}
            </Text>
          )}
          {med.timeDoses.length > 0 && <Text style={styles.small}>{med.timeDoses.map((t) => `${t.time}: ${t.dose}`).join(" · ")}</Text>}
          {med.notes && <Text style={styles.small}>{med.notes}</Text>}
          <Pressable onPress={startEdit} accessibilityRole="button">
            <Text style={styles.link}>{s.medEditDetails}</Text>
          </Pressable>
        </>
      )}

      <Text style={styles.section}>{s.medSupply}</Text>
      {med.supply && !supplyDraft ? (
        <View style={styles.inline}>
          <Text style={[styles.line, med.daysLeft !== null && med.daysLeft <= med.supply.warnDays && styles.warn]}>
            {s.medSupplyLine.replace("{left}", String(med.supply.left)).replace("{days}", String(med.daysLeft ?? "?"))}
          </Text>
          <TextInput style={[styles.input, styles.short]} placeholder="+30" placeholderTextColor={colors.muted} value={refillAmount} onChangeText={setRefillAmount} keyboardType="numeric" />
          <Pressable onPress={() => void run(async () => (await refill({ id, amount: Number(refillAmount) || undefined }), setRefillAmount("")))} accessibilityRole="button">
            <Text style={styles.link}>{s.medRefilled}</Text>
          </Pressable>
          <Pressable onPress={() => setSupplyDraft({ left: String(med.supply!.left), perDose: String(med.supply!.perDose), warnDays: String(med.supply!.warnDays) })} accessibilityRole="button">
            <Text style={styles.link}>{s.edit}</Text>
          </Pressable>
        </View>
      ) : supplyDraft ? (
        <View style={styles.inline}>
          <TextInput style={[styles.input, styles.short]} value={supplyDraft.left} onChangeText={(left) => setSupplyDraft({ ...supplyDraft, left })} keyboardType="numeric" accessibilityLabel={s.medLeft} />
          <Text style={styles.label}>{s.medLeft}</Text>
          <TextInput style={[styles.input, styles.short]} value={supplyDraft.perDose} onChangeText={(perDose) => setSupplyDraft({ ...supplyDraft, perDose })} keyboardType="numeric" accessibilityLabel={s.medPerDose} />
          <Text style={styles.label}>{s.medPerDose}</Text>
          <TextInput style={[styles.input, styles.short]} value={supplyDraft.warnDays} onChangeText={(warnDays) => setSupplyDraft({ ...supplyDraft, warnDays })} keyboardType="numeric" accessibilityLabel={s.medWarnDays} />
          <Text style={styles.label}>{s.medWarnDays}</Text>
          <Pressable
            style={styles.button}
            onPress={() =>
              void run(async () => {
                await setSupply({ id, left: Number(supplyDraft.left), perDose: Number(supplyDraft.perDose), warnDays: Number(supplyDraft.warnDays) || 7 });
                setSupplyDraft(null);
              })
            }
            accessibilityRole="button"
          >
            <Text style={styles.buttonText}>{s.save}</Text>
          </Pressable>
        </View>
      ) : (
        <Pressable onPress={() => setSupplyDraft({ left: "", perDose: "1", warnDays: "7" })} accessibilityRole="button">
          <Text style={styles.link}>{s.medTrackSupply}</Text>
        </Pressable>
      )}

      <Text style={styles.section}>{s.medScript}</Text>
      {med.scriptUrl ? (
        <View style={styles.inline}>
          <Image source={{ uri: med.scriptUrl }} style={styles.script} accessibilityLabel={s.medScript} />
          <View style={styles.form}>
            <Pressable onPress={() => void addScript()} accessibilityRole="button">
              <Text style={styles.link}>{s.medReplaceScript}</Text>
            </Pressable>
            <Pressable onPress={() => void run(() => setScript({ id, storageId: null }))} accessibilityRole="button">
              <Text style={[styles.link, styles.danger]}>{s.remove}</Text>
            </Pressable>
          </View>
        </View>
      ) : (
        <Pressable onPress={() => void addScript()} accessibilityRole="button">
          <Text style={styles.link}>{s.medAddScript}</Text>
        </Pressable>
      )}

      <Text style={styles.section}>{s.medSideEffects}</Text>
      {med.sideEffects.map((e) => (
        <View key={e._id} style={styles.inline}>
          <Text style={[styles.line, styles.flex]}>
            {e.date.slice(5)} · {e.effect}
            {e.severity !== null ? ` ${e.severity}/10` : ""}
          </Text>
          <Pressable onPress={() => void run(() => removeEffect({ id: e._id }))} accessibilityRole="button" accessibilityLabel={s.remove}>
            <Ionicons name="close" size={18} color={colors.muted} />
          </Pressable>
        </View>
      ))}
      <View style={styles.inline}>
        <TextInput style={[styles.input, styles.flex]} placeholder={s.medSideEffectPlaceholder} placeholderTextColor={colors.muted} value={effect} onChangeText={setEffect} maxLength={200} />
        <Pressable onPress={() => void run(async () => (await addEffect({ id, effect }), setEffect("")))} disabled={!effect.trim()} accessibilityRole="button" accessibilityLabel={s.medAddSideEffect}>
          <Ionicons name="add-circle" size={26} color={effect.trim() ? colors.primary : colors.border} />
        </Pressable>
      </View>

      {med.events.length > 0 && <Text style={styles.section}>{s.medHistory}</Text>}
      {med.events.map((e) => (
        <Text key={e._id} style={styles.small}>
          {new Date(e.at).toLocaleDateString()} · {eventLabel(e.kind)}
          {e.note ? ` (${e.note})` : ""}
        </Text>
      ))}

      {med.status !== "stopped" && (
        <View style={styles.inline}>
          {med.status === "active" ? (
            <Pressable onPress={() => void run(() => pause({ id }))} accessibilityRole="button">
              <Text style={styles.link}>{s.medPause}</Text>
            </Pressable>
          ) : (
            <Pressable onPress={() => void run(() => resume({ id }))} accessibilityRole="button">
              <Text style={styles.link}>{s.medResume}</Text>
            </Pressable>
          )}
          <Pressable
            onPress={async () => {
              if (await confirm(s.medStopTitle.replace("{name}", med.name), s.medStopBody, s.medStop, s.cancel)) await run(() => stop({ id }));
            }}
            accessibilityRole="button"
          >
            <Text style={[styles.link, styles.danger]}>{s.medStop}</Text>
          </Pressable>
        </View>
      )}
      {error && <Text style={styles.error}>{error}</Text>}
    </View>
  );
}

export function MedicationsPanel({ s }: { s: Strings }) {
  const meds = useQuery(api.medications.all);
  const add = useMutation(api.reminders.add);
  const [open, setOpen] = useState<Id<"medications"> | null>(null);
  const [showStopped, setShowStopped] = useState(false);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [dose, setDose] = useState("");
  const [form, setForm] = useState<Form | null>(null);
  const [genericName, setGenericName] = useState("");
  const [prescriber, setPrescriber] = useState("");
  const [mode, setMode] = useState<Mode>("daily");
  const [times, setTimes] = useState("08:00");
  const [timeDoses, setTimeDoses] = useState<Record<string, string>>({});
  const [hours, setHours] = useState("8");
  const [days, setDays] = useState("");
  const [error, setError] = useState<string | null>(null);

  const list = (meds ?? []).filter((m) => showStopped || m.status !== "stopped");
  const stoppedCount = (meds ?? []).filter((m) => m.status === "stopped").length;
  const parsedTimes = parseTimes(times);

  const save = async () => {
    setError(null);
    const everyHours = Number(hours);
    try {
      await add({
        name,
        dose: dose || undefined,
        days: days ? Number(days) : undefined,
        genericName: genericName || undefined,
        prescriber: prescriber || undefined,
        ...(form && { form }),
        ...(mode === "daily" && {
          timeDoses: parsedTimes.filter((t) => timeDoses[t]?.trim()).map((t) => ({ time: t.padStart(5, "0"), dose: timeDoses[t] })),
        }),
        schedule: mode === "daily" ? { kind: "daily", times: parsedTimes } : { kind: "interval", everyHours, firstAt: Date.now() + everyHours * 3_600_000 },
      });
      setAdding(false);
      setName("");
      setDose("");
      setDays("");
      setGenericName("");
      setPrescriber("");
      setForm(null);
      setTimeDoses({});
    } catch (e) {
      setError(cleanError(e));
    }
  };

  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.panel}>
      <Text style={styles.note}>{s.medsIntro}</Text>
      {meds?.length === 0 && !adding && <Text style={styles.empty}>{s.remindersEmpty}</Text>}
      {list.map((m) => (
        <View key={m._id} style={[styles.med, m.status !== "active" && styles.medInactive]}>
          <Pressable style={styles.medHead} onPress={() => setOpen(open === m._id ? null : m._id)} accessibilityRole="button" accessibilityState={{ expanded: open === m._id }}>
            <View style={styles.flex}>
              <Text style={styles.medName}>
                {m.name}
                {m.dose ? <Text style={styles.dose}> · {m.dose}</Text> : null}
                {m.status !== "active" && <Text style={styles.status}>  {m.status === "paused" ? s.medPaused : s.medStopped}</Text>}
              </Text>
              <Text style={styles.small}>
                {describe(m.rule, s)}
                {m.nextAt ? ` · ${s.nextAt.replace("{when}", when(m.nextAt, s))}` : ""}
                {m.daysLeft !== null && m.status !== "stopped" ? ` · ${s.medDaysLeft.replace("{n}", String(m.daysLeft))}` : ""}
              </Text>
            </View>
            <Ionicons name={open === m._id ? "chevron-up" : "chevron-down"} size={18} color={colors.muted} />
          </Pressable>
          {open === m._id && <Detail id={m._id} s={s} />}
        </View>
      ))}
      {stoppedCount > 0 && (
        <Pressable onPress={() => setShowStopped(!showStopped)} accessibilityRole="button">
          <Text style={styles.link}>{(showStopped ? s.medHideStopped : s.medShowStopped).replace("{n}", String(stoppedCount))}</Text>
        </Pressable>
      )}

      {adding ? (
        <View style={styles.form}>
          <TextInput style={styles.input} placeholder={s.medPlaceholder} placeholderTextColor={colors.muted} value={name} onChangeText={setName} />
          <TextInput style={styles.input} placeholder={s.dosePlaceholder} placeholderTextColor={colors.muted} value={dose} onChangeText={setDose} />
          <View style={styles.chips}>
            {(["daily", "interval"] as const).map((m) => (
              <Pressable key={m} style={[styles.chip, mode === m && styles.chipOn]} onPress={() => setMode(m)} accessibilityRole="radio" accessibilityState={{ selected: mode === m }}>
                <Text style={[styles.chipText, mode === m && styles.chipTextOn]}>{m === "daily" ? s.atSetTimes : s.everyFewHours}</Text>
              </Pressable>
            ))}
          </View>
          {mode === "daily" ? (
            <>
              <TextInput style={styles.input} placeholder={s.timesPlaceholder} placeholderTextColor={colors.muted} value={times} onChangeText={setTimes} autoCapitalize="none" />
              {parsedTimes.length > 1 && (
                <>
                  <Text style={styles.small}>{s.medDosePerTime}</Text>
                  {parsedTimes.map((t) => (
                    <View key={t} style={styles.inline}>
                      <Text style={styles.label}>{t}</Text>
                      <TextInput style={[styles.input, styles.flex]} placeholder={dose || s.dosePlaceholder} placeholderTextColor={colors.muted} value={timeDoses[t] ?? ""} onChangeText={(d) => setTimeDoses({ ...timeDoses, [t]: d })} />
                    </View>
                  ))}
                </>
              )}
            </>
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
          <Text style={styles.small}>{s.medOptional}</Text>
          <TextInput style={styles.input} placeholder={s.medGenericPlaceholder} placeholderTextColor={colors.muted} value={genericName} onChangeText={setGenericName} />
          <FormChips value={form} onChange={setForm} s={s} />
          <TextInput style={styles.input} placeholder={s.medPrescriberPlaceholder} placeholderTextColor={colors.muted} value={prescriber} onChangeText={setPrescriber} />
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
          <Text style={styles.link}>{s.medAdd}</Text>
        </Pressable>
      )}
      {error && <Text style={styles.error}>{error}</Text>}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1, backgroundColor: "#fff" },
  panel: { padding: 16, gap: 10, maxWidth: 760, width: "100%", alignSelf: "center" },
  note: { color: colors.muted, fontSize: 14, lineHeight: 19 },
  empty: { color: colors.muted, fontStyle: "italic" },
  small: { color: colors.muted, fontSize: 13 },
  line: { color: colors.text, fontSize: 14 },
  warn: { color: colors.danger, fontWeight: "600" },
  section: { fontSize: 14, fontWeight: "700", color: colors.text, marginTop: 6 },
  flex: { flex: 1 },
  med: { borderWidth: 1, borderColor: colors.border, borderRadius: 10, padding: 10, gap: 6 },
  medInactive: { backgroundColor: colors.bg },
  medHead: { flexDirection: "row", alignItems: "center", gap: 10 },
  medName: { fontSize: 15, fontWeight: "600", color: colors.text },
  dose: { fontWeight: "400", color: colors.muted },
  status: { fontSize: 12, fontWeight: "600", color: "#92400E" },
  detail: { gap: 6, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 8 },
  form: { gap: 8 },
  input: { borderWidth: 1, borderColor: colors.border, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8, fontSize: 15, minWidth: 0 },
  short: { width: 64, textAlign: "center" },
  inline: { flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" },
  label: { color: colors.text, fontSize: 14 },
  chips: { flexDirection: "row", gap: 6, flexWrap: "wrap" },
  chip: { borderWidth: 1, borderColor: colors.border, borderRadius: 16, paddingHorizontal: 10, paddingVertical: 5 },
  chipOn: { backgroundColor: colors.primarySoft, borderColor: colors.primary },
  chipText: { color: colors.text, fontSize: 13 },
  chipTextOn: { color: colors.primary, fontWeight: "600" },
  script: { width: 96, height: 96, borderRadius: 8, backgroundColor: colors.border },
  button: { backgroundColor: colors.primary, borderRadius: 10, paddingVertical: 9, paddingHorizontal: 14 },
  buttonText: { color: "#fff", fontWeight: "600" },
  addRow: { flexDirection: "row", alignItems: "center", gap: 6, paddingVertical: 4 },
  link: { color: colors.primary, fontWeight: "600" },
  danger: { color: colors.danger },
  error: { color: colors.danger, fontSize: 13 },
});

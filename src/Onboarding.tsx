// Account setup (convex/onboarding.ts): one question per screen after someone first signs in (existing accounts too,
// once). Every step can be skipped, "Finish later" keeps what's done, and Settings can run it again. Answers already
// on the account (language, city, facts, medications, emergency contacts) start filled in. Medications can be
// typed or scanned from the pill bottle, and the ones added can be edited or removed before moving on.
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Platform, ScrollView, Switch, Text, TextInput, View } from "react-native";
import { useMutation, useQuery } from "convex/react";
import { Ionicons } from "@expo/vector-icons";
import { api } from "../convex/_generated/api";
import { colors, radius, TOUCH, ui, themed } from "./theme";
import { LANGUAGE_NAMES, Lang, strings } from "./i18n";
import { Tap } from "./Tap";
import { useHealthSync } from "./useHealthSync";
import { DoseInput } from "./DoseInput";
import { timesFor, useLabelScan } from "./labelScan";
import { Icon } from "./Icon";
import { Enter, SwapIcon } from "./Motion";
import type { Id } from "../convex/_generated/dataModel";

const FOCUS = ["symptoms", "pain", "asthma", "seizures", "diabetes", "medications", "mood", "wellness", "caregiver"] as const;
const AGES = ["under_18", "18_29", "30_44", "45_64", "65_plus"] as const;
const SEXES = ["female", "male", "other", "unspecified"] as const;
type Focus = (typeof FOCUS)[number];
// Must match MAX_CONTACTS in convex/onboarding.ts.
const MAX_CONTACTS = 10;
// An emergency contact being typed; `key` keeps each card's inputs and animation steady as cards are removed.
type ContactRow = { key: number; name: string; phone: string; relation: string };
let contactKey = 0;
const blankContact = (): ContactRow => ({ key: ++contactKey, name: "", phone: "", relation: "" });
type Step = "language" | "about" | "focus" | "conditions" | "meds" | "contact" | "city" | "phone" | "prefs";

const cleanError = (e: unknown) => (e as Error).message.replace(/^.*Uncaught Error: /, "").split("\n")[0];

function Chip({ label, on, onPress, icon }: { label: string; on: boolean; onPress: () => void; icon?: keyof typeof Ionicons.glyphMap }) {
  return (
    <Tap style={[styles.chip, on && styles.chipOn]} onPress={onPress} accessibilityRole="checkbox" accessibilityState={{ checked: on }}>
      {on ? <Ionicons name="checkmark" size={16} color={colors.primary} /> : icon ? <Ionicons name={icon} size={16} color={colors.text} /> : null}
      <Text style={[styles.chipText, on && styles.chipTextOn]}>{label}</Text>
    </Tap>
  );
}

export function Onboarding({ onDone }: { onDone: () => void }) {
  const me = useQuery(api.chat.me);
  const state = useQuery(api.onboarding.state);
  const health = useHealthSync();
  const s = strings(me?.language);

  const setLanguage = useMutation(api.chat.setLanguage);
  const setLocation = useMutation(api.chat.setLocation);
  const saveProfile = useMutation(api.onboarding.saveProfile);
  const setFocus = useMutation(api.onboarding.setFocus);
  const addFacts = useMutation(api.onboarding.addFacts);
  const setContacts = useMutation(api.onboarding.setContacts);
  const finish = useMutation(api.onboarding.finish);
  const addMed = useMutation(api.reminders.add);
  const updateMed = useMutation(api.medications.update);
  const removeMed = useMutation(api.reminders.remove);
  const setCheckins = useMutation(api.checkins.setEnabled);
  const setWeekly = useMutation(api.weekly.setEnabled);

  const steps: Step[] = ["language", "about", "focus", "conditions", "meds", "contact", "city", ...(health.supported ? (["phone"] as const) : []), "prefs"];
  const [index, setIndex] = useState(0);
  const step = steps[index];
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Answers, filled in once from what the account already has.
  const [name, setName] = useState("");
  const [age, setAge] = useState<string | null>(null);
  const [sex, setSex] = useState<string | null>(null);
  const [focus, setFocusList] = useState<Focus[]>([]);
  const [conditions, setConditions] = useState<string[]>([]);
  const [allergies, setAllergies] = useState<string[]>([]);
  const [conditionText, setConditionText] = useState("");
  const [allergyText, setAllergyText] = useState("");
  const [medName, setMedName] = useState("");
  const [medDose, setMedDose] = useState("");
  const [medTime, setMedTime] = useState("08:00");
  const [medDirections, setMedDirections] = useState("");
  // The medication being edited, or null while adding a new one.
  const [editingMed, setEditingMed] = useState<Id<"medications"> | null>(null);
  const label = useLabelScan(s, (l) => {
    setMedName(l.name);
    setMedDose(l.dose ?? "");
    setMedDirections(l.instructions ?? "");
    if (l.timesPerDay) setMedTime(timesFor(l.timesPerDay));
  });
  const [contacts, setContactRows] = useState<ContactRow[]>(() => [blankContact()]);
  // Whether the contacts were changed here, so moving on doesn't rewrite the emergency plan for nothing.
  const [contactsEdited, setContactsEdited] = useState(false);
  const [city, setCity] = useState("");
  const loaded = useRef(false);
  useEffect(() => {
    if (!state || loaded.current) return;
    loaded.current = true;
    setName(state.name);
    setAge(state.ageRange);
    setSex(state.sex);
    setFocusList(state.focus);
    setCity(state.location);
    if (state.contacts.length) {
      setContactRows(state.contacts.map((c) => ({ key: ++contactKey, name: c.name, phone: c.phone, relation: c.relation ?? "" })));
    }
  }, [state]);

  if (!state || !me) return <ActivityIndicator style={{ flex: 1 }} color={colors.primary} />;

  const toggle = <T,>(list: T[], x: T) => (list.includes(x) ? list.filter((y) => y !== x) : [...list, x]);
  const addTo = (list: string[], set: (l: string[]) => void, text: string, clear: () => void) => {
    const t = text.trim();
    if (t && !list.some((x) => x.toLowerCase() === t.toLowerCase())) set([...list, t]);
    clear();
  };

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      return true;
    } catch (e) {
      setError(cleanError(e));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const done = () => run(async () => (await finish(), onDone()));
  const advance = () => (index === steps.length - 1 ? done() : (setError(null), setIndex(index + 1)));

  // Saves this step's answers, then moves on. Steps that save as you tap (language, medications, switches) just move on.
  const next = async () => {
    const ok = await run(async () => {
      if (step === "about") await saveProfile({ name, ageRange: (age as (typeof AGES)[number]) ?? null, sex: (sex as (typeof SEXES)[number]) ?? null });
      if (step === "focus") await setFocus({ focus });
      if (step === "conditions") {
        const c = conditionText.trim() ? [...conditions, conditionText] : conditions;
        const a = allergyText.trim() ? [...allergies, allergyText] : allergies;
        if (c.length || a.length) await addFacts({ conditions: c, allergies: a });
      }
      if (step === "contact" && contactsEdited) {
        await setContacts({ contacts: contacts.map((c) => ({ name: c.name, phone: c.phone, relation: c.relation.trim() || undefined })) });
        setContactsEdited(false);
      }
      if (step === "city" && city.trim() !== state.location) await setLocation({ location: city });
    });
    if (ok) await advance();
  };

  const clearMed = () => {
    setMedName("");
    setMedDose("");
    setMedTime("08:00");
    setMedDirections("");
    setEditingMed(null);
  };

  const saveMed = () =>
    run(async () => {
      if (!medName.trim()) return;
      const times = medTime.split(/[,\s]+/).filter(Boolean);
      if (editingMed) {
        await updateMed({ id: editingMed, name: medName.trim(), dose: medDose.trim(), times, ...(medDirections.trim() && { directions: medDirections }) });
      } else {
        await addMed({ name: medName.trim(), dose: medDose.trim() || undefined, directions: medDirections.trim() || undefined, schedule: { kind: "daily", times } });
      }
      clearMed();
    });

  const editMed = (m: (typeof state.meds)[number]) => {
    setError(null);
    setEditingMed(m._id);
    setMedName(m.name);
    setMedDose(m.dose);
    setMedTime(m.times.join(", ") || "08:00");
    setMedDirections("");
  };

  const editContact = (key: number, change: Partial<ContactRow>) => {
    setContactsEdited(true);
    setContactRows(contacts.map((c) => (c.key === key ? { ...c, ...change } : c)));
  };
  const removeContact = (key: number) => {
    setContactsEdited(true);
    const left = contacts.filter((c) => c.key !== key);
    setContactRows(left.length ? left : [blankContact()]);
  };
  const lastContact = contacts[contacts.length - 1];
  const canAddContact = contacts.length < MAX_CONTACTS && !!(lastContact.name.trim() || lastContact.phone.trim());

  const source = health.name ?? "";

  return (
    <View style={styles.screen}>
      <View style={styles.top}>
        <View style={styles.topRow}>
          <Text style={styles.stepText}>{s.ob_step.replace("{n}", String(index + 1)).replace("{total}", String(steps.length))}</Text>
          <Tap onPress={() => void done()} accessibilityRole="button" disabled={busy}>
            <Text style={styles.link}>{s.ob_later}</Text>
          </Tap>
        </View>
        <View style={styles.track} accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: steps.length, now: index + 1 }}>
          <View style={[styles.fill, { width: `${((index + 1) / steps.length) * 100}%` }]} />
        </View>
      </View>

      <ScrollView style={styles.scroll} contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        {step === "language" && (
          <>
            <Text style={styles.title} accessibilityRole="header">{s.ob_langTitle}</Text>
            <View style={styles.list}>
              {(Object.keys(LANGUAGE_NAMES) as Lang[]).map((code) => (
                <Tap key={code} style={[styles.option, me.language === code && styles.optionOn]} onPress={() => void setLanguage({ language: code })} accessibilityRole="radio" accessibilityState={{ selected: me.language === code }}>
                  <Text style={[styles.optionText, me.language === code && styles.chipTextOn]}>{LANGUAGE_NAMES[code]}</Text>
                  {me.language === code && <Ionicons name="checkmark-circle" size={22} color={colors.primary} />}
                </Tap>
              ))}
            </View>
          </>
        )}

        {step === "about" && (
          <>
            <Text style={styles.title} accessibilityRole="header">{s.ob_aboutTitle}</Text>
            <Text style={styles.label}>{s.ob_name}</Text>
            <TextInput style={styles.input} value={name} onChangeText={setName} placeholder={s.ob_namePh} placeholderTextColor={colors.muted} maxLength={60} autoComplete="given-name" />
            <Text style={styles.label}>{s.ob_age}</Text>
            <View style={styles.chips}>
              {AGES.map((a) => (
                <Chip key={a} label={s[`ob_age_${a}`]} on={age === a} onPress={() => setAge(age === a ? null : a)} />
              ))}
            </View>
            <Text style={styles.label}>{s.ob_sex}</Text>
            <View style={styles.chips}>
              {SEXES.map((x) => (
                <Chip key={x} label={s[`ob_sex_${x}`]} on={sex === x} onPress={() => setSex(sex === x ? null : x)} />
              ))}
            </View>
          </>
        )}

        {step === "focus" && (
          <>
            <Text style={styles.title} accessibilityRole="header">{s.ob_focusTitle}</Text>
            <View style={styles.chips}>
              {FOCUS.map((f) => (
                <Chip key={f} label={s[`ob_focus_${f}`]} on={focus.includes(f)} onPress={() => setFocusList(toggle(focus, f))} />
              ))}
            </View>
          </>
        )}

        {step === "conditions" && (
          <>
            <Text style={styles.title} accessibilityRole="header">{s.ob_condTitle}</Text>
            {[
              { label: s.ob_conditions, list: conditions, set: setConditions, suggest: s.ob_condSuggest, text: conditionText, setText: setConditionText, ph: s.ob_conditionPh },
              { label: s.ob_allergies, list: allergies, set: setAllergies, suggest: s.ob_allergySuggest, text: allergyText, setText: setAllergyText, ph: s.ob_allergyPh },
            ].map((g) => (
              <View key={g.label} style={styles.group}>
                <Text style={styles.label}>{g.label}</Text>
                <View style={styles.chips}>
                  {[...new Set([...g.suggest, ...g.list])].map((x) => (
                    <Chip key={x} label={x} on={g.list.includes(x)} onPress={() => g.set(toggle(g.list, x))} />
                  ))}
                </View>
                <View style={styles.row}>
                  <TextInput
                    style={[styles.input, styles.flex]}
                    value={g.text}
                    onChangeText={g.setText}
                    placeholder={g.ph}
                    placeholderTextColor={colors.muted}
                    maxLength={120}
                    onSubmitEditing={() => addTo(g.list, g.set, g.text, () => g.setText(""))}
                    returnKeyType="done"
                  />
                  <Tap style={styles.smallButton} onPress={() => addTo(g.list, g.set, g.text, () => g.setText(""))} accessibilityRole="button">
                    <Text style={styles.link}>{s.ob_add}</Text>
                  </Tap>
                </View>
              </View>
            ))}
            {state.facts.length > 0 && (
              <Text style={styles.small}>
                {s.aboutMe}: {state.facts.slice(0, 6).join(" · ")}
              </Text>
            )}
          </>
        )}

        {step === "meds" && (
          <>
            <Text style={styles.title} accessibilityRole="header">{s.ob_medsTitle}</Text>
            {state.meds.map((m) => (
              <View key={m._id} style={[styles.medRow, editingMed === m._id && styles.medRowOn]}>
                <Ionicons name="checkmark-circle" size={20} color={colors.primary} />
                <View style={styles.flex}>
                  <Text style={styles.savedText} numberOfLines={1}>
                    {m.name}
                    {m.dose ? <Text style={styles.muted}> · {m.dose}</Text> : null}
                  </Text>
                  {m.times.length > 0 && <Text style={styles.small}>{m.times.join(", ")}</Text>}
                </View>
                <Tap style={styles.iconButton} onPress={() => editMed(m)} disabled={busy} accessibilityRole="button" accessibilityLabel={`${s.edit}: ${m.name}`}>
                  <Ionicons name="create-outline" size={20} color={colors.primary} />
                </Tap>
                <Tap
                  style={styles.iconButton}
                  onPress={() => void run(async () => (await removeMed({ id: m._id }), editingMed === m._id && clearMed()))}
                  disabled={busy}
                  accessibilityRole="button"
                  accessibilityLabel={`${s.remove}: ${m.name}`}
                >
                  <Ionicons name="trash-outline" size={20} color={colors.muted} />
                </Tap>
              </View>
            ))}
            {!editingMed && (
              <Tap style={ui.addButton} onPress={() => void label.scan()} disabled={label.scanning || busy} accessibilityRole="button" accessibilityState={{ busy: label.scanning }}>
                <SwapIcon id={label.scanning ? "busy" : "scan"}>
                  {label.scanning ? <ActivityIndicator color={colors.primary} /> : <Icon name="scan" size={18} color={colors.primary} />}
                </SwapIcon>
                <Text style={styles.link}>{label.scanning ? s.medScanning : s.medScan}</Text>
              </Tap>
            )}
            {label.error && <Text style={styles.error}>{label.error}</Text>}
            <Enter key={editingMed ?? "new"} style={styles.medForm} from={8}>
              <TextInput style={styles.input} value={medName} onChangeText={setMedName} placeholder={s.ob_medName} placeholderTextColor={colors.muted} maxLength={80} />
              <DoseInput value={medDose} onChange={setMedDose} s={s} />
              <View style={styles.row}>
                <Ionicons name="time-outline" size={20} color={colors.muted} />
                <TextInput style={[styles.input, styles.flex]} value={medTime} onChangeText={setMedTime} placeholder={s.ob_medTime} placeholderTextColor={colors.muted} maxLength={60} accessibilityLabel={s.ob_medTime} autoCapitalize="none" />
              </View>
              {!!medDirections && <Text style={styles.small}>{s.medFromLabel.replace("{text}", medDirections)}</Text>}
              <View style={styles.row}>
                <Tap style={[ui.addButton, styles.flex, !medName.trim() && styles.disabled]} onPress={() => void saveMed()} disabled={!medName.trim() || busy} accessibilityRole="button">
                  <Ionicons name={editingMed ? "checkmark" : "add-circle-outline"} size={18} color={colors.primary} />
                  <Text style={styles.link}>{editingMed ? s.save : s.ob_medAdd}</Text>
                </Tap>
                {(editingMed || !!medName) && (
                  <Tap style={styles.smallButton} onPress={clearMed} accessibilityRole="button">
                    <Text style={styles.skipText}>{s.cancel}</Text>
                  </Tap>
                )}
              </View>
            </Enter>
          </>
        )}

        {step === "contact" && (
          <>
            <Text style={styles.title} accessibilityRole="header">{s.ob_contactTitle}</Text>
            {contacts.map((c, i) => {
              const n = s.ob_contactN.replace("{n}", String(i + 1));
              const empty = !c.name && !c.phone && !c.relation;
              return (
                <Enter key={c.key} style={styles.contactCard} from={8}>
                  <View style={styles.contactHead}>
                    <Text style={styles.contactLabel}>{n}</Text>
                    {(contacts.length > 1 || !empty) && (
                      <Tap style={styles.iconButton} onPress={() => removeContact(c.key)} disabled={busy} accessibilityRole="button" accessibilityLabel={`${s.remove}: ${c.name.trim() || n}`}>
                        <Ionicons name="trash-outline" size={20} color={colors.muted} />
                      </Tap>
                    )}
                  </View>
                  <TextInput style={styles.input} value={c.name} onChangeText={(name) => editContact(c.key, { name })} placeholder={s.ob_contactName} placeholderTextColor={colors.muted} maxLength={80} accessibilityLabel={`${n}: ${s.ob_contactName}`} autoComplete="name" />
                  <TextInput style={styles.input} value={c.phone} onChangeText={(phone) => editContact(c.key, { phone })} placeholder={s.ob_contactPhone} placeholderTextColor={colors.muted} maxLength={40} keyboardType="phone-pad" autoComplete="tel" accessibilityLabel={`${n}: ${s.ob_contactPhone}`} />
                  <TextInput style={styles.input} value={c.relation} onChangeText={(relation) => editContact(c.key, { relation })} placeholder={s.ob_contactRelation} placeholderTextColor={colors.muted} maxLength={40} accessibilityLabel={`${n}: ${s.ob_contactRelation}`} />
                </Enter>
              );
            })}
            {contacts.length < MAX_CONTACTS && (
              <Tap
                style={[ui.addButton, !canAddContact && styles.disabled]}
                onPress={() => setContactRows([...contacts, blankContact()])}
                disabled={!canAddContact || busy}
                accessibilityRole="button"
                accessibilityState={{ disabled: !canAddContact }}
              >
                <Ionicons name="person-add-outline" size={18} color={colors.primary} />
                <Text style={styles.link}>{s.ob_contactAdd}</Text>
              </Tap>
            )}
          </>
        )}

        {step === "city" && (
          <>
            <Text style={styles.title} accessibilityRole="header">{s.ob_cityTitle}</Text>
            <TextInput style={styles.input} value={city} onChangeText={setCity} placeholder={s.locationPlaceholder} placeholderTextColor={colors.muted} maxLength={200} autoComplete="postal-code" />
          </>
        )}

        {step === "phone" && (
          <>
            <Text style={styles.title} accessibilityRole="header">{s.ob_phoneTitle}</Text>
            {health.status?.connected ? (
              <View style={styles.saved}>
                <Ionicons name="checkmark-circle" size={18} color={colors.primary} />
                <Text style={styles.savedText}>{s.ob_connected}</Text>
              </View>
            ) : (
              <Tap style={ui.addButton} onPress={() => void health.connect()} disabled={health.syncing} accessibilityRole="button">
                {health.syncing ? <ActivityIndicator color={colors.primary} /> : <Ionicons name="heart-outline" size={18} color={colors.primary} />}
                <Text style={styles.link}>{s.ob_connect.replace("{source}", source)}</Text>
              </Tap>
            )}
            {health.error && <Text style={styles.error}>{health.error}</Text>}
          </>
        )}

        {step === "prefs" && (
          <>
            <Text style={styles.title} accessibilityRole="header">{s.ob_prefsTitle}</Text>
            <View style={styles.switchRow}>
              <Text style={[styles.optionText, styles.flex]}>{s.dailyCheckins}</Text>
              <Switch value={state.checkins} onValueChange={(enabled) => void setCheckins({ enabled })} />
            </View>
            <View style={styles.switchRow}>
              <Text style={[styles.optionText, styles.flex]}>{s.weeklySummary}</Text>
              <Switch value={state.weeklySummary} onValueChange={(enabled) => void setWeekly({ enabled })} />
            </View>
          </>
        )}

        {error && <Text style={styles.error}>{error}</Text>}
      </ScrollView>

      <View style={styles.bottom}>
        <View style={styles.bottomInner}>
          {index > 0 ? (
            <Tap style={styles.back} onPress={() => (setError(null), setIndex(index - 1))} accessibilityRole="button" accessibilityLabel={s.ob_back}>
              <Ionicons name="chevron-back" size={20} color={colors.primary} />
            </Tap>
          ) : (
            <View style={styles.back} />
          )}
          {step !== "language" && step !== "prefs" && (
            <Tap style={styles.skip} onPress={() => void advance()} disabled={busy} accessibilityRole="button">
              <Text style={styles.skipText}>{s.ob_skip}</Text>
            </Tap>
          )}
          <Tap style={[ui.button, styles.next]} onPress={() => void next()} disabled={busy} accessibilityRole="button">
            {busy ? <ActivityIndicator color={colors.onPrimary} /> : <Text style={styles.nextText}>{index === steps.length - 1 ? s.ob_finish : s.ob_next}</Text>}
          </Tap>
        </View>
      </View>
    </View>
  );
}

const styles = themed(() => ({
  screen: { flex: 1, backgroundColor: colors.bg },
  top: { paddingTop: Platform.OS === "web" ? 16 : 56, paddingHorizontal: 20, paddingBottom: 12, gap: 10, backgroundColor: colors.surface, borderBottomWidth: 1, borderBottomColor: colors.border },
  topRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", maxWidth: 560, width: "100%", alignSelf: "center" },
  stepText: { color: colors.muted, fontSize: 14, fontWeight: "600" },
  track: { height: 6, borderRadius: radius.pill, backgroundColor: colors.primarySoft, overflow: "hidden", maxWidth: 560, width: "100%", alignSelf: "center" },
  fill: { height: "100%", borderRadius: radius.pill, backgroundColor: colors.primary },
  scroll: { flex: 1 },
  body: { padding: 20, gap: 12, maxWidth: 560, width: "100%", alignSelf: "center" },
  title: { fontSize: 26, lineHeight: 32, fontWeight: "700", color: colors.text, marginTop: 8 },

  label: { fontSize: 15, fontWeight: "600", color: colors.text, marginTop: 8 },
  list: { gap: 10 },
  option: { ...ui.card, flexDirection: "row", alignItems: "center", justifyContent: "space-between", minHeight: 56, paddingHorizontal: 16 },
  optionOn: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
  optionText: { fontSize: 17, color: colors.text },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { ...ui.chip, flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: colors.surface },
  chipOn: ui.chipOn,
  chipText: { fontSize: 15, color: colors.text },
  chipTextOn: { color: colors.primary, fontWeight: "600" },
  group: { gap: 8 },
  row: { flexDirection: "row", gap: 8, alignItems: "center" },
  flex: { flex: 1, minWidth: 0 },
  input: { minHeight: TOUCH, borderWidth: 1, borderColor: colors.inputBorder, borderRadius: radius.md, paddingHorizontal: 14, fontSize: 16, color: colors.text, backgroundColor: colors.surface },
  medRow: { ...ui.card, flexDirection: "row", alignItems: "center", gap: 10, paddingLeft: 12, minHeight: 56 },
  medRowOn: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
  medForm: { gap: 10 },
  contactCard: { ...ui.card, gap: 10, padding: 14 },
  contactLabel: { fontSize: 15, fontWeight: "600", color: colors.text },
  contactHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", minHeight: TOUCH, marginVertical: -6 },
  iconButton: { width: TOUCH, height: TOUCH, alignItems: "center", justifyContent: "center", borderRadius: radius.pill },
  muted: { color: colors.muted, fontWeight: "400" },
  smallButton: { minHeight: TOUCH, justifyContent: "center", paddingHorizontal: 12 },
  saved: { flexDirection: "row", alignItems: "center", gap: 8 },
  savedText: { fontSize: 16, color: colors.text },
  switchRow: { ...ui.card, flexDirection: "row", alignItems: "center", gap: 12, minHeight: 56, paddingHorizontal: 16 },
  disabled: { opacity: 0.5 },
  link: { color: colors.primary, fontWeight: "600", fontSize: 15 },
  small: { color: colors.muted, fontSize: 13, lineHeight: 18 },
  error: { color: colors.danger, fontSize: 14 },
  bottom: { borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: colors.surface, paddingHorizontal: 20, paddingTop: 12, paddingBottom: Platform.OS === "web" ? 12 : 32 },
  bottomInner: { flexDirection: "row", alignItems: "center", gap: 8, maxWidth: 560, width: "100%", alignSelf: "center" },
  back: { width: TOUCH, height: TOUCH, borderRadius: radius.pill, alignItems: "center", justifyContent: "center" },
  skip: { minHeight: TOUCH, justifyContent: "center", paddingHorizontal: 14 },
  skipText: { color: colors.muted, fontSize: 16, fontWeight: "600" },
  next: { flex: 1 },
  nextText: { color: colors.onPrimary, fontSize: 16, fontWeight: "700" },
}));

// Account setup (convex/onboarding.ts): one question per screen after someone first signs in (existing accounts too,
// once). Every step can be skipped, "Finish later" keeps what's done, and Settings can run it again. Answers already
// on the account (language, city, facts, medications, the emergency contact) start filled in.
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Platform, ScrollView, Switch, Text, TextInput, View } from "react-native";
import { useMutation, useQuery } from "convex/react";
import { Ionicons } from "@expo/vector-icons";
import { api } from "../convex/_generated/api";
import { colors, radius, TOUCH, ui, themed } from "./theme";
import { LANGUAGE_NAMES, Lang, strings } from "./i18n";
import { Tap } from "./Tap";
import { useHealthSync } from "./useHealthSync";

const FOCUS = ["symptoms", "pain", "asthma", "seizures", "medications", "mood", "wellness", "caregiver"] as const;
const AGES = ["under_18", "18_29", "30_44", "45_64", "65_plus"] as const;
const SEXES = ["female", "male", "other", "unspecified"] as const;
type Focus = (typeof FOCUS)[number];
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
  const setContact = useMutation(api.onboarding.setContact);
  const finish = useMutation(api.onboarding.finish);
  const addMed = useMutation(api.reminders.add);
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
  const [contactName, setContactName] = useState("");
  const [contactRelation, setContactRelation] = useState("");
  const [contactPhone, setContactPhone] = useState("");
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
    if (state.contact) {
      setContactName(state.contact.name);
      setContactRelation(state.contact.relation ?? "");
      setContactPhone(state.contact.phone);
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
      if (step === "contact" && (contactName.trim() || contactPhone.trim())) {
        await setContact({ name: contactName, relation: contactRelation || undefined, phone: contactPhone });
      }
      if (step === "city" && city.trim() !== state.location) await setLocation({ location: city });
    });
    if (ok) await advance();
  };

  const saveMed = () =>
    run(async () => {
      if (!medName.trim()) return;
      await addMed({ name: medName.trim(), dose: medDose.trim() || undefined, schedule: { kind: "daily", times: [medTime.trim()] } });
      setMedName("");
      setMedDose("");
    });

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
            <Text style={styles.hint}>{s.ob_langHint}</Text>
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
            <Text style={styles.hint}>{s.ob_aboutHint}</Text>
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
            <Text style={styles.hint}>{s.ob_focusHint}</Text>
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
            <Text style={styles.hint}>{s.ob_condHint}</Text>
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
            <Text style={styles.hint}>{s.ob_medsHint}</Text>
            {state.meds.map((m) => (
              <View key={m} style={styles.saved}>
                <Ionicons name="checkmark-circle" size={18} color={colors.primary} />
                <Text style={styles.savedText}>{m}</Text>
              </View>
            ))}
            <TextInput style={styles.input} value={medName} onChangeText={setMedName} placeholder={s.ob_medName} placeholderTextColor={colors.muted} maxLength={80} />
            <View style={styles.row}>
              <TextInput style={[styles.input, styles.flex]} value={medDose} onChangeText={setMedDose} placeholder={s.ob_medDose} placeholderTextColor={colors.muted} maxLength={60} />
              <TextInput style={[styles.input, styles.time]} value={medTime} onChangeText={setMedTime} placeholder={s.ob_medTime} placeholderTextColor={colors.muted} maxLength={5} accessibilityLabel={s.ob_medTime} />
            </View>
            <Tap style={[ui.addButton, !medName.trim() && styles.disabled]} onPress={() => void saveMed()} disabled={!medName.trim() || busy} accessibilityRole="button">
              <Ionicons name="add-circle-outline" size={18} color={colors.primary} />
              <Text style={styles.link}>{s.ob_medAdd}</Text>
            </Tap>
          </>
        )}

        {step === "contact" && (
          <>
            <Text style={styles.title} accessibilityRole="header">{s.ob_contactTitle}</Text>
            <Text style={styles.hint}>{s.ob_contactHint}</Text>
            <TextInput style={styles.input} value={contactName} onChangeText={setContactName} placeholder={s.ob_contactName} placeholderTextColor={colors.muted} maxLength={80} />
            <TextInput style={styles.input} value={contactRelation} onChangeText={setContactRelation} placeholder={s.ob_contactRelation} placeholderTextColor={colors.muted} maxLength={40} />
            <TextInput style={styles.input} value={contactPhone} onChangeText={setContactPhone} placeholder={s.ob_contactPhone} placeholderTextColor={colors.muted} maxLength={40} keyboardType="phone-pad" autoComplete="tel" />
          </>
        )}

        {step === "city" && (
          <>
            <Text style={styles.title} accessibilityRole="header">{s.ob_cityTitle}</Text>
            <Text style={styles.hint}>{s.ob_cityHint}</Text>
            <TextInput style={styles.input} value={city} onChangeText={setCity} placeholder={s.locationPlaceholder} placeholderTextColor={colors.muted} maxLength={200} autoComplete="postal-code" />
          </>
        )}

        {step === "phone" && (
          <>
            <Text style={styles.title} accessibilityRole="header">{s.ob_phoneTitle}</Text>
            <Text style={styles.hint}>{s.ob_phoneHint.replace("{source}", source)}</Text>
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
            <Text style={styles.hint}>{s.ob_prefsHint}</Text>
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
  hint: { fontSize: 16, lineHeight: 23, color: colors.muted, marginBottom: 4 },
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
  time: { width: 110 },
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

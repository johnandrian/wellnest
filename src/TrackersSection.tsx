// Condition trackers in the Journal tab (convex/trackers.ts): pain / CRPS, asthma and seizures, each with a quick
// form, a chart over the chosen days and the recent entries. Most people will log by just telling Wellnest in chat.
import { useState } from "react";
import { Text, TextInput, View } from "react-native";
import { Tap } from "./Tap";
import { useMutation, useQuery } from "convex/react";
import { Ionicons } from "@expo/vector-icons";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { colors, pillish, round, themed, TOUCH, ui } from "./theme";
import type { Strings } from "./i18n";
import { Icon } from "./Icon";

type Tracker = "pain" | "asthma" | "seizure";
const LOCATIONS = ["head", "neck", "shoulders", "chest", "upper_back", "lower_back", "abdomen", "hips", "left_arm", "right_arm", "left_hand", "right_hand", "left_leg", "right_leg", "left_foot", "right_foot", "whole_body"] as const;
const TYPES = ["aching", "burning", "stabbing", "throbbing", "shooting", "tingling", "cramping", "pressure"] as const;
const SYMPTOMS = ["wheeze", "cough", "chest_tightness", "breathless"] as const;
const SEIZURE_TYPES = ["focal_aware", "focal_impaired", "tonic_clonic", "absence", "myoclonic", "atonic", "unknown"] as const;
const PAIN_FLAGS = ["flare", "swelling", "colourChange", "temperatureChange", "touchSensitive"] as const;
const cleanError = (e: unknown) => (e as Error).message.replace(/^.*Uncaught Error: /, "").split("\n")[0];
const numOrUndef = (s: string) => (s.trim() && Number.isFinite(Number(s)) ? Number(s) : undefined);
const sevColor = (n: number) => (n >= 7 ? colors.danger : n >= 4 ? colors.amber : colors.mint);

function Chips<T extends string>({ items, selected, onToggle, label }: { items: readonly T[]; selected: T[]; onToggle: (x: T) => void; label: (x: T) => string }) {
  return (
    <View style={styles.chips}>
      {items.map((x) => (
        <Tap key={x} style={[styles.chip, selected.includes(x) && styles.chipOn]} onPress={() => onToggle(x)} accessibilityRole="checkbox" accessibilityState={{ checked: selected.includes(x) }}>
          <Text style={[styles.chipText, selected.includes(x) && styles.chipTextOn]}>{label(x)}</Text>
        </Tap>
      ))}
    </View>
  );
}

const toggle = <T,>(list: T[], x: T) => (list.includes(x) ? list.filter((y) => y !== x) : [...list, x]);

// One value per day as bars (the highest that day), with an optional colour per value.
function DayBars({ days, values, max, color }: { days: string[]; values: Map<string, number>; max: number; color: (v: number) => string }) {
  return (
    <View style={styles.bars}>
      {days.map((d) => {
        const v = values.get(d);
        return (
          <View key={d} style={styles.slot}>
            {v !== undefined && <View style={[styles.bar, { height: `${Math.max(6, Math.min(100, (v / max) * 100))}%`, backgroundColor: color(v) }]} />}
          </View>
        );
      })}
    </View>
  );
}

const TRACKERS = ["pain", "asthma", "seizure"] as const;
const FOCUS_OF: Record<Tracker, string> = { pain: "pain", asthma: "asthma", seizure: "seizures" };

// The trackers someone picked in setup, plus any they've already used; all three when they picked none of them.
function visibleTrackers(focus: string[], data: Partial<Record<Tracker, unknown[]>> | null | undefined, showAll: boolean): Tracker[] {
  const picked = TRACKERS.filter((t) => focus.includes(FOCUS_OF[t]) || !!data?.[t]?.length);
  return showAll || !picked.length ? [...TRACKERS] : picked;
}

export function TrackersSection({ s, days, since }: { s: Strings; days: string[]; since: string }) {
  const data = useQuery(api.trackers.view, { since });
  const me = useQuery(api.chat.me);
  const [showAll, setShowAll] = useState(false);
  const add = useMutation(api.trackers.add);
  const remove = useMutation(api.trackers.remove);
  const setBest = useMutation(api.trackers.setPeakFlowBest);
  const [tracker, setTracker] = useState<Tracker | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  // Pain form
  const [severity, setSeverity] = useState<number | null>(null);
  const [locations, setLocations] = useState<string[]>([]);
  const [types, setTypes] = useState<string[]>([]);
  const [flags, setFlags] = useState<string[]>([]);
  const [duration, setDuration] = useState("");
  const [triggers, setTriggers] = useState("");
  const [helped, setHelped] = useState("");
  // Asthma form
  const [peakFlow, setPeakFlow] = useState("");
  const [puffs, setPuffs] = useState("");
  const [preventer, setPreventer] = useState<boolean | null>(null);
  const [symptoms, setSymptoms] = useState<string[]>([]);
  const [night, setNight] = useState(false);
  const [attack, setAttack] = useState(false);
  const [best, setBestText] = useState("");
  // Seizure form
  const [seizureType, setSeizureType] = useState<string | null>(null);
  const [seconds, setSeconds] = useState("");
  const [aura, setAura] = useState("");
  const [rescue, setRescue] = useState<boolean | null>(null);
  const [recovery, setRecovery] = useState("");
  const [witness, setWitness] = useState("");
  const [note, setNote] = useState("");

  const reset = () => {
    setSeverity(null); setLocations([]); setTypes([]); setFlags([]); setDuration(""); setTriggers(""); setHelped("");
    setPeakFlow(""); setPuffs(""); setPreventer(null); setSymptoms([]); setNight(false); setAttack(false);
    setSeizureType(null); setSeconds(""); setAura(""); setRescue(null); setRecovery(""); setWitness(""); setNote("");
  };

  const save = async () => {
    if (!tracker) return;
    setError(null);
    try {
      if (tracker === "pain") {
        if (severity === null) return setError(s.trkPainNeedScore);
        await add({
          tracker,
          note: note || undefined,
          pain: {
            severity,
            locations,
            types,
            durationMin: numOrUndef(duration),
            triggers: triggers || undefined,
            helped: helped || undefined,
            ...Object.fromEntries(flags.map((f) => [f, true])),
          },
        });
      } else if (tracker === "asthma") {
        await add({
          tracker,
          note: note || undefined,
          asthma: { peakFlow: numOrUndef(peakFlow), reliever: numOrUndef(puffs), ...(preventer !== null && { preventer }), symptoms, night: night || undefined, attack: attack || undefined, triggers: triggers || undefined },
        });
      } else {
        await add({
          tracker,
          note: note || undefined,
          seizure: { ...(seizureType && { type: seizureType }), durationSec: numOrUndef(seconds), aura: aura || undefined, triggers: triggers || undefined, ...(rescue !== null && { rescueMed: rescue }), recoveryMin: numOrUndef(recovery), witness: witness || undefined },
        });
      }
      reset();
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e) {
      setError(cleanError(e));
    }
  };

  const yesNo = (value: boolean | null, set: (v: boolean | null) => void, label: string) => (
    <View style={styles.inline}>
      <Text style={styles.label}>{label}</Text>
      {[true, false].map((b) => (
        <Tap key={String(b)} style={[styles.chip, value === b && styles.chipOn]} onPress={() => set(value === b ? null : b)} accessibilityRole="radio" accessibilityState={{ selected: value === b }}>
          <Text style={[styles.chipText, value === b && styles.chipTextOn]}>{b ? s.yes : s.no}</Text>
        </Tap>
      ))}
    </View>
  );

  const painByDay = new Map<string, number>();
  for (const p of data?.pain ?? []) painByDay.set(p.date, Math.max(painByDay.get(p.date) ?? 0, p.severity));
  const bestFlow = data?.peakFlowBest ?? null;
  const flowByDay = new Map<string, number>();
  for (const a of data?.asthma ?? []) if (a.peakFlow) flowByDay.set(a.date, Math.min(flowByDay.get(a.date) ?? Infinity, a.peakFlow));
  const puffsByDay = new Map<string, number>();
  for (const a of data?.asthma ?? []) if (a.reliever) puffsByDay.set(a.date, (puffsByDay.get(a.date) ?? 0) + a.reliever);
  const seizuresByDay = new Map<string, number>();
  for (const z of data?.seizure ?? []) seizuresByDay.set(z.date, (seizuresByDay.get(z.date) ?? 0) + 1);

  const line = (t: Tracker, e: any) => {
    if (t === "pain") return [`${e.severity}/10`, e.locations.map((l: string) => s[`loc_${l}` as "loc_head"]).join(", "), e.types.map((x: string) => s[`ptype_${x}` as "ptype_aching"]).join(", "), e.flare && s.trk_flare].filter(Boolean).join(" · ");
    if (t === "asthma") return [e.attack && `⚠️ ${s.trkAttack}`, e.peakFlow && `${e.peakFlow} L/min${bestFlow ? ` (${Math.round((e.peakFlow / bestFlow) * 100)}%)` : ""}`, e.reliever !== undefined && `${e.reliever} ${s.trkPuffs}`, e.symptoms.map((x: string) => s[`asym_${x}` as "asym_wheeze"]).join(", ")].filter(Boolean).join(" · ");
    return [e.type ? s[`stype_${e.type}` as "stype_unknown"] : s.trkSeizure, e.durationSec && `${e.durationSec} s`, e.rescueMed && s.trkRescueTaken].filter(Boolean).join(" · ");
  };

  const list = tracker ? (data?.[tracker] ?? []) : [];

  return (
    <View style={styles.wrap}>
      <Text style={styles.section}>{s.trkTitle}</Text>
      <View style={styles.chips}>
        {visibleTrackers(me?.focus ?? [], data, showAll).map((t) => (
          <Tap key={t} style={[styles.tbtn, tracker === t && styles.chipOn]} onPress={() => setTracker(tracker === t ? null : t)} accessibilityRole="tab" accessibilityState={{ selected: tracker === t }}>
            <Icon name={t === "seizure" ? "seizures" : t} size={16} color={tracker === t ? colors.primary : colors.text} />
            <Text style={[styles.chipText, tracker === t && styles.chipTextOn]}>{s[`trk_${t}`]}</Text>
            {!!data?.[t].length && <Text style={styles.count}>{data[t].length}</Text>}
          </Tap>
        ))}
        {visibleTrackers(me?.focus ?? [], data, showAll).length < TRACKERS.length && (
          <Tap style={styles.tbtn} onPress={() => setShowAll(true)} accessibilityRole="button">
            <Ionicons name="add" size={16} color={colors.primary} />
            <Text style={[styles.chipText, styles.chipTextOn]}>{s.trkMore}</Text>
          </Tap>
        )}
      </View>

      {tracker === "pain" && (
        <View style={styles.form}>
          {painByDay.size > 0 && <DayBars days={days} values={painByDay} max={10} color={sevColor} />}
          <Text style={styles.label}>{s.trkPainScore}</Text>
          <View style={styles.chips}>
            {Array.from({ length: 11 }, (_, n) => (
              <Tap key={n} style={[styles.sev, severity === n && { backgroundColor: sevColor(n), borderColor: sevColor(n) }]} onPress={() => setSeverity(severity === n ? null : n)} accessibilityRole="radio" accessibilityLabel={`${n}/10`} accessibilityState={{ selected: severity === n }}>
                <Text style={[styles.sevText, severity === n && styles.sevOn]}>{n}</Text>
              </Tap>
            ))}
          </View>
          <Text style={styles.label}>{s.trkWhere}</Text>
          <Chips items={LOCATIONS} selected={locations as (typeof LOCATIONS)[number][]} onToggle={(x) => setLocations(toggle(locations, x))} label={(x) => s[`loc_${x}`]} />
          <Text style={styles.label}>{s.trkFeelsLike}</Text>
          <Chips items={TYPES} selected={types as (typeof TYPES)[number][]} onToggle={(x) => setTypes(toggle(types, x))} label={(x) => s[`ptype_${x}`]} />
          <Chips items={PAIN_FLAGS} selected={flags as (typeof PAIN_FLAGS)[number][]} onToggle={(x) => setFlags(toggle(flags, x))} label={(x) => s[`trk_${x}`]} />
          <View style={styles.inline}>
            <TextInput style={[styles.input, styles.short]} value={duration} onChangeText={setDuration} keyboardType="numeric" accessibilityLabel={s.trkMinutes} />
            <Text style={styles.label}>{s.trkMinutes}</Text>
          </View>
          <TextInput style={styles.input} placeholder={s.trkTriggers} placeholderTextColor={colors.muted} value={triggers} onChangeText={setTriggers} />
          <TextInput style={styles.input} placeholder={s.trkHelped} placeholderTextColor={colors.muted} value={helped} onChangeText={setHelped} />
        </View>
      )}

      {tracker === "asthma" && (
        <View style={styles.form}>
          {flowByDay.size > 0 && (
            <>
              <Text style={styles.small}>{s.trkPeakFlowChart}</Text>
              <DayBars days={days} values={flowByDay} max={bestFlow ?? Math.max(...flowByDay.values())} color={(v) => (!bestFlow ? colors.primary : v / bestFlow >= 0.8 ? colors.mint : v / bestFlow >= 0.5 ? colors.amber : colors.danger)} />
            </>
          )}
          {puffsByDay.size > 0 && (
            <>
              <Text style={styles.small}>{s.trkPuffsChart}</Text>
              <DayBars days={days} values={puffsByDay} max={Math.max(4, ...puffsByDay.values())} color={() => colors.sleep} />
            </>
          )}
          <View style={styles.inline}>
            <Text style={styles.label}>{s.trkBest}</Text>
            <TextInput style={[styles.input, styles.short]} value={best || (bestFlow ? String(bestFlow) : "")} onChangeText={setBestText} keyboardType="numeric" accessibilityLabel={s.trkBest} />
            <Tap onPress={() => void setBest({ value: numOrUndef(best) ?? null }).catch((e) => setError(cleanError(e)))} accessibilityRole="button">
              <Text style={styles.link}>{s.save}</Text>
            </Tap>
          </View>
          <View style={styles.inline}>
            <TextInput style={[styles.input, styles.short]} value={peakFlow} onChangeText={setPeakFlow} keyboardType="numeric" placeholder="L/min" placeholderTextColor={colors.muted} accessibilityLabel={s.trkPeakFlow} />
            <Text style={styles.label}>{s.trkPeakFlow}</Text>
            <TextInput style={[styles.input, styles.short]} value={puffs} onChangeText={setPuffs} keyboardType="numeric" accessibilityLabel={s.trkPuffs} />
            <Text style={styles.label}>{s.trkPuffs}</Text>
          </View>
          {yesNo(preventer, setPreventer, s.trkPreventer)}
          <Chips items={SYMPTOMS} selected={symptoms as (typeof SYMPTOMS)[number][]} onToggle={(x) => setSymptoms(toggle(symptoms, x))} label={(x) => s[`asym_${x}`]} />
          <View style={styles.chips}>
            <Tap style={[styles.chip, night && styles.chipOn]} onPress={() => setNight(!night)} accessibilityRole="checkbox" accessibilityState={{ checked: night }}>
              <Text style={[styles.chipText, night && styles.chipTextOn]}>{s.trkNight}</Text>
            </Tap>
            <Tap style={[styles.chip, attack && styles.attackOn]} onPress={() => setAttack(!attack)} accessibilityRole="checkbox" accessibilityState={{ checked: attack }}>
              <Text style={[styles.chipText, attack && styles.attackText]}>{s.trkAttack}</Text>
            </Tap>
          </View>
          <TextInput style={styles.input} placeholder={s.trkTriggers} placeholderTextColor={colors.muted} value={triggers} onChangeText={setTriggers} />
          <Text style={styles.small}>{s.trkAsthmaNote}</Text>
        </View>
      )}

      {tracker === "seizure" && (
        <View style={styles.form}>
          {seizuresByDay.size > 0 && <DayBars days={days} values={seizuresByDay} max={Math.max(3, ...seizuresByDay.values())} color={() => colors.seizure} />}
          <Text style={styles.small}>{s.trkSeizureSafety}</Text>
          <Chips items={SEIZURE_TYPES} selected={seizureType ? [seizureType as (typeof SEIZURE_TYPES)[number]] : []} onToggle={(x) => setSeizureType(seizureType === x ? null : x)} label={(x) => s[`stype_${x}`]} />
          <View style={styles.inline}>
            <TextInput style={[styles.input, styles.short]} value={seconds} onChangeText={setSeconds} keyboardType="numeric" accessibilityLabel={s.trkSeconds} />
            <Text style={styles.label}>{s.trkSeconds}</Text>
            <TextInput style={[styles.input, styles.short]} value={recovery} onChangeText={setRecovery} keyboardType="numeric" accessibilityLabel={s.trkRecovery} />
            <Text style={styles.label}>{s.trkRecovery}</Text>
          </View>
          {yesNo(rescue, setRescue, s.trkRescue)}
          <TextInput style={styles.input} placeholder={s.trkAura} placeholderTextColor={colors.muted} value={aura} onChangeText={setAura} />
          <TextInput style={styles.input} placeholder={s.trkTriggers} placeholderTextColor={colors.muted} value={triggers} onChangeText={setTriggers} />
          <TextInput style={[styles.input, styles.multi]} placeholder={s.trkWitness} placeholderTextColor={colors.muted} value={witness} onChangeText={setWitness} multiline />
        </View>
      )}

      {tracker && (
        <>
          <TextInput style={styles.input} placeholder={s.trkNote} placeholderTextColor={colors.muted} value={note} onChangeText={setNote} />
          <View style={styles.inline}>
            <Tap style={styles.button} onPress={() => void save()} accessibilityRole="button">
              <Text style={styles.buttonText}>{s.journalSave}</Text>
            </Tap>
            {saved && <Text style={styles.small}>✓ {s.trkSaved}</Text>}
          </View>
          {error && <Text style={styles.error}>{error}</Text>}
          {list.slice(0, 15).map((e) => (
            <View key={e._id} style={styles.entry}>
              <Text style={[styles.line, styles.flex]}>
                {new Date(e.at).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })} · {line(tracker, e)}
                {e.note ? <Text style={styles.small}> · {e.note}</Text> : null}
              </Text>
              <Tap onPress={() => void remove({ id: e._id as Id<"trackerEntries"> })} accessibilityRole="button" accessibilityLabel={s.remove}>
                <Ionicons name="close" size={18} color={colors.muted} />
              </Tap>
            </View>
          ))}
        </>
      )}
    </View>
  );
}

const styles = themed(() => ({
  wrap: { gap: 8 },
  section: { fontSize: 17, fontWeight: "700", color: colors.text, marginTop: 6 },
  form: { gap: 8 },
  label: { color: colors.text, fontSize: 14 },
  small: { color: colors.muted, fontSize: 12, lineHeight: 17 },
  line: { color: colors.text, fontSize: 14, lineHeight: 20 },
  flex: { flex: 1 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  chip: { ...ui.chip },
  chipOn: { backgroundColor: colors.primarySoft, borderColor: colors.primary },
  chipText: { color: colors.text, fontSize: 13 },
  chipTextOn: { color: colors.primary, fontWeight: "600" },
  attackOn: { backgroundColor: colors.urgentBg, borderColor: colors.danger },
  attackText: { color: colors.danger, fontWeight: "700" },
  tbtn: { ...ui.chip, flexDirection: "row", alignItems: "center", gap: 5 },
  count: { fontSize: 12, color: colors.muted },
  sev: { width: 28, height: 28, borderRadius: round(14), borderWidth: 1, borderColor: colors.border, alignItems: "center", justifyContent: "center" },
  sevText: { fontSize: 13, color: colors.text },
  sevOn: { color: colors.onPrimary, fontWeight: "700" },
  inline: { flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" },
  input: { color: colors.text, borderWidth: 1, borderColor: colors.inputBorder, backgroundColor: colors.surface, borderRadius: round(8), paddingHorizontal: 10, paddingVertical: 8, fontSize: 15, minWidth: 0 },
  short: { width: 72, textAlign: "center" },
  multi: { minHeight: 56, textAlignVertical: "top" },
  bars: { height: 56, flexDirection: "row", alignItems: "flex-end", gap: 1, backgroundColor: colors.bg, borderRadius: 4 },
  slot: { flex: 1, height: "100%", justifyContent: "flex-end" },
  bar: { borderTopLeftRadius: 2, borderTopRightRadius: 2 },
  button: { backgroundColor: colors.primary, borderRadius: pillish(10), paddingVertical: 9, paddingHorizontal: 16, minHeight: TOUCH, justifyContent: "center" },
  buttonText: { color: colors.onPrimary, fontWeight: "600", fontSize: 14 },
  link: { color: colors.primary, fontWeight: "600", fontSize: 14 },
  entry: { flexDirection: "row", alignItems: "center", gap: 8 },
  error: { color: colors.danger, fontSize: 13 },
}));

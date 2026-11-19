// Condition trackers in the Journal tab (convex/trackers.ts): pain / CRPS, asthma, seizures, and glucose, each with a
// quick form (for now or an earlier day and time), a chart over the chosen days, and the entries, which open back into
// the form to be changed. Asthma keeps the personal best peak flow in a small plan with its three zones. Most people
// will log by just telling Wellnest in chat.
import { useState } from "react";
import { Text, TextInput, View } from "react-native";
import { Tap } from "./Tap";
import { useMutation, useQuery } from "convex/react";
import { Ionicons } from "@expo/vector-icons";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { colors, severityColor, themed, TOUCH, ui, radius } from "./theme";
import { bpColor, tempColor } from "./vitalColors";
import type { Strings } from "./i18n";
import { Icon } from "./Icon";
import { DEFAULT_UNITS, FEVER_C, fmtGlucose, fmtTemp, fmtWeight, glucoseToMgdl, showGlucose, showTemp, showWeight, tempToC, weightToKg, type Units } from "../convex/lib/units";
import { errorText, removeWithUndo, showToast, useHidden } from "./feedback";
import { formatDateTime } from "./format";
import { SeverityScale } from "./SeverityScale";
import { useOfflineSend } from "./offline";
import { DateField, TimeField, dayString, timeString } from "./DateTimeField";

type Tracker = "pain" | "asthma" | "seizure" | "glucose" | "bp" | "weight" | "temperature" | "period";
const FLOWS = ["light", "medium", "heavy", "unspecified"] as const;
type Flow = (typeof FLOWS)[number];
const GLUCOSE_CONTEXTS = ["fasting", "before_meal", "after_meal", "bedtime", "other"] as const;
// Under 70 mg/dL is low; over 180 high, over 250 very high.
const glucoseColor = (mgdl: number) => (mgdl < 70 || mgdl > 250 ? colors.danger : mgdl > 180 ? colors.amber : colors.mint);
const LOCATIONS = ["head", "neck", "shoulders", "chest", "upper_back", "lower_back", "abdomen", "hips", "left_arm", "right_arm", "left_hand", "right_hand", "left_leg", "right_leg", "left_foot", "right_foot", "whole_body"] as const;
const TYPES = ["aching", "burning", "stabbing", "throbbing", "shooting", "tingling", "cramping", "pressure"] as const;
const SYMPTOMS = ["wheeze", "cough", "chest_tightness", "breathless"] as const;
const SEIZURE_TYPES = ["focal_aware", "focal_impaired", "tonic_clonic", "absence", "myoclonic", "atonic", "unknown"] as const;
const PAIN_FLAGS = ["flare", "swelling", "colourChange", "temperatureChange", "touchSensitive"] as const;
const numOrUndef = (s: string) => (s.trim() && Number.isFinite(Number(s.replace(",", "."))) ? Number(s.replace(",", ".")) : undefined);
// One decimal, for a number typed back into the form in the unit shown.
const oneDp = (n: number) => String(Math.round(n * 10) / 10);

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

// One value per day as bars (the highest that day), with an optional color per value. `min` is the bottom of the
// chart, for numbers that never get near 0 (weight, temperature).
function DayBars({ days, values, max, min = 0, color }: { days: string[]; values: Map<string, number>; max: number; min?: number; color: (v: number) => string }) {
  return (
    <View style={styles.bars}>
      {days.map((d) => {
        const v = values.get(d);
        return (
          <View key={d} style={styles.slot}>
            {v !== undefined && <View style={[styles.bar, { height: `${Math.max(6, Math.min(100, ((v - min) / Math.max(1e-9, max - min)) * 100))}%`, backgroundColor: color(v) }]} />}
          </View>
        );
      })}
    </View>
  );
}

const FIRST_ENTRIES = 15;
const CONDITIONS = ["pain", "asthma", "seizure", "glucose"] as const;
// Vitals and the period log are for everyone, so they always show.
const VITALS = ["bp", "weight", "temperature", "period"] as const;
const TRACKERS = [...CONDITIONS, ...VITALS];
const FOCUS_OF: Record<(typeof CONDITIONS)[number], string> = { pain: "pain", asthma: "asthma", seizure: "seizures", glucose: "diabetes" };
const ICON_OF = { pain: "pain", asthma: "asthma", seizure: "seizures", glucose: "glucose", bp: "bp", weight: "weight", temperature: "temperature", period: "period" } as const;

// The condition trackers someone picked in setup, plus any they've already used (all of them when they picked
// none), then the vitals.
function visibleTrackers(focus: string[], data: Partial<Record<Tracker, unknown[]>> | null | undefined, showAll: boolean): Tracker[] {
  const picked = CONDITIONS.filter((t) => focus.includes(FOCUS_OF[t]) || !!data?.[t]?.length);
  return [...(showAll || !picked.length ? CONDITIONS : picked), ...VITALS];
}

export function TrackersSection({ s, days, since }: { s: Strings; days: string[]; since: string }) {
  const data = useQuery(api.trackers.view, { since });
  const me = useQuery(api.chat.me);
  const [showAll, setShowAll] = useState(false);
  // A new entry still saves offline (./offline.tsx); changing one needs a connection.
  const offlineSend = useOfflineSend();
  const update = useMutation(api.trackers.update);
  const remove = useMutation(api.trackers.remove);
  const [editing, setEditing] = useState<string | null>(null);
  const [day, setDay] = useState(() => dayString(new Date()));
  const [clock, setClock] = useState(() => timeString(new Date()));
  const [allEntries, setAllEntries] = useState(false);
  const setBest = useMutation(api.trackers.setPeakFlowBest);
  const [tracker, setTracker] = useState<Tracker | null>(null);
  const [error, setError] = useState<string | null>(null);
  const isHidden = useHidden();

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
  // Glucose form
  const [reading, setReading] = useState("");
  const [glucoseContext, setGlucoseContext] = useState<string | null>(null);
  // Vitals forms
  const [systolic, setSystolic] = useState("");
  const [diastolic, setDiastolic] = useState("");
  const [pulse, setPulse] = useState("");
  const [weightText, setWeightText] = useState("");
  const [tempText, setTempText] = useState("");
  const [flow, setFlow] = useState<Flow | null>(null);
  const [note, setNote] = useState("");
  const units: Units = me?.units ?? DEFAULT_UNITS;

  const reset = () => {
    setSeverity(null); setLocations([]); setTypes([]); setFlags([]); setDuration(""); setTriggers(""); setHelped("");
    setPeakFlow(""); setPuffs(""); setPreventer(null); setSymptoms([]); setNight(false); setAttack(false);
    setSeizureType(null); setSeconds(""); setAura(""); setRescue(null); setRecovery(""); setWitness(""); setNote("");
    setReading(""); setGlucoseContext(null);
    setSystolic(""); setDiastolic(""); setPulse(""); setWeightText(""); setTempText(""); setFlow(null);
    setEditing(null); setDay(dayString(new Date())); setClock(timeString(new Date()));
  };

  // An entry goes back into the form to be changed.
  const startEdit = (t: Tracker, e: any) => {
    reset();
    setEditing(e._id);
    setDay(e.date);
    setClock(timeString(new Date(e.at)));
    setNote(e.note ?? "");
    setTriggers(e.triggers ?? "");
    if (t === "bp") {
      setSystolic(String(e.systolic)); setDiastolic(String(e.diastolic)); setPulse(e.pulse ? String(e.pulse) : "");
    } else if (t === "weight") {
      setWeightText(oneDp(showWeight(e.kg, units)));
    } else if (t === "temperature") {
      setTempText(oneDp(showTemp(e.c, units)));
    } else if (t === "period") {
      setFlow(e.flow);
    } else if (t === "pain") {
      setSeverity(e.severity); setLocations(e.locations ?? []); setTypes(e.types ?? []);
      setFlags(PAIN_FLAGS.filter((f) => e[f])); setDuration(e.durationMin ? String(e.durationMin) : ""); setHelped(e.helped ?? "");
    } else if (t === "asthma") {
      setPeakFlow(e.peakFlow ? String(e.peakFlow) : ""); setPuffs(e.reliever !== undefined ? String(e.reliever) : ""); setPreventer(e.preventer ?? null);
      setSymptoms(e.symptoms ?? []); setNight(!!e.night); setAttack(!!e.attack);
    } else if (t === "glucose") {
      setReading(String(showGlucose(e.value, units))); setGlucoseContext(e.context ?? null);
    } else {
      setSeizureType(e.type ?? null); setSeconds(e.durationSec ? String(e.durationSec) : ""); setAura(e.aura ?? ""); setRescue(e.rescueMed ?? null);
      setRecovery(e.recoveryMin ? String(e.recoveryMin) : ""); setWitness(e.witness ?? "");
    }
  };

  const save = async () => {
    if (!tracker) return;
    setError(null);
    // The chosen day and time, never later than now.
    const at = Math.min(Date.now(), new Date(`${day}T${clock}:00`).getTime() || Date.now());
    const when = { date: day, at };
    let queued = false;
    const send = async (details: Record<string, unknown>) => {
      if (editing) return void (await update({ id: editing as Id<"trackerEntries">, ...when, note: note || undefined, ...details }));
      queued = (await offlineSend({ fn: "trackers.add", args: { tracker, ...when, note: note || undefined, ...details } })) === "queued";
    };
    try {
      if (tracker === "pain") {
        if (severity === null) return setError(s.trkPainNeedScore);
        await send({
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
        await send({
          asthma: { peakFlow: numOrUndef(peakFlow), reliever: numOrUndef(puffs), ...(preventer !== null && { preventer }), symptoms, night: night || undefined, attack: attack || undefined, triggers: triggers || undefined },
        });
      } else if (tracker === "bp") {
        const sys = numOrUndef(systolic);
        const dia = numOrUndef(diastolic);
        if (sys === undefined || dia === undefined) return setError(s.trkBpNeed);
        await send({ bp: { systolic: sys, diastolic: dia, pulse: numOrUndef(pulse) } });
      } else if (tracker === "weight") {
        const value = numOrUndef(weightText);
        if (value === undefined) return setError(s.trkWeightNeed);
        await send({ weight: { kg: weightToKg(value, units.weight) } });
      } else if (tracker === "temperature") {
        const value = numOrUndef(tempText);
        if (value === undefined) return setError(s.trkTempNeed);
        await send({ temperature: { c: tempToC(value, units.temperature) } });
      } else if (tracker === "period") {
        await send({ period: { flow: flow ?? "unspecified" } });
      } else if (tracker === "glucose") {
        const value = numOrUndef(reading.replace(",", "."));
        if (value === undefined) return setError(s.trkGlucoseNeed);
        await send({ glucose: { value: glucoseToMgdl(value, units.glucose), ...(glucoseContext && { context: glucoseContext }) } });
      } else {
        await send({
          seizure: { ...(seizureType && { type: seizureType }), durationSec: numOrUndef(seconds), aura: aura || undefined, triggers: triggers || undefined, ...(rescue !== null && { rescueMed: rescue }), recoveryMin: numOrUndef(recovery), witness: witness || undefined },
        });
      }
      reset();
      if (!queued) showToast(editing ? s.saved : s.trkSaved);
    } catch (e) {
      setError(errorText(e));
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
  // The day's average reading, in mg/dL (colored by mg/dL, drawn in the unit shown).
  const glucoseLists = new Map<string, number[]>();
  for (const g of data?.glucose ?? []) glucoseLists.set(g.date, [...(glucoseLists.get(g.date) ?? []), g.value]);
  const glucoseByDay = new Map([...glucoseLists].map(([d, xs]) => [d, xs.reduce((a, b) => a + b, 0) / xs.length]));
  // Vitals: the day's highest blood pressure and temperature, and its last weight (lists come newest first).
  const bpByDay = new Map<string, { systolic: number; diastolic: number }>();
  for (const b of data?.bp ?? []) if (!bpByDay.has(b.date) || b.systolic > bpByDay.get(b.date)!.systolic) bpByDay.set(b.date, b);
  const weightByDay = new Map<string, number>();
  for (const w of data?.weight ?? []) if (!weightByDay.has(w.date)) weightByDay.set(w.date, showWeight(w.kg, units));
  const tempByDay = new Map<string, number>();
  for (const x of data?.temperature ?? []) tempByDay.set(x.date, Math.max(tempByDay.get(x.date) ?? 0, x.c));
  const weights = [...weightByDay.values()];
  const periodByDay = new Map<string, number>();
  const flowLevel: Record<string, number> = { heavy: 3, medium: 2 };
  for (const p of data?.period ?? []) periodByDay.set(p.date, Math.max(periodByDay.get(p.date) ?? 0, flowLevel[p.flow] ?? 1));

  const line = (t: Tracker, e: any) => {
    if (t === "bp") return [`${e.systolic}/${e.diastolic} mmHg`, e.pulse && `${s.trkPulse} ${e.pulse}`].filter(Boolean).join(" · ");
    if (t === "weight") return fmtWeight(e.kg, units, s.locale);
    if (t === "period") return e.flow === "unspecified" ? s.trk_period : `${s.trk_period} · ${s[`flow_${e.flow as Flow}`]}`;
    if (t === "temperature") return [fmtTemp(e.c, units, s.locale), e.c >= FEVER_C && s.trkFever].filter(Boolean).join(" · ");
    if (t === "pain") return [`${e.severity}/10`, e.locations.map((l: string) => s[`loc_${l}` as "loc_head"]).join(", "), e.types.map((x: string) => s[`ptype_${x}` as "ptype_aching"]).join(", "), e.flare && s.trk_flare].filter(Boolean).join(" · ");
    if (t === "asthma") return [e.attack && `⚠️ ${s.trkAttack}`, e.peakFlow && `${e.peakFlow} L/min${bestFlow ? ` (${Math.round((e.peakFlow / bestFlow) * 100)}%)` : ""}`, e.reliever !== undefined && `${e.reliever} ${s.trkPuffs}`, e.symptoms.map((x: string) => s[`asym_${x}` as "asym_wheeze"]).join(", ")].filter(Boolean).join(" · ");
    if (t === "glucose") return [fmtGlucose(e.value, units), e.context && s[`gctx_${e.context}` as "gctx_other"]].filter(Boolean).join(" · ");
    return [e.type ? s[`stype_${e.type}` as "stype_unknown"] : s.trkSeizure, e.durationSec && `${e.durationSec} s`, e.rescueMed && s.trkRescueTaken].filter(Boolean).join(" · ");
  };

  const list = tracker ? (data?.[tracker] ?? []) : [];

  return (
    <View style={styles.wrap}>
      <Text style={styles.section}>{s.trkTitle}</Text>
      <View style={styles.chips}>
        {visibleTrackers(me?.focus ?? [], data, showAll).map((t) => (
          <Tap key={t} style={[styles.tbtn, tracker === t && styles.chipOn]} onPress={() => (reset(), setAllEntries(false), setTracker(tracker === t ? null : t))} accessibilityRole="tab" accessibilityState={{ selected: tracker === t }}>
            <Icon name={ICON_OF[t]} size={16} color={tracker === t ? colors.primary : colors.text} />
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
          {painByDay.size > 0 && <DayBars days={days} values={painByDay} max={10} color={severityColor} />}
          <Text style={styles.label}>{s.trkPainScore}</Text>
          <SeverityScale value={severity} onChange={setSeverity} label={s.trkPainScore} s={s} />
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
          <View style={styles.plan}>
            <Text style={styles.planTitle}>{s.trkPlanTitle}</Text>
            <View style={styles.inline}>
              <Text style={styles.label}>{s.trkBest}</Text>
              <TextInput style={[styles.input, styles.short]} value={best || (bestFlow ? String(bestFlow) : "")} onChangeText={setBestText} keyboardType="numeric" accessibilityLabel={s.trkBest} />
              <Tap style={styles.saveBest} onPress={() => void setBest({ value: numOrUndef(best) ?? null }).then(() => (setBestText(""), showToast(s.saved)), (e) => setError(errorText(e)))} accessibilityRole="button">
                <Text style={styles.link}>{s.save}</Text>
              </Tap>
            </View>
            {bestFlow ? (
              <>
                <Zone color={colors.mint} text={s.trkZoneGreen.replace("{n}", String(Math.round(bestFlow * 0.8)))} />
                <Zone color={colors.amber} text={s.trkZoneYellow.replace("{a}", String(Math.round(bestFlow * 0.5))).replace("{b}", String(Math.round(bestFlow * 0.8)))} />
                <Zone color={colors.danger} text={s.trkZoneRed.replace("{n}", String(Math.round(bestFlow * 0.5)))} />
                <Text style={styles.small}>{s.trkPlanNote}</Text>
              </>
            ) : (
              <Text style={styles.small}>{s.trkPlanNoBest}</Text>
            )}
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

      {tracker === "glucose" && (
        <View style={styles.form}>
          {glucoseByDay.size > 0 && (
            <>
              <Text style={styles.small}>{s.trkGlucoseChart} ({units.glucose})</Text>
              <DayBars
                days={days}
                values={new Map([...glucoseByDay].map(([d, v]) => [d, showGlucose(v, units)]))}
                max={showGlucose(Math.max(250, ...glucoseByDay.values()), units)}
                color={(v) => glucoseColor(units.glucose === "mmol/L" ? glucoseToMgdl(v, "mmol/L") : v)}
              />
            </>
          )}
          <View style={styles.inline}>
            <TextInput style={[styles.input, styles.short]} value={reading} onChangeText={setReading} keyboardType="decimal-pad" placeholder={units.glucose} placeholderTextColor={colors.muted} accessibilityLabel={`${s.trkGlucoseReading} (${units.glucose})`} />
            <Text style={styles.label}>
              {s.trkGlucoseReading} ({units.glucose})
            </Text>
          </View>
          <Chips items={GLUCOSE_CONTEXTS} selected={glucoseContext ? [glucoseContext as (typeof GLUCOSE_CONTEXTS)[number]] : []} onToggle={(x) => setGlucoseContext(glucoseContext === x ? null : x)} label={(x) => s[`gctx_${x}`]} />
          <Text style={styles.small}>{s.trkGlucoseNote}</Text>
        </View>
      )}

      {tracker === "bp" && (
        <View style={styles.form}>
          {bpByDay.size > 0 && (
            <>
              <Text style={styles.small}>{s.trkBpChart}</Text>
              <DayBars
                days={days}
                values={new Map([...bpByDay].map(([d, b]) => [d, b.systolic]))}
                min={60}
                max={Math.max(180, ...[...bpByDay.values()].map((b) => b.systolic))}
                color={(v) => bpColor(v)}
              />
            </>
          )}
          <View style={styles.inline}>
            <TextInput style={[styles.input, styles.short]} value={systolic} onChangeText={setSystolic} keyboardType="numeric" placeholder="120" placeholderTextColor={colors.muted} accessibilityLabel={s.trkSystolic} />
            <Text style={styles.label}>/</Text>
            <TextInput style={[styles.input, styles.short]} value={diastolic} onChangeText={setDiastolic} keyboardType="numeric" placeholder="80" placeholderTextColor={colors.muted} accessibilityLabel={s.trkDiastolic} />
            <Text style={styles.label}>mmHg</Text>
            <TextInput style={[styles.input, styles.short]} value={pulse} onChangeText={setPulse} keyboardType="numeric" accessibilityLabel={s.trkPulse} />
            <Text style={styles.label}>{s.trkPulse}</Text>
          </View>
          <Text style={styles.small}>{s.trkBpNote}</Text>
        </View>
      )}

      {tracker === "weight" && (
        <View style={styles.form}>
          {weightByDay.size > 0 && (
            <>
              <Text style={styles.small}>
                {s.trkWeightChart} ({units.weight})
              </Text>
              <DayBars days={days} values={weightByDay} min={Math.floor(Math.min(...weights) - 2)} max={Math.ceil(Math.max(...weights) + 1)} color={() => colors.primary} />
            </>
          )}
          <View style={styles.inline}>
            <TextInput style={[styles.input, styles.short]} value={weightText} onChangeText={setWeightText} keyboardType="decimal-pad" placeholder={units.weight} placeholderTextColor={colors.muted} accessibilityLabel={`${s.trk_weight} (${units.weight})`} />
            <Text style={styles.label}>{units.weight}</Text>
          </View>
          <Text style={styles.small}>{s.trkWeightNote}</Text>
        </View>
      )}

      {tracker === "temperature" && (
        <View style={styles.form}>
          {tempByDay.size > 0 && (
            <>
              <Text style={styles.small}>
                {s.trkTempChart} (°{units.temperature})
              </Text>
              <DayBars
                days={days}
                values={new Map([...tempByDay].map(([d, c]) => [d, showTemp(c, units)]))}
                min={showTemp(35, units)}
                max={showTemp(Math.max(40, ...tempByDay.values()), units)}
                color={(v) => tempColor(tempToC(v, units.temperature))}
              />
            </>
          )}
          <View style={styles.inline}>
            <TextInput style={[styles.input, styles.short]} value={tempText} onChangeText={setTempText} keyboardType="decimal-pad" placeholder={`°${units.temperature}`} placeholderTextColor={colors.muted} accessibilityLabel={`${s.trk_temperature} (°${units.temperature})`} />
            <Text style={styles.label}>°{units.temperature}</Text>
          </View>
          <Text style={styles.small}>{s.trkTempNote}</Text>
        </View>
      )}

      {tracker === "period" && (
        <View style={styles.form}>
          {periodByDay.size > 0 && (
            <>
              <Text style={styles.small}>{s.trkPeriodChart}</Text>
              <DayBars days={days} values={periodByDay} max={3} color={() => colors.period} />
            </>
          )}
          <Text style={styles.label}>{s.trkFlow}</Text>
          <Chips items={FLOWS} selected={flow ? [flow] : []} onToggle={(x) => setFlow(flow === x ? null : x)} label={(x) => s[`flow_${x}`]} />
          <Text style={styles.small}>{s.trkPeriodNote}</Text>
        </View>
      )}

      {tracker && (
        <>
          <View style={styles.inline}>
            <Text style={styles.label}>{s.trkWhen}</Text>
            <DateField value={day} onChange={(d) => setDay(d > dayString(new Date()) ? dayString(new Date()) : d)} label={s.trkWhen} s={s} />
            <TimeField value={clock} onChange={setClock} label={s.timeLabel} s={s} />
          </View>
          <TextInput style={styles.input} placeholder={s.trkNote} placeholderTextColor={colors.muted} value={note} onChangeText={setNote} />
          <View style={styles.inline}>
            <Tap style={styles.button} onPress={() => void save()} accessibilityRole="button">
              <Text style={styles.buttonText}>{editing ? s.logSaveChanges : s.journalSave}</Text>
            </Tap>
            {editing && (
              <Tap style={styles.saveBest} onPress={reset} accessibilityRole="button">
                <Text style={styles.link}>{s.cancel}</Text>
              </Tap>
            )}
          </View>
          {error && <Text style={styles.error}>{error}</Text>}
          {(() => {
            const shown = list.filter((e) => !isHidden(e._id));
            return (
              <>
                {(allEntries ? shown : shown.slice(0, FIRST_ENTRIES)).map((e) => (
                  <View key={e._id} style={[styles.entry, editing === e._id && styles.entryOn]}>
                    <Tap style={styles.entryMain} onPress={() => startEdit(tracker, e)} accessibilityRole="button" accessibilityLabel={`${s.edit}: ${formatDateTime(e.at, s)}, ${line(tracker, e)}`}>
                      <Text style={[styles.line, styles.flex]}>
                        {formatDateTime(e.at, s)} · {line(tracker, e)}
                        {e.note ? <Text style={styles.small}> · {e.note}</Text> : null}
                      </Text>
                    </Tap>
                    <Tap
                      style={styles.iconButton}
                      onPress={() => {
                        if (editing === e._id) reset();
                        removeWithUndo({ key: e._id, text: s.removed, run: () => remove({ id: e._id as Id<"trackerEntries"> }), onError: (err) => setError(errorText(err)) });
                      }}
                      accessibilityRole="button"
                      accessibilityLabel={s.remove}
                    >
                      <Ionicons name="close" size={18} color={colors.muted} />
                    </Tap>
                  </View>
                ))}
                {shown.length > FIRST_ENTRIES && (
                  <Tap style={styles.more} onPress={() => setAllEntries(!allEntries)} accessibilityRole="button" accessibilityState={{ expanded: allEntries }}>
                    <Text style={styles.link}>{allEntries ? s.journalShowFewer : s.journalShowAll.replace("{n}", String(shown.length))}</Text>
                  </Tap>
                )}
              </>
            );
          })()}
        </>
      )}
    </View>
  );
}

function Zone({ color, text }: { color: string; text: string }) {
  return (
    <View style={styles.zone}>
      <View style={[styles.zoneDot, { backgroundColor: color }]} />
      <Text style={[styles.line, styles.flex]}>{text}</Text>
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
  inline: { flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" },
  input: { color: colors.text, borderWidth: 1, borderColor: colors.inputBorder, backgroundColor: colors.surface, borderRadius: 12, paddingHorizontal: 10, paddingVertical: 8, fontSize: 15, minWidth: 0 },
  short: { width: 72, textAlign: "center" },
  multi: { minHeight: 56, textAlignVertical: "top" },
  bars: { height: 56, flexDirection: "row", alignItems: "flex-end", gap: 1, backgroundColor: colors.bg, borderRadius: 4 },
  slot: { flex: 1, height: "100%", justifyContent: "flex-end" },
  bar: { borderTopLeftRadius: 2, borderTopRightRadius: 2 },
  button: { backgroundColor: colors.primary, borderRadius: radius.pill, paddingVertical: 9, paddingHorizontal: 16, minHeight: TOUCH, justifyContent: "center" },
  buttonText: { color: colors.onPrimary, fontWeight: "600", fontSize: 14 },
  link: { color: colors.primary, fontWeight: "600", fontSize: 14 },
  entry: { flexDirection: "row", alignItems: "center", gap: 4, borderRadius: radius.sm },
  entryOn: { backgroundColor: colors.primarySoft },
  entryMain: { flex: 1, minHeight: TOUCH, justifyContent: "center", paddingHorizontal: 4 },
  iconButton: { width: TOUCH, height: TOUCH, alignItems: "center", justifyContent: "center" },
  more: { ...ui.addButton },
  saveBest: { minHeight: TOUCH, justifyContent: "center", paddingHorizontal: 8 },
  plan: { ...ui.card, padding: 12, gap: 8 },
  planTitle: { fontSize: 15, fontWeight: "700", color: colors.text },
  zone: { flexDirection: "row", alignItems: "flex-start", gap: 8 },
  zoneDot: { width: 12, height: 12, borderRadius: 6, marginTop: 4 },
  error: { color: colors.danger, fontSize: 13 },
}));

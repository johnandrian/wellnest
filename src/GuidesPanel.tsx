// Guides: the appointment prep checklist (a week before, the day before, at the appointment, afterwards, plus extras
// for pain, asthma and seizures when those are what the user tracks). Ticks are saved on the appointment it's for
// (convex/visits.ts setChecked), next to the questions to ask written from the user's logs (convex/questions.ts).
// The same checklist, without an account, is the public /appointment-checklist page (./PublicPages.tsx).
import { useState } from "react";
import { ActivityIndicator, ScrollView, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { Tap } from "./Tap";
import { Icon } from "./Icon";
import { Enter, SwapIcon } from "./Motion";
import { colors, radius, tint, TOUCH, ui, themed } from "./theme";
import type { Strings } from "./i18n";
import type { HubTab } from "./HubPanel";

// Which condition extras go with which focus picked in account setup (src/Onboarding.tsx).
const EXTRA_FOR = ["pain", "asthma", "seizures"] as const;

const cleanError = (e: unknown) => (e as Error).message.replace(/^.*Uncaught Error: /, "").split("\n")[0];

export function checklistItems(s: Strings, extras: number[]) {
  return [
    ...s.guideSections.map((sec, i) => ({ title: sec.title, items: sec.items.map((text, j) => ({ id: `s${i}.${j}`, text })) })),
    ...extras.map((k) => ({ title: s.guideExtras[k].title, items: s.guideExtras[k].items.map((text, j) => ({ id: `x${k}.${j}`, text })) })),
  ];
}

export function Checklist({ s, extras, checked, onToggle }: { s: Strings; extras: number[]; checked: string[]; onToggle: (id: string, on: boolean) => void }) {
  const sections = checklistItems(s, extras);
  const total = sections.reduce((n, sec) => n + sec.items.length, 0);
  const done = sections.reduce((n, sec) => n + sec.items.filter((it) => checked.includes(it.id)).length, 0);
  return (
    <View style={styles.list}>
      <View style={styles.progressRow}>
        <View style={styles.track} accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: total, now: done }}>
          <View style={[styles.fill, { width: `${(done / total) * 100}%` }]} />
        </View>
        <Text style={styles.progressText}>{s.guideProgress.replace("{a}", String(done)).replace("{b}", String(total))}</Text>
      </View>
      {sections.map((sec) => (
        <View key={sec.title} style={styles.section}>
          <Text style={styles.sectionTitle} accessibilityRole="header">
            {sec.title}
          </Text>
          {sec.items.map((it) => {
            const on = checked.includes(it.id);
            return (
              <Tap key={it.id} style={styles.item} onPress={() => onToggle(it.id, !on)} accessibilityRole="checkbox" accessibilityState={{ checked: on }}>
                <SwapIcon id={on ? "on" : "off"}>
                  <Ionicons name={on ? "checkbox" : "square-outline"} size={22} color={on ? colors.primary : colors.muted} />
                </SwapIcon>
                <Text style={[styles.itemText, on && styles.itemDone]}>{it.text}</Text>
              </Tap>
            );
          })}
        </View>
      ))}
    </View>
  );
}

export function GuidesPanel({ s, onOpen }: { s: Strings; onOpen: (t: HubTab) => void }) {
  const [now] = useState(() => Date.now());
  const visits = useQuery(api.visits.list, { now });
  const me = useQuery(api.chat.me);
  const setChecked = useMutation(api.visits.setChecked).withOptimisticUpdate((store, { id, item, on }) => {
    const current = store.getQuery(api.visits.list, { now });
    if (!current) return;
    const tick = (c: string[]) => (on ? [...c.filter((x) => x !== item), item] : c.filter((x) => x !== item));
    store.setQuery(api.visits.list, { now }, { ...current, upcoming: current.upcoming.map((v) => (v._id === id ? { ...v, checked: tick(v.checked) } : v)) });
  });
  const suggest = useAction(api.questions.suggest);
  const removeQuestion = useMutation(api.questions.remove);
  const [picked, setPicked] = useState<string | null>(null);
  // Ticks while there's no appointment to keep them on.
  const [loose, setLoose] = useState<string[]>([]);
  const [suggesting, setSuggesting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (visits === undefined || me === undefined) return <ActivityIndicator style={styles.loading} color={colors.primary} />;
  const upcoming = (visits?.upcoming ?? []).filter((v) => v.source === "visit");
  const visit = upcoming.find((v) => v._id === picked) ?? upcoming[0];
  const extras = EXTRA_FOR.map((f, i) => ((me?.focus ?? []).includes(f) ? i : -1)).filter((i) => i >= 0);
  const id = visit?._id as Id<"visits"> | undefined;

  const run = async (fn: () => Promise<unknown>) => {
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(cleanError(e));
    }
  };

  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.panel}>
      <View style={styles.head}>
        <View style={[styles.headIcon, { backgroundColor: tint.guides.bg }]}>
          <Icon name="guides" size={22} color={tint.guides.fg} />
        </View>
        <Text style={styles.title} accessibilityRole="header">
          {s.guideTitle}
        </Text>
      </View>

      {visit ? (
        <>
          {upcoming.length > 1 && (
            <View style={styles.chips} accessibilityRole="radiogroup" accessibilityLabel={s.guideFor}>
              {upcoming.slice(0, 6).map((v) => {
                const on = v._id === visit._id;
                return (
                  <Tap key={v._id} style={[styles.chip, on && styles.chipOn]} onPress={() => setPicked(v._id)} accessibilityRole="radio" accessibilityState={{ selected: on }}>
                    <Text style={[styles.chipText, on && styles.chipTextOn]} numberOfLines={1}>
                      {v.title} · {new Date(v.startsAt).toLocaleDateString(s.locale, { month: "short", day: "numeric" })}
                    </Text>
                  </Tap>
                );
              })}
            </View>
          )}
          <Enter key={visit._id} style={styles.card} from={8}>
            <Text style={styles.small}>{s.guideFor}</Text>
            <Text style={styles.visitTitle}>{visit.title}</Text>
            <Text style={styles.small}>{new Date(visit.startsAt).toLocaleString(s.locale, { weekday: "long", month: "long", day: "numeric", hour: "numeric", minute: "2-digit" })}</Text>
            <Text style={[styles.sectionTitle, styles.gapTop]}>{s.guideQuestions}</Text>
            {visit.questions?.length ? (
              visit.questions.map((q, i) => (
                <View key={`${i}-${q}`} style={styles.question}>
                  <Text style={[styles.itemText, styles.flex]}>• {q}</Text>
                  <Tap onPress={() => void run(() => removeQuestion({ id: id!, index: i }))} accessibilityRole="button" accessibilityLabel={s.remove} hitSlop={8}>
                    <Ionicons name="close" size={16} color={colors.muted} />
                  </Tap>
                </View>
              ))
            ) : (
              <Text style={styles.small}>{s.guideQuestionsEmpty}</Text>
            )}
            <Tap
              style={styles.action}
              disabled={suggesting}
              onPress={() => {
                setSuggesting(true);
                void run(() => suggest({ id: id! })).finally(() => setSuggesting(false));
              }}
              accessibilityRole="button"
              accessibilityState={{ busy: suggesting }}
            >
              <SwapIcon id={suggesting ? "busy" : "idle"}>
                {suggesting ? <ActivityIndicator size="small" color={colors.primary} /> : <Ionicons name="sparkles-outline" size={16} color={colors.primary} />}
              </SwapIcon>
              <Text style={styles.link}>{visit.questions?.length ? s.visitNewQuestions : s.visitSuggestQuestions}</Text>
            </Tap>
          </Enter>
          <Checklist s={s} extras={extras} checked={visit.checked} onToggle={(item, on) => void run(() => setChecked({ id: id!, item, on }))} />
        </>
      ) : (
        <>
          <View style={styles.card}>
            <Text style={styles.itemText}>{s.guideNoVisit}</Text>
            <Tap style={ui.addButton} onPress={() => onOpen("visits")} accessibilityRole="button">
              <Ionicons name="add-circle-outline" size={18} color={colors.primary} />
              <Text style={styles.link}>{s.guideAddVisit}</Text>
            </Tap>
          </View>
          <Checklist s={s} extras={extras} checked={loose} onToggle={(item, on) => setLoose((c) => (on ? [...c, item] : c.filter((x) => x !== item)))} />
        </>
      )}
      {error && <Text style={styles.error}>{error}</Text>}
    </ScrollView>
  );
}

const styles = themed(() => ({
  loading: { flex: 1 },
  scroll: { flex: 1, backgroundColor: colors.bg },
  panel: { padding: 16, gap: 12, maxWidth: 760, width: "100%", alignSelf: "center", paddingBottom: 40 },
  head: { flexDirection: "row", alignItems: "center", gap: 12 },
  headIcon: { width: 44, height: 44, borderRadius: radius.md, alignItems: "center", justifyContent: "center" },
  title: { flex: 1, fontSize: 20, fontWeight: "700", color: colors.text },
  flex: { flex: 1 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  chip: { ...ui.chip, maxWidth: 260, backgroundColor: colors.surface },
  chipOn: ui.chipOn,
  chipText: { fontSize: 14, color: colors.text },
  chipTextOn: { color: colors.primary, fontWeight: "600" },
  card: { ...ui.card, padding: 14, gap: 6 },
  visitTitle: { fontSize: 17, fontWeight: "700", color: colors.text },
  small: { fontSize: 13, color: colors.muted, lineHeight: 18 },
  gapTop: { marginTop: 8 },
  question: { flexDirection: "row", alignItems: "flex-start", gap: 8 },
  action: { flexDirection: "row", alignItems: "center", gap: 6, minHeight: TOUCH, alignSelf: "flex-start" },
  link: { color: colors.primary, fontWeight: "600", fontSize: 14 },
  list: { gap: 12 },
  progressRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  track: { flex: 1, height: 8, borderRadius: radius.pill, backgroundColor: colors.primarySoft, overflow: "hidden" },
  fill: { height: "100%", borderRadius: radius.pill, backgroundColor: colors.primary },
  progressText: { fontSize: 13, fontWeight: "600", color: colors.muted },
  section: { ...ui.card, padding: 12, gap: 2 },
  sectionTitle: { fontSize: 16, fontWeight: "700", color: colors.text, marginBottom: 4 },
  item: { flexDirection: "row", alignItems: "center", gap: 10, minHeight: TOUCH, paddingVertical: 4 },
  itemText: { flex: 1, fontSize: 15, lineHeight: 21, color: colors.text },
  itemDone: { color: colors.muted, textDecorationLine: "line-through" },
  error: { color: colors.danger, fontSize: 14 },
}));

// /demo, open to everyone from the welcome page: the real dashboard (DashboardView) filled with four weeks of sample
// data for a made-up person with rheumatoid arthritis, made here in the browser. Nothing is sent to the server or saved; the check-in faces
// can be tapped, and the tools and chat say they open once you have an account.
import { useMemo, useRef, useState } from "react";
import { Animated, Text, useWindowDimensions, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Tap } from "./Tap";
import { Icon } from "./Icon";
import { Enter, usePresence } from "./Motion";
import { colors, floatingBar, kicker, pillish, radius, round, themed, TOUCH } from "./theme";
import type { Strings } from "./i18n";
import { DashboardView, type DashboardData, type InsightsData } from "./HomePanel";
import { DailyCardView, type DailyKey } from "./DailyCard";
import { greeting, TOOLS, type HubTab } from "./HubPanel";
import { STORIES } from "./landing";
import type { Id } from "../convex/_generated/dataModel";

const DAYS = 28;
const DAY_MS = 86_400_000;
const r1 = (n: number) => Math.round(n * 10) / 10;
const avg = (xs: number[]) => (xs.length ? r1(xs.reduce((a, b) => a + b, 0) / xs.length) : null);

function isoDate(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// The same numbers on every visit: a small seeded generator, not Math.random.
function seeded(seed: number) {
  let x = seed;
  return () => {
    x = (x * 1103515245 + 12345) % 2147483648;
    return x / 2147483648;
  };
}

// Four weeks of joint pain, mood, energy, and sleep quality for someone with rheumatoid arthritis: the welcome page's
// first story (src/landing.ts), where joint pain flares on the days air pressure drops and eases after a dose change.
// The pattern and before/after numbers are worked out here from the days shown, as the app would.
export function demoData(s: Strings, now: number): { data: DashboardData; insights: InsightsData } {
  const rand = seeded(7);
  const today = new Date(now);
  const dates = Array.from({ length: DAYS }, (_, i) => isoDate(new Date(now - (DAYS - 1 - i) * DAY_MS)));
  const story = STORIES[0];
  const pain = story.values.slice(-DAYS);
  // A flare costs a night's sleep, and mood and energy follow pain.
  const sleep = dates.map((_, i) => Math.max(1, Math.min(5, Math.round(4.2 - (pain[i] - 4) / 2.5 + (rand() - 0.5) * 1.6))));
  const mood = dates.map((_, i) => Math.max(1, Math.min(5, Math.round(3.6 - (pain[i] - 4) / 2.5 + (rand() - 0.5) * 1.6))));
  const energy = dates.map((_, i) => Math.max(1, Math.min(5, Math.round((sleep[i] + mood[i]) / 2 + (rand() - 0.5)))));
  // A few days without an answer, as in real life.
  const skip = (i: number) => i === 5 || i === 16;
  const shown = pain.map((_, i) => i).filter((i) => !skip(i));
  const num = (n: number | null) => (n ?? 0).toLocaleString(s.locale, { maximumFractionDigits: 1 });
  const onDrop = shown.filter((i) => story.marked.includes(i));
  const offDrop = shown.filter((i) => !story.marked.includes(i));
  const pattern = (text: string) =>
    text
      .replace("{a}", num(avg(onDrop.map((i) => pain[i]))))
      .replace("{b}", num(avg(offDrop.map((i) => pain[i]))))
      .replace("{n}", String(onDrop.length))
      .replace("{m}", String(offDrop.length));
  // The dose change and the two weeks either side of it.
  const before = shown.filter((i) => i < story.med && i >= story.med - 14).map((i) => pain[i]);
  const after = shown.filter((i) => i > story.med && i <= story.med + 14).map((i) => pain[i]);
  const doseDate = dates[story.med];
  const medEffect = s.demoMedEffect
    .replace("{date}", new Date(`${doseDate}T12:00:00`).toLocaleDateString(s.locale, { month: "short", day: "numeric" }))
    .replace("{after}", num(avg(after)))
    .replace("{before}", num(avg(before)));
  const doseMark = { date: doseDate, name: s.demoDoseMed, kind: "dose_changed" as const };

  const chart = (metric: DashboardData["charts"][number]["metric"], title: string, unit: string, max: number, values: number[]) => {
    const points = dates.flatMap((date, i) => (skip(i) ? [] : [{ date, value: values[i] }]));
    const week = points.filter((p) => p.date >= dates[DAYS - 7]).map((p) => p.value);
    const prev = points.filter((p) => p.date >= dates[DAYS - 14] && p.date < dates[DAYS - 7]).map((p) => p.value);
    return {
      metric,
      title,
      unit,
      from: dates[0],
      to: dates[DAYS - 1],
      points,
      max,
      worse: (metric === "pain" ? "high" : "low") as "high" | "low",
      // The dose change is marked on every chart, as on a real dashboard.
      meds: [doseMark],
      latest: points[points.length - 1],
      week: avg(week),
      prevWeek: avg(prev),
    };
  };

  const visitAt = new Date(now + 3 * DAY_MS);
  visitAt.setHours(10, 30, 0, 0);
  const nextDose = new Date(now);
  nextDose.setHours(today.getHours() < 20 ? 20 : 32, 0, 0, 0);

  return {
    data: {
      name: s.demoName,
      charts: [
        chart("pain", s.demoPain, "/10", 10, pain),
        chart("mood", s.dailyMood, "/5", 5, mood),
        chart("energy", s.dailyEnergy, "/5", 5, energy),
        chart("sleepQuality", s.dailySleep, "/5", 5, sleep),
      ] as DashboardData["charts"],
      logged: 6,
      meds: { count: 3, next: { name: s.demoMed, at: nextDose.getTime() }, taken: 12, answered: 13, lowSupply: 1 },
      visit: { _id: "demo" as Id<"visits">, title: s.demoVisit, startsAt: visitAt.getTime(), kind: "in_person", questions: s.demoQuestions },
    },
    insights: {
      patterns: [pattern(s.demoPattern)],
      medEffects: [medEffect],
      labEffects: [],
      weather: s.demoWeather,
      weatherPlace: s.demoPlace,
      tomorrow: [pattern(s.demoTomorrow)],
      hasLocation: true,
    },
  };
}

export function DemoPage({ s, onBack, onCreate }: { s: Strings; onBack: () => void; onCreate: () => void }) {
  const [now] = useState(() => Date.now());
  const { data, insights } = useMemo(() => demoData(s, now), [s, now]);
  const [checkin, setCheckin] = useState<Record<DailyKey, number | null>>({ mood: 4, energy: null, sleepQuality: 3 });
  // The tool (or the chat) someone tried to open: a card at the bottom says it needs an account.
  const [locked, setLocked] = useState<string | null>(null);
  const narrow = useWindowDimensions().width < 520;
  const label = (tab: HubTab) => TOOLS.find((t) => t.tab === tab)?.label(s) ?? s.dashboard;

  const header = (
    <View style={styles.banner}>
      <Ionicons name="information-circle-outline" size={20} color={colors.primary} />
      <Text style={[styles.bannerText, styles.flex]}>{s.demoBanner}</Text>
    </View>
  );

  return (
    <View style={styles.page}>
      <View style={styles.top}>
        <View style={styles.topRow}>
          <Tap style={styles.round} onPress={onBack} accessibilityRole="button" accessibilityLabel={s.landBack}>
            <Ionicons name="chevron-back" size={22} color={colors.onBar} />
          </Tap>
          <View style={styles.titles}>
            <Text style={styles.kicker} numberOfLines={1}>
              {s.demoTitle}
            </Text>
            <Text style={styles.title} numberOfLines={1} accessibilityRole="header">
              {greeting(s, data.name)}
            </Text>
          </View>
          <Tap style={[styles.create, narrow && styles.createNarrow]} onPress={onCreate} accessibilityRole="button" accessibilityLabel={s.landCreate}>
            <Ionicons name="person-add-outline" size={18} color={colors.onBarAction} />
            {!narrow && <Text style={styles.createText}>{s.landCreate}</Text>}
          </Tap>
        </View>
      </View>
      <Enter style={styles.flex}>
        <DashboardView
          data={data}
          insights={insights}
          now={now}
          s={s}
          demo
          header={header}
          onOpen={(tab) => setLocked(label(tab))}
          onChat={() => setLocked(s.backToChat)}
          checkin={<DailyCardView s={s} values={checkin} onPick={(k, v) => setCheckin({ ...checkin, [k]: v })} />}
        />
      </Enter>
      <Locked tool={locked} s={s} onCreate={onCreate} onClose={() => setLocked(null)} />
    </View>
  );
}

function Locked({ tool, s, onCreate, onClose }: { tool: string | null; s: Strings; onCreate: () => void; onClose: () => void }) {
  const { t, mounted } = usePresence(!!tool);
  // While it slides away, keep naming the tool it was about.
  const last = useRef(tool);
  if (tool) last.current = tool;
  if (!mounted) return null;
  return (
    <Animated.View
      style={[styles.locked, { opacity: t, transform: [{ translateY: t.interpolate({ inputRange: [0, 1], outputRange: [24, 0] }) }] }]}
      accessibilityLiveRegion="polite"
    >
      <View style={styles.lockedIcon}>
        <Icon name="dashboard" size={20} color={colors.primary} />
      </View>
      <Text style={[styles.lockedText, styles.flex]}>{s.demoLocked.replace("{tool}", last.current ?? "")}</Text>
      <Tap style={styles.lockedCreate} onPress={onCreate} accessibilityRole="button">
        <Text style={styles.lockedCreateText}>{s.landCreate}</Text>
      </Tap>
      <Tap style={styles.close} onPress={onClose} accessibilityRole="button" accessibilityLabel={s.close}>
        <Ionicons name="close" size={20} color={colors.muted} />
      </Tap>
    </Animated.View>
  );
}

const styles = themed(() => ({
  page: { flex: 1, backgroundColor: colors.bg },
  flex: { flex: 1, minWidth: 0 },
  top: { backgroundColor: colors.bar, paddingTop: 14, paddingBottom: 12, borderBottomLeftRadius: radius.lg, borderBottomRightRadius: radius.lg, ...floatingBar() },
  topRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 16 },
  round: { width: TOUCH, height: TOUCH, borderRadius: TOUCH / 2, alignItems: "center", justifyContent: "center", backgroundColor: colors.barFill },
  titles: { flex: 1, minWidth: 0 },
  kicker: { color: colors.onBarMuted, fontSize: 13, fontWeight: "600", ...kicker() },
  title: { color: colors.onBar, fontSize: 21, fontWeight: "700", marginTop: 1 },
  create: { flexDirection: "row", alignItems: "center", gap: 6, minHeight: TOUCH, borderRadius: radius.pill, paddingHorizontal: 14, backgroundColor: colors.barAction },
  createNarrow: { width: TOUCH, paddingHorizontal: 0, justifyContent: "center" },
  createText: { color: colors.onBarAction, fontWeight: "700", fontSize: 14 },
  banner: { flexDirection: "row", alignItems: "flex-start", gap: 8, padding: 12, borderRadius: radius.md, backgroundColor: colors.primarySoft, borderWidth: 1, borderColor: colors.mint },
  bannerText: { color: colors.text, fontSize: 14, lineHeight: 20 },
  locked: {
    position: "absolute",
    left: 16,
    right: 16,
    bottom: 16,
    maxWidth: 640,
    alignSelf: "center",
    marginHorizontal: "auto",
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    padding: 12,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.primary,
  },
  lockedIcon: { width: 36, height: 36, borderRadius: round(18), alignItems: "center", justifyContent: "center", backgroundColor: colors.primarySoft },
  lockedText: { color: colors.text, fontSize: 14, lineHeight: 20 },
  lockedCreate: { minHeight: TOUCH, justifyContent: "center", paddingHorizontal: 14, borderRadius: pillish(radius.md), backgroundColor: colors.primary },
  lockedCreateText: { color: colors.onPrimary, fontWeight: "700", fontSize: 14 },
  close: { width: TOUCH, height: TOUCH, alignItems: "center", justifyContent: "center" },
}));

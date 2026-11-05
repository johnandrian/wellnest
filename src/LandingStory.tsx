// The welcome page's example, next to the headline: a made-up person's four weeks, told in four beats that play in
// as the page opens. Wellnest finds the pattern (the bars, with the weather days marked), warns about tomorrow, writes
// the question for the doctor, and shows the change after a medicine. Two stories, picked with the tabs above:
// rheumatoid arthritis and air pressure, and asthma and pollen. Every beat is something the app really does.
// With reduced motion it shows the finished picture straight away.
import { ReactNode, useEffect, useRef, useState } from "react";
import { Animated, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Tap } from "./Tap";
import { Icon, IconName } from "./Icon";
import { SETTLE, useReducedMotion } from "./Motion";
import { Bezel } from "./soft";
import { colors, isSoft, kicker, pillish, radius, severityColor, tint, themed, ui } from "./theme";
import type { Strings } from "./i18n";
import { STORIES, type Story } from "./landing";

const BEATS: { icon: IconName; key: "pattern" | "forecast" | "doctor" | "proven"; tint: keyof typeof tint }[] = [
  { icon: "insights", key: "pattern", tint: "journal" },
  { icon: "weather", key: "forecast", tint: "appointments" },
  { icon: "doctor", key: "doctor", tint: "medications" },
  { icon: "medications", key: "proven", tint: "guides" },
];

export function LandingStory({ s }: { s: Strings }) {
  const [pick, setPick] = useState(0);
  const content = (
    <>
      <View style={styles.tabs} accessibilityRole="tablist">
        {s.landStories.map((st, i) => {
          const on = i === pick;
          return (
            <Tap key={st.tab} style={[styles.tab, on && styles.tabOn]} onPress={() => setPick(i)} accessibilityRole="tab" accessibilityState={{ selected: on }}>
              <Icon name={STORIES[i].icon} size={16} color={on ? colors.onPrimary : colors.primary} />
              <Text style={[styles.tabText, on && styles.tabTextOn]} numberOfLines={1}>
                {st.tab}
              </Text>
            </Tap>
          );
        })}
      </View>
      {/* A new key replays the story when the tab changes. */}
      <Played key={pick} s={s} story={STORIES[pick]} text={s.landStories[pick]} />
    </>
  );
  return isSoft() ? <Bezel core={styles.core}>{content}</Bezel> : <View style={styles.card}>{content}</View>;
}

function Played({ s, story, text }: { s: Strings; story: Story; text: Strings["landStories"][number] }) {
  const reduced = useReducedMotion();
  // The bars growing, the marked days appearing, then each beat in turn.
  const bars = useRef(new Animated.Value(0)).current;
  const marks = useRef(new Animated.Value(0)).current;
  const beats = useRef(BEATS.map(() => new Animated.Value(0))).current;
  useEffect(() => {
    const all = [bars, marks, ...beats];
    if (reduced) {
      all.forEach((v) => v.setValue(1));
      return;
    }
    const run = (v: Animated.Value, duration: number) => Animated.timing(v, { toValue: 1, duration, easing: SETTLE, useNativeDriver: false });
    const anim = Animated.sequence([run(bars, 900), run(marks, 350), Animated.stagger(420, beats.map((b) => run(b, 600)))]);
    anim.start();
    return () => anim.stop();
  }, [reduced, bars, marks, beats]);

  const n = story.values.length;
  const marked = new Set(story.marked);
  return (
    <View style={styles.body}>
      <View style={styles.legend}>
        <View style={styles.legendItem}>
          <View style={[styles.swatch, { backgroundColor: severityColor(7) }]} />
          <Text style={styles.legendText}>{text.bars}</Text>
        </View>
        <View style={styles.legendItem}>
          <Ionicons name={story.mark} size={13} color={tint.appointments.fg} />
          <Text style={styles.legendText}>{text.mark}</Text>
        </View>
      </View>
      <View style={styles.chart} accessible accessibilityLabel={`${text.bars}, ${text.mark}. ${text.pattern}`}>
        {story.values.map((v, i) => {
          // Each bar starts a little after the one before it.
          const start = (i / n) * 0.55;
          const grow = bars.interpolate({ inputRange: [start, start + 0.45], outputRange: [0, 1], extrapolate: "clamp" });
          const hit = marked.has(i);
          return (
            <View key={i} style={styles.slot}>
              {hit && <Animated.View style={[styles.band, { opacity: marks }]} />}
              <Animated.View style={[styles.marker, { opacity: hit ? marks : 0 }]}>
                <Ionicons name={story.mark} size={11} color={tint.appointments.fg} />
              </Animated.View>
              <View style={styles.barArea}>
                <Animated.View
                  style={[
                    v > 0 ? styles.bar : styles.stub,
                    v > 0 && { height: `${(v / story.max) * 100}%`, backgroundColor: severityColor((v / story.max) * 10) },
                    { transform: [{ scaleY: grow }], transformOrigin: "bottom" },
                  ]}
                />
              </View>
            </View>
          );
        })}
      </View>
      {BEATS.map((b, i) => (
        <Beat key={b.key} t={beats[i]} icon={b.icon} tintKey={b.tint} label={s.landStoryBeats[i]}>
          {text[b.key]}
        </Beat>
      ))}
    </View>
  );
}

function Beat({ t, icon, tintKey, label, children }: { t: Animated.Value; icon: IconName; tintKey: keyof typeof tint; label: string; children: ReactNode }) {
  return (
    <Animated.View style={[styles.beat, { opacity: t, transform: [{ translateY: t.interpolate({ inputRange: [0, 1], outputRange: [14, 0] }) }] }]}>
      <View style={[styles.beatIcon, { backgroundColor: tint[tintKey].bg }]}>
        <Icon name={icon} size={16} color={tint[tintKey].fg} />
      </View>
      <View style={styles.beatText}>
        <Text style={styles.beatLabel}>{label}</Text>
        <Text style={styles.beatBody}>{children}</Text>
      </View>
    </Animated.View>
  );
}

const styles = themed(() => ({
  card: { ...ui.card, padding: 16, gap: 12, borderRadius: radius.lg },
  core: { padding: 20, gap: 12 },
  tabs: { flexDirection: "row", gap: 6, flexWrap: "wrap" },
  tab: { flexDirection: "row", alignItems: "center", gap: 6, minHeight: 40, paddingHorizontal: 14, borderRadius: pillish(radius.md), borderWidth: 1, borderColor: colors.primary, backgroundColor: colors.surface },
  tabOn: { backgroundColor: colors.primary },
  tabText: { color: colors.primary, fontSize: 14, fontWeight: "700" },
  tabTextOn: { color: colors.onPrimary },
  body: { gap: 10 },
  legend: { flexDirection: "row", flexWrap: "wrap", columnGap: 14, rowGap: 4 },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 6 },
  swatch: { width: 10, height: 10, borderRadius: 3 },
  legendText: { color: colors.muted, fontSize: 12, fontWeight: "600" },
  chart: { flexDirection: "row", height: 96, gap: 2 },
  slot: { flex: 1, minWidth: 0, alignItems: "center" },
  // The marked days get a faint column, so they line up with the tall bars at a glance.
  band: { position: "absolute", top: 0, bottom: 0, left: -1, right: -1, borderRadius: 4, backgroundColor: tint.appointments.bg },
  marker: { height: 16, justifyContent: "center" },
  barArea: { flex: 1, width: "100%", justifyContent: "flex-end", paddingHorizontal: 1 },
  bar: { width: "100%", borderRadius: 3 },
  stub: { width: "100%", height: 2, borderRadius: 1, backgroundColor: colors.border },
  beat: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  beatIcon: { width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center", marginTop: 2 },
  beatText: { flex: 1, minWidth: 0 },
  beatLabel: { color: colors.muted, fontSize: 12, fontWeight: "700", ...kicker() },
  beatBody: { color: colors.text, fontSize: 14, lineHeight: 20 },
}));

// The first-time tour: after account setup, a card at the bottom walks through the real screens (the dashboard,
// logging in the journal, medications, the health tools, the chat, settings), moving the app to each one as the
// user taps Next. Skipping or finishing marks it seen (convex/onboarding.ts tourDone); Settings can play it again.
import { useEffect } from "react";
import { Animated, Platform, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Tap } from "./Tap";
import { Icon, IconName } from "./Icon";
import { Enter, usePresence } from "./Motion";
import { colors, radius, TOUCH, ui, themed } from "./theme";
import type { Strings } from "./i18n";
import type { HubTab } from "./HubPanel";

export type TourStop = { screen: "hub"; tab: HubTab } | { screen: "chat" } | { screen: "settings" };

// One stop per entry of `s.tourSteps`, in the same order.
const STOPS: { stop: TourStop; icon: IconName }[] = [
  { stop: { screen: "hub", tab: "home" }, icon: "dashboard" },
  { stop: { screen: "hub", tab: "journal" }, icon: "journal" },
  { stop: { screen: "hub", tab: "reminders" }, icon: "medications" },
  { stop: { screen: "hub", tab: "home" }, icon: "guides" },
  { stop: { screen: "chat" }, icon: "history" },
  { stop: { screen: "settings" }, icon: "dashboard" },
];

export function Tour({
  open,
  step,
  s,
  onStep,
  onShow,
  onEnd,
}: {
  open: boolean;
  step: number;
  s: Strings;
  onStep: (step: number) => void;
  // Moves the app to the screen a step is about.
  onShow: (stop: TourStop) => void;
  onEnd: () => void;
}) {
  const { t, mounted } = usePresence(open);
  useEffect(() => {
    if (open) onShow(STOPS[step].stop);
  }, [open, step]);
  if (!mounted) return null;
  const last = step === STOPS.length - 1;
  const text = s.tourSteps[step];
  const go = (n: number) => onStep(n);
  return (
    <Animated.View
      pointerEvents="box-none"
      style={[styles.wrap, { opacity: t, transform: [{ translateY: t.interpolate({ inputRange: [0, 1], outputRange: [40, 0] }) }] }]}
    >
      <View style={styles.card} accessibilityViewIsModal accessibilityLiveRegion="polite">
        <Enter key={step} style={styles.body} from={8}>
          <View style={styles.head}>
            <View style={styles.icon}>
              {step === STOPS.length - 1 ? <Ionicons name="settings-outline" size={20} color={colors.primary} /> : <Icon name={STOPS[step].icon} size={20} color={colors.primary} />}
            </View>
            <Text style={styles.count}>{s.tourStep.replace("{n}", String(step + 1)).replace("{total}", String(STOPS.length))}</Text>
            <Tap style={styles.skip} onPress={onEnd} accessibilityRole="button">
              <Text style={styles.skipText}>{s.tourSkip}</Text>
            </Tap>
          </View>
          <Text style={styles.title} accessibilityRole="header">
            {text.title}
          </Text>
          <Text style={styles.text}>{text.body}</Text>
        </Enter>
        <View style={styles.foot}>
          <View style={styles.dots}>
            {STOPS.map((_, i) => (
              <View key={i} style={[styles.dot, i === step && styles.dotOn]} />
            ))}
          </View>
          {step > 0 && (
            <Tap style={styles.back} onPress={() => go(step - 1)} accessibilityRole="button" accessibilityLabel={s.tourBack}>
              <Ionicons name="chevron-back" size={20} color={colors.primary} />
            </Tap>
          )}
          <Tap style={styles.next} onPress={() => (last ? onEnd() : go(step + 1))} accessibilityRole="button">
            <Text style={styles.nextText}>{last ? s.tourDone : s.tourNext}</Text>
            {!last && <Ionicons name="chevron-forward" size={18} color={colors.onPrimary} />}
          </Tap>
        </View>
      </View>
    </Animated.View>
  );
}

const styles = themed(() => ({
  wrap: { position: "absolute", left: 0, right: 0, bottom: 0, zIndex: 30, paddingHorizontal: 12, paddingBottom: Platform.OS === "web" ? 16 : 36, alignItems: "center" },
  card: { ...ui.card, width: "100%", maxWidth: 520, padding: 16, gap: 14, borderRadius: radius.lg, borderColor: colors.primary },
  body: { gap: 6 },
  head: { flexDirection: "row", alignItems: "center", gap: 10 },
  icon: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center", backgroundColor: colors.primarySoft },
  count: { flex: 1, fontSize: 13, fontWeight: "600", color: colors.muted },
  skip: { minHeight: TOUCH, justifyContent: "center", paddingHorizontal: 8 },
  skipText: { fontSize: 15, fontWeight: "600", color: colors.muted },
  title: { fontSize: 19, fontWeight: "700", color: colors.text },
  text: { fontSize: 15, lineHeight: 22, color: colors.text },
  foot: { flexDirection: "row", alignItems: "center", gap: 8 },
  dots: { flex: 1, flexDirection: "row", gap: 6 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.border },
  dotOn: { width: 20, backgroundColor: colors.primary },
  back: { width: TOUCH, height: TOUCH, borderRadius: radius.pill, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: colors.inputBorder },
  next: { ...ui.button, flexDirection: "row", gap: 4, paddingHorizontal: 20 },
  nextText: { color: colors.onPrimary, fontSize: 16, fontWeight: "700" },
}));

// Small animations: the chat's "thinking" dots and the ring that pulses around the mic while recording; panels and
// drawers that slide or fade in and out (usePresence, Reveal, Enter); and icons that spin into the next icon (SwapIcon).
// Everything is instant when the phone or browser asks for reduced motion.
import { ReactNode, useEffect, useRef, useState } from "react";
import { AccessibilityInfo, Animated, Easing, Platform, StyleProp, StyleSheet, View, ViewStyle } from "react-native";
import { colors, themed } from "./theme";

const native = Platform.OS !== "web";

export function ThinkingDots() {
  const dots = useRef([0, 1, 2].map(() => new Animated.Value(0.3))).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.stagger(
        160,
        dots.map((d) =>
          Animated.sequence([
            Animated.timing(d, { toValue: 1, duration: 320, easing: Easing.out(Easing.quad), useNativeDriver: native }),
            Animated.timing(d, { toValue: 0.3, duration: 320, easing: Easing.in(Easing.quad), useNativeDriver: native }),
          ]),
        ),
      ),
    );
    loop.start();
    return () => loop.stop();
  }, [dots]);
  return (
    <View style={styles.dots} accessibilityLabel="Thinking" accessibilityRole="progressbar">
      {dots.map((d, i) => (
        <Animated.View
          key={i}
          style={[styles.dot, { opacity: d, transform: [{ translateY: d.interpolate({ inputRange: [0.3, 1], outputRange: [0, -3] }) }] }]}
        />
      ))}
    </View>
  );
}

// A ring that grows and fades behind its parent, sized to fill it (parent needs position: relative).
export function PulseRing({ color, style }: { color: string; style?: ViewStyle }) {
  const t = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(t, { toValue: 1, duration: 1200, easing: Easing.out(Easing.ease), useNativeDriver: native }),
    );
    loop.start();
    return () => loop.stop();
  }, [t]);
  return (
    <Animated.View
      pointerEvents="none"
      style={[
        StyleSheet.absoluteFill,
        style,
        {
          backgroundColor: color,
          opacity: t.interpolate({ inputRange: [0, 1], outputRange: [0.45, 0] }),
          transform: [{ scale: t.interpolate({ inputRange: [0, 1], outputRange: [1, 1.7] }) }],
        },
      ]}
    />
  );
}

// The system's "reduce motion" setting, kept up to date.
export function useReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    void AccessibilityInfo.isReduceMotionEnabled().then(setReduced).catch(() => {});
    const sub = AccessibilityInfo.addEventListener("reduceMotionChanged", setReduced);
    return () => sub.remove();
  }, []);
  return reduced;
}

// Entering eases out, leaving is quicker and eases in, so things arrive softly and get out of the way.
const ENTER_MS = 260;
const EXIT_MS = 180;

// 0 (gone) to 1 (shown) for something that opens and closes. `mounted` stays true until the closing animation ends.
export function usePresence(open: boolean) {
  const reduced = useReducedMotion();
  const t = useRef(new Animated.Value(open ? 1 : 0)).current;
  const [mounted, setMounted] = useState(open);
  useEffect(() => {
    if (open) setMounted(true);
    const anim = Animated.timing(t, {
      toValue: open ? 1 : 0,
      duration: reduced ? 0 : open ? ENTER_MS : EXIT_MS,
      easing: open ? Easing.out(Easing.cubic) : Easing.in(Easing.cubic),
      useNativeDriver: native,
    });
    anim.start(({ finished }) => {
      if (finished && !open) setMounted(false);
    });
    return () => anim.stop();
  }, [open, reduced, t]);
  return { t, mounted };
}

// A panel that drops open under the header and folds away again. While closing it keeps showing what it last showed.
export function Reveal({ open, children, style }: { open: boolean; children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const { t, mounted } = usePresence(open);
  const last = useRef(children);
  if (open) last.current = children;
  if (!mounted) return null;
  return (
    <Animated.View
      style={[
        style,
        { opacity: t, transform: [{ translateY: t.interpolate({ inputRange: [0, 1], outputRange: [-14, 0] }) }, { scale: t.interpolate({ inputRange: [0, 1], outputRange: [0.98, 1] }) }] },
      ]}
    >
      {open ? children : last.current}
    </Animated.View>
  );
}

// Fades and lifts its content in when it first appears (a screen, a tool). Give it a new `key` to play it again.
// `fromX` slides it in sideways instead, for moving between the dashboard and the chat.
export function Enter({ children, style, from = 16, fromX }: { children: ReactNode; style?: StyleProp<ViewStyle>; from?: number; fromX?: number }) {
  const reduced = useReducedMotion();
  const t = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(t, { toValue: 1, duration: reduced ? 0 : 300, easing: Easing.out(Easing.cubic), useNativeDriver: native }).start();
  }, [reduced, t]);
  return (
    <Animated.View
      style={[
        style,
        { opacity: t, transform: [fromX !== undefined ? { translateX: t.interpolate({ inputRange: [0, 1], outputRange: [fromX, 0] }) } : { translateY: t.interpolate({ inputRange: [0, 1], outputRange: [from, 0] }) }] },
      ]}
    >
      {children}
    </Animated.View>
  );
}

// Swaps one icon for another with a quick spin and pop whenever `id` changes (gear to close, circle to tick).
export function SwapIcon({ id, children }: { id: string; children: ReactNode }) {
  const reduced = useReducedMotion();
  const t = useRef(new Animated.Value(1)).current;
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    t.setValue(0);
    Animated.spring(t, { toValue: 1, friction: 6, tension: 140, useNativeDriver: native }).start();
    if (reduced) t.setValue(1);
  }, [id, reduced, t]);
  return (
    <Animated.View
      style={{
        opacity: t.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0, 1, 1], extrapolate: "clamp" }),
        transform: [{ rotate: t.interpolate({ inputRange: [0, 1], outputRange: ["-90deg", "0deg"] }) }, { scale: t.interpolate({ inputRange: [0, 1], outputRange: [0.5, 1] }) }],
      }}
    >
      {children}
    </Animated.View>
  );
}

const styles = themed(() => ({
  dots: { flexDirection: "row", gap: 5, paddingVertical: 4, paddingHorizontal: 2 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.muted },
}));

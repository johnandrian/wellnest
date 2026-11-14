// The Wellnest bird mark, which sings: while the pointer rests on it (web), little purple music notes float up from its
// beak, one after another. On a phone a tap plays one note. With reduced motion the note just appears beside the beak.
// Wrap the mark and its name in SingingBrand so hovering or tapping the words makes it sing too.
import { createContext, ReactNode, useContext, useEffect, useRef, useState } from "react";
import { Animated, Easing, Image, ImageStyle, Platform, Pressable, StyleProp, View, ViewStyle } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors, themed } from "./theme";
import { useReducedMotion } from "./Motion";

const native = Platform.OS !== "web";
const NOTE_MS = 1100;

// Where the beak's tip sits in wellnest-mark.png, as a fraction of its width and height.
const BEAK_X = 0.69;
const BEAK_Y = 0.36;

// What a surrounding SingingBrand tells the mark: whether the pointer is over it, and a count that goes up on each tap.
const Song = createContext<{ singing: boolean; taps: number } | null>(null);

function useSong() {
  const [singing, setSinging] = useState(false);
  const [taps, setTaps] = useState(0);
  const handlers = {
    onHoverIn: () => setSinging(true),
    onHoverOut: () => setSinging(false),
    onPress: () => setTaps((n) => n + 1),
  };
  return { song: { singing, taps }, handlers };
}

// A row holding the mark and the words beside it; the pointer anywhere on it makes the mark sing.
export function SingingBrand({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const { song, handlers } = useSong();
  return (
    <Pressable {...handlers} accessible={false} focusable={false} style={style}>
      <Song.Provider value={song}>{children}</Song.Provider>
    </Pressable>
  );
}

export function SingingMark({ size, style }: { size: number; style?: StyleProp<ImageStyle> }) {
  const outer = useContext(Song);
  const own = useSong();
  const { singing, taps } = outer ?? own.song;
  const reduced = useReducedMotion();
  const t = useRef(new Animated.Value(0)).current; // one note's flight, 0 to 1
  const on = useRef(new Animated.Value(0)).current; // fades the whole thing out when singing stops

  useEffect(() => {
    if (!singing) {
      const out = Animated.timing(on, { toValue: 0, duration: reduced ? 0 : 160, useNativeDriver: native });
      out.start();
      return () => out.stop();
    }
    on.setValue(1);
    if (reduced) {
      t.setValue(0.5);
      return;
    }
    t.setValue(0);
    const loop = Animated.loop(Animated.timing(t, { toValue: 1, duration: NOTE_MS, easing: Easing.out(Easing.quad), useNativeDriver: native }));
    loop.start();
    return () => loop.stop();
  }, [singing, reduced, on, t]);

  // A tap on a phone (no hover there) plays a single note.
  useEffect(() => {
    if (!taps || !native || reduced) return;
    on.setValue(1);
    t.setValue(0);
    Animated.timing(t, { toValue: 1, duration: NOTE_MS, easing: Easing.out(Easing.quad), useNativeDriver: native }).start();
  }, [taps, reduced, on, t]);

  const note = Math.max(13, Math.round(size * 0.34));
  const rise = Math.max(12, size * 0.45);
  const opacity = reduced
    ? on
    : Animated.multiply(on, t.interpolate({ inputRange: [0, 0.15, 0.65, 1], outputRange: [0, 1, 1, 0] }));

  const body = (
    <>
      <Image source={require("../assets/wellnest-mark.png")} style={[{ width: size, height: size }, style]} accessibilityIgnoresInvertColors />
      <View pointerEvents="none" style={[styles.anchor, { left: size * BEAK_X, top: size * BEAK_Y - note }]}>
        <Animated.View
          style={{
            opacity,
            transform: [
              { translateX: t.interpolate({ inputRange: [0, 1], outputRange: [0, note * 0.55] }) },
              { translateY: t.interpolate({ inputRange: [0, 1], outputRange: [note * 0.2, -rise] }) },
              { rotate: t.interpolate({ inputRange: [0, 0.5, 1], outputRange: ["-14deg", "10deg", "-6deg"] }) },
              { scale: t.interpolate({ inputRange: [0, 0.25, 1], outputRange: [0.5, 1.05, 0.9] }) },
            ],
          }}
        >
          <Ionicons name="musical-note" size={note} color={colors.note} />
        </Animated.View>
      </View>
    </>
  );

  // Inside a SingingBrand the row already listens for the pointer; on its own the mark listens itself.
  if (outer) return <View style={{ width: size, height: size }}>{body}</View>;
  return (
    <Pressable {...own.handlers} accessible={false} focusable={false} style={{ width: size, height: size }}>
      {body}
    </Pressable>
  );
}

const styles = themed(() => ({
  anchor: { position: "absolute" as const, zIndex: 2 },
}));

// Building blocks for the soft design of the welcome page and the free tools (see src/design.ts):
// - Bezel: a card sitting in a slightly darker tray with a hairline edge, both with matching rounded corners.
// - Pill: a rounded button whose arrow sits in its own small circle; on the web the circle nudges up and right on
//   hover and the whole button presses in a little.
// - Eyebrow: the small capital-letter tag above a heading.
// - useSoftFonts: loads Plus Jakarta Sans, bundled with the app (no request to Google).
import { ReactNode } from "react";
import { Platform, Pressable, StyleProp, Text, View, ViewStyle } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import {
  useFonts,
  PlusJakartaSans_400Regular,
  PlusJakartaSans_500Medium,
  PlusJakartaSans_600SemiBold,
  PlusJakartaSans_700Bold,
  PlusJakartaSans_800ExtraBold,
} from "@expo-google-fonts/plus-jakarta-sans";
import { colors, themed } from "./theme";

const web = Platform.OS === "web";

// True once the font has loaded (or failed to, so the app still opens), or straight away when it isn't needed.
export function useSoftFonts(needed: boolean) {
  const [loaded, error] = useFonts(
    needed ? { PlusJakartaSans_400Regular, PlusJakartaSans_500Medium, PlusJakartaSans_600SemiBold, PlusJakartaSans_700Bold, PlusJakartaSans_800ExtraBold } : {},
  );
  return !needed || loaded || !!error;
}

// Text weights; themed() (src/theme.ts) gives each the Plus Jakarta Sans file for that weight.
export const font = {
  regular: { fontWeight: "400" as const },
  medium: { fontWeight: "500" as const },
  semibold: { fontWeight: "600" as const },
  bold: { fontWeight: "700" as const },
  heavy: { fontWeight: "800" as const },
};

export const SHELL_RADIUS = 32;
const SHELL_PAD = 6;

// A wide, faint shadow: the card floats rather than sits.
export const floating = () =>
  Platform.select({
    web: { boxShadow: `0 30px 60px -30px ${colors.glow}, 0 8px 24px -12px ${colors.hairline}` },
    default: { shadowColor: colors.glow, shadowOpacity: 1, shadowRadius: 24, shadowOffset: { width: 0, height: 16 }, elevation: 2 },
  }) as object;

// Web-only: ease changes of these properties along the settling curve.
export const settle = (props: string, ms = 500) => (web ? ({ transitionProperty: props, transitionDuration: `${ms}ms`, transitionTimingFunction: "cubic-bezier(0.32, 0.72, 0, 1)" } as object) : {});

export function Bezel({ children, style, core, tone = "surface" }: { children: ReactNode; style?: StyleProp<ViewStyle>; core?: StyleProp<ViewStyle>; tone?: "surface" | "primary" }) {
  return (
    <View style={[styles.shell, style]}>
      <View style={[styles.core, tone === "primary" && styles.corePrimary, core]}>{children}</View>
    </View>
  );
}

export function Eyebrow({ text, onPrimary }: { text: string; onPrimary?: boolean }) {
  return (
    <View style={[styles.eyebrow, onPrimary && styles.eyebrowOnPrimary]}>
      <Text style={[styles.eyebrowText, onPrimary && styles.eyebrowTextOnPrimary]}>{text}</Text>
    </View>
  );
}

type Kind = "primary" | "quiet" | "light";

export function Pill({
  label,
  onPress,
  kind = "primary",
  icon = "arrow-forward",
  role = "button",
  disabled,
  style,
}: {
  label: string;
  onPress: () => void;
  kind?: Kind;
  icon?: keyof typeof Ionicons.glyphMap;
  role?: "button" | "link";
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const fg = kind === "primary" ? colors.onPrimary : kind === "light" ? colors.primary : colors.text;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole={role}
      accessibilityState={{ disabled }}
      style={(state) => {
        const hovered = (state as { hovered?: boolean }).hovered && !disabled;
        return [styles.pill, styles[kind], hovered && styles[`${kind}Hover`], state.pressed && styles.pressed, disabled && styles.disabled, style];
      }}
    >
      {(state) => {
        const hovered = (state as { hovered?: boolean }).hovered && !disabled;
        return (
          <>
            <Text style={[styles.pillText, { color: fg }]}>{label}</Text>
            <View style={[styles.circle, kind === "primary" ? styles.circlePrimary : kind === "light" ? styles.circleLight : styles.circleQuiet, hovered && styles.circleHover]}>
              <Ionicons name={icon} size={16} color={fg} />
            </View>
          </>
        );
      }}
    </Pressable>
  );
}

const styles = themed(() => ({
  shell: { padding: SHELL_PAD, borderRadius: SHELL_RADIUS, backgroundColor: colors.shell, borderWidth: 1, borderColor: colors.hairline, ...floating() },
  core: {
    flex: 1,
    borderRadius: SHELL_RADIUS - SHELL_PAD,
    backgroundColor: colors.surface,
    padding: 24,
    ...(web ? ({ boxShadow: `inset 0 1px 1px ${colors.highlight}` } as object) : {}),
  },
  corePrimary: { backgroundColor: colors.primary, ...(web ? ({ boxShadow: `inset 0 1px 1px ${colors.onPrimaryCircle}` } as object) : {}) },

  eyebrow: { alignSelf: "flex-start", borderRadius: 999, paddingHorizontal: 12, paddingVertical: 5, backgroundColor: colors.primarySoft, borderWidth: 1, borderColor: colors.hairline },
  eyebrowOnPrimary: { backgroundColor: colors.onPrimaryCircle, borderColor: colors.onPrimaryCircle },
  eyebrowText: { ...font.semibold, fontSize: 11, letterSpacing: 2, textTransform: "uppercase", color: colors.primary },
  eyebrowTextOnPrimary: { color: colors.onPrimary },

  pill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    minHeight: 52,
    paddingLeft: 24,
    paddingRight: 6,
    borderRadius: 999,
    alignSelf: "flex-start",
    ...settle("transform, background-color, box-shadow"),
  },
  pillText: { ...font.bold, fontSize: 16 },
  primary: { backgroundColor: colors.primary, ...floating() },
  primaryHover: { transform: [{ translateY: -1 }] },
  quiet: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.hairline },
  quietHover: { backgroundColor: colors.primarySoft },
  light: { backgroundColor: colors.surface },
  lightHover: { transform: [{ translateY: -1 }] },
  pressed: { transform: [{ scale: 0.98 }] },
  disabled: { opacity: 0.5 },
  circle: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center", ...settle("transform") },
  circlePrimary: { backgroundColor: colors.onPrimaryCircle },
  circleLight: { backgroundColor: colors.primarySoft },
  circleQuiet: { backgroundColor: colors.shell },
  circleHover: { transform: [{ translateX: 3 }, { translateY: -1 }, { scale: 1.05 }] },
}));

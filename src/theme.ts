// Colours, shapes and text size for the whole app, in a light and a dark version.
// `colors` and `tint` are swapped in place by applyTheme (App.tsx, from the user's Appearance settings), and styles
// made with themed() are rebuilt on the next render, with every fontSize and lineHeight scaled to the chosen text size.
import { Platform, StyleSheet } from "react-native";

const LIGHT = {
  bg: "#F5F7FA",
  surface: "#FFFFFF", // cards on the page background
  text: "#111827",
  muted: "#4B5563", // 6.6:1 or better on every background here (WCAG AA for body text)
  border: "#E2E6EB", // card outlines (decorative)
  inputBorder: "#858E9C", // form field outlines, 3.3:1 on white (WCAG non-text contrast)
  primary: "#0B5D57", // Wellnest deep teal (the logo's wordmark is #054946)
  onPrimary: "#FFFFFF",
  primarySoft: "#E4F4EC", // light mint
  mint: "#81C9AA", // the logo's bubble
  bubbleUser: "#0B5D57",
  bubbleBot: "#FFFFFF",
  danger: "#B91C1C",
  onDanger: "#FFFFFF",
  dangerBorder: "#FCA5A5",
  dangerSoft: "#FEE2E2",
  urgentBg: "#FEF2F2",
  successSoft: "#DCFCE7",
  amber: "#D97706", // chart fills only (3.2:1); use warningText for words
  warningSoft: "#FEF3C7",
  warningText: "#92400E",
  sleep: "#6366F1",
  seizure: "#7C3AED",
  period: "#E5484D",
  heart: "#E5484D",
  codeBg: "#F3F4F6",
  // On the teal header band: the translucent fill behind its round buttons and tabs.
  onPrimaryFill: "rgba(255, 255, 255, 0.16)",
  backdrop: "rgba(17, 24, 39, 0.35)",
};
export type Palette = typeof LIGHT;

// Dark: the same roles, checked for the same contrast. Teal turns light, so text on it turns dark.
const DARK: Palette = {
  bg: "#0E1317",
  surface: "#182027",
  text: "#E8ECF1",
  muted: "#A9B4C0",
  border: "#2A333D",
  inputBorder: "#6E7A88",
  primary: "#5FC7B7",
  onPrimary: "#062B27",
  primarySoft: "#123A35",
  mint: "#3D9A80",
  bubbleUser: "#5FC7B7",
  bubbleBot: "#182027",
  danger: "#F87171",
  onDanger: "#2B0A0A",
  dangerBorder: "#7F1D1D",
  dangerSoft: "#3B1717",
  urgentBg: "#2B1515",
  successSoft: "#12321F",
  amber: "#F59E0B",
  warningSoft: "#3A2C0C",
  warningText: "#FCD34D",
  sleep: "#818CF8",
  seizure: "#A78BFA",
  period: "#F87171",
  heart: "#F87171",
  codeBg: "#232C35",
  onPrimaryFill: "rgba(6, 43, 39, 0.12)",
  backdrop: "rgba(0, 0, 0, 0.55)",
};

export const colors: Palette = { ...LIGHT };

// Each health tool's colour: the icon (4.5:1 or better on its soft background) and that background.
const TINT_LIGHT = {
  journal: { fg: "#0B5D57", bg: "#E4F4EC" },
  medications: { fg: "#6D28D9", bg: "#EDE9FE" },
  exercise: { fg: "#C2410C", bg: "#FFEDD5" },
  appointments: { fg: "#1D4ED8", bg: "#DBEAFE" },
  reports: { fg: "#334155", bg: "#E2E8F0" },
  care: { fg: "#B91C1C", bg: "#FEE2E2" },
  records: { fg: "#0E7490", bg: "#CFFAFE" },
};
const TINT_DARK: typeof TINT_LIGHT = {
  journal: { fg: "#5FC7B7", bg: "#123A35" },
  medications: { fg: "#C4B5FD", bg: "#2E2152" },
  exercise: { fg: "#FDBA74", bg: "#3D2412" },
  appointments: { fg: "#93C5FD", bg: "#172B4D" },
  reports: { fg: "#CBD5E1", bg: "#29323D" },
  care: { fg: "#FCA5A5", bg: "#3B1717" },
  records: { fg: "#67E8F9", bg: "#103540" },
};
export const tint = copyTints(TINT_LIGHT);
function copyTints(t: typeof TINT_LIGHT) {
  return Object.fromEntries(Object.entries(t).map(([k, v]) => [k, { ...v }])) as typeof TINT_LIGHT;
}

export type Scheme = "light" | "dark";
export const TEXT_SIZES = [0.9, 1, 1.15, 1.3] as const;

let current = { scheme: "light" as Scheme, scale: 1, version: 0 };

// Switch palette and text size. Call it while rendering the app root, before the screens render.
export function applyTheme(scheme: Scheme, scale: number) {
  if (scheme === current.scheme && scale === current.scale) return;
  Object.assign(colors, scheme === "dark" ? DARK : LIGHT);
  const tints = scheme === "dark" ? TINT_DARK : TINT_LIGHT;
  for (const k of Object.keys(tints) as (keyof typeof tints)[]) Object.assign(tint[k], tints[k]);
  current = { scheme, scale, version: current.version + 1 };
}
export const themeScheme = () => current.scheme;
// Changes whenever the theme does: pass it to lists (FlatList extraData) so their rows redraw too.
export const themeVersion = () => current.version;

const scaleText = <T extends object>(styles: T): T => {
  if (current.scale === 1) return styles;
  const out: Record<string, unknown> = {};
  for (const [name, style] of Object.entries(styles)) {
    const s = { ...(style as Record<string, unknown>) };
    if (typeof s.fontSize === "number") s.fontSize = Math.round(s.fontSize * current.scale);
    if (typeof s.lineHeight === "number") s.lineHeight = Math.round(s.lineHeight * current.scale);
    out[name] = s;
  }
  return out as T;
};

// A style sheet that follows the theme: `make` runs again after each theme or text-size change, so it should read
// `colors` (and `ui`, `tint`) inside. Used exactly like StyleSheet.create's result.
// What StyleSheet.create accepts: named view, text and image styles.
type Sheet = Parameters<typeof StyleSheet.create>[0];

export function themed<T extends Sheet>(make: () => T & Sheet, opts: { scaleText?: boolean } = {}): Readonly<T> {
  let made: T | null = null;
  let at = -1;
  const get = () => {
    if (at !== current.version || !made) {
      const raw = make();
      made = StyleSheet.create(opts.scaleText === false ? raw : scaleText(raw)) as T;
      at = current.version;
    }
    return made as T;
  };
  return new Proxy({} as T, {
    get: (_, key) => (get() as Record<string | symbol, unknown>)[key],
    has: (_, key) => key in get(),
    ownKeys: () => Reflect.ownKeys(get()),
    getOwnPropertyDescriptor: (_, key) => ({ ...Object.getOwnPropertyDescriptor(get(), key), configurable: true }),
  });
}

// Shared shapes for the Health tools screens: soft cards on a light page, comfortable touch targets.
export const radius = { sm: 8, md: 12, lg: 16, pill: 999 };
export const TOUCH = 44; // minimum touch target (iOS 44pt; Android adds hitSlop to reach 48dp)

const shadow = () =>
  Platform.select({
    web: { boxShadow: current.scheme === "dark" ? "0 1px 2px rgba(0, 0, 0, 0.4)" : "0 1px 2px rgba(17, 24, 39, 0.06), 0 2px 8px rgba(17, 24, 39, 0.05)" },
    default: { shadowColor: "#000000", shadowOpacity: current.scheme === "dark" ? 0.3 : 0.06, shadowRadius: 8, shadowOffset: { width: 0, height: 2 }, elevation: 1 },
  }) as object;

// Building blocks to spread into themed() styles. Their text isn't scaled here: the sheet that spreads them scales it.
export const ui = themed(
  () => ({
    card: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, ...shadow() },
    chip: { minHeight: 40, justifyContent: "center" as const, borderWidth: 1, borderColor: colors.inputBorder, borderRadius: radius.pill, paddingHorizontal: 14 },
    chipOn: { backgroundColor: colors.primarySoft, borderColor: colors.primary },
    button: { minHeight: TOUCH, justifyContent: "center" as const, alignItems: "center" as const, backgroundColor: colors.primary, borderRadius: radius.md, paddingHorizontal: 16 },
    // Nothing here yet: a dashed card, so it reads as a place to fill rather than an error.
    empty: { color: colors.muted, fontSize: 15, lineHeight: 21, textAlign: "center" as const, padding: 16, borderWidth: 1, borderStyle: "dashed" as const, borderColor: colors.inputBorder, borderRadius: radius.md, backgroundColor: colors.surface },
    // "Add a medication", "Add an appointment": an outlined button, not a bare link.
    addButton: { flexDirection: "row" as const, alignItems: "center" as const, justifyContent: "center" as const, gap: 6, minHeight: TOUCH, paddingHorizontal: 16, borderWidth: 1, borderColor: colors.primary, borderRadius: radius.md, backgroundColor: colors.surface },
    section: { fontSize: 17, fontWeight: "700" as const, color: colors.text, marginTop: 8 },
  }),
  { scaleText: false },
);

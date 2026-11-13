// Colours, shapes and text size for the whole app, in a light and a dark version, and in two looks (src/design.ts):
// "classic" and "soft" (rounder corners, cards on a faint tray with a soft shadow, pill buttons, a white floating top
// bar instead of the teal band, and Plus Jakarta Sans).
// `colors`, `tint` and `radius` are swapped in place by applyTheme (App.tsx, from the user's Appearance settings), and
// styles made with themed() are rebuilt on the next render, with every fontSize and lineHeight scaled to the chosen
// text size and, in the soft look, each text style given the font file for its weight.
import { Platform, StyleSheet } from "react-native";
import type { Design } from "./design";

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
  // Bar charts of how a day went, from bad to good (red, orange, yellow, green, teal); see scaleColor.
  scale1: "#D9443A",
  scale2: "#EE8A3C",
  scale3: "#E0B030",
  scale4: "#6DBE8C",
  scale5: "#0B5D57",
  codeBg: "#F3F4F6",
  // On the teal header band: the translucent fill behind its round buttons and tabs.
  onPrimaryFill: "rgba(255, 255, 255, 0.16)",
  backdrop: "rgba(17, 24, 39, 0.35)",
  // The soft welcome page (src/soft.tsx): the tray a card sits in, its hairline edge, the card's top highlight, and
  // the faint teal of its shadow.
  shell: "rgba(17, 24, 39, 0.035)",
  hairline: "rgba(17, 24, 39, 0.06)",
  highlight: "rgba(255, 255, 255, 0.9)",
  glow: "rgba(11, 93, 87, 0.14)",
  // Fill of the small circle around a button's arrow, on a teal button.
  onPrimaryCircle: "rgba(255, 255, 255, 0.18)",
  // The top bar of the dashboard and tools: its fill, its words and icons, the quieter line above the title, the
  // fill behind its round buttons and unselected tabs, and its one filled button (Chat) or selected tab.
  bar: "#0B5D57",
  onBar: "#FFFFFF",
  onBarMuted: "#E4F4EC",
  barFill: "rgba(255, 255, 255, 0.16)",
  barAction: "#FFFFFF",
  onBarAction: "#0B5D57",
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
  scale1: "#F87171",
  scale2: "#FB923C",
  scale3: "#FACC15",
  scale4: "#6EE7B7",
  scale5: "#5FC7B7",
  codeBg: "#232C35",
  onPrimaryFill: "rgba(6, 43, 39, 0.12)",
  backdrop: "rgba(0, 0, 0, 0.55)",
  shell: "rgba(255, 255, 255, 0.035)",
  hairline: "rgba(255, 255, 255, 0.08)",
  highlight: "rgba(255, 255, 255, 0.06)",
  glow: "rgba(0, 0, 0, 0.45)",
  onPrimaryCircle: "rgba(6, 43, 39, 0.14)",
  bar: "#5FC7B7",
  onBar: "#062B27",
  onBarMuted: "#123A35",
  barFill: "rgba(6, 43, 39, 0.12)",
  barAction: "#182027",
  onBarAction: "#5FC7B7",
};

// The soft look's changes to each palette: the top bar turns white (dark grey in dark mode) with a teal button.
const SOFT_LIGHT: Partial<Palette> = {
  bar: "#FFFFFF",
  onBar: "#111827",
  onBarMuted: "#4B5563",
  barFill: "rgba(17, 24, 39, 0.05)",
  barAction: "#0B5D57",
  onBarAction: "#FFFFFF",
};
const SOFT_DARK: Partial<Palette> = {
  bar: "#182027",
  onBar: "#E8ECF1",
  onBarMuted: "#A9B4C0",
  barFill: "rgba(255, 255, 255, 0.06)",
  barAction: "#5FC7B7",
  onBarAction: "#062B27",
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
  circle: { fg: "#9D174D", bg: "#FCE7F3" },
  guides: { fg: "#3F6212", bg: "#ECFCCB" },
  agent: { fg: "#4338CA", bg: "#E0E7FF" },
};
const TINT_DARK: typeof TINT_LIGHT = {
  journal: { fg: "#5FC7B7", bg: "#123A35" },
  medications: { fg: "#C4B5FD", bg: "#2E2152" },
  exercise: { fg: "#FDBA74", bg: "#3D2412" },
  appointments: { fg: "#93C5FD", bg: "#172B4D" },
  reports: { fg: "#CBD5E1", bg: "#29323D" },
  care: { fg: "#FCA5A5", bg: "#3B1717" },
  records: { fg: "#67E8F9", bg: "#103540" },
  circle: { fg: "#F9A8D4", bg: "#3D1530" },
  guides: { fg: "#BEF264", bg: "#26330F" },
  agent: { fg: "#A5B4FC", bg: "#1E2250" },
};
export const tint = copyTints(TINT_LIGHT);
function copyTints(t: typeof TINT_LIGHT) {
  return Object.fromEntries(Object.entries(t).map(([k, v]) => [k, { ...v }])) as typeof TINT_LIGHT;
}

export type Scheme = "light" | "dark";
export const TEXT_SIZES = [0.9, 1, 1.15, 1.3] as const;

let current = { scheme: "light" as Scheme, scale: 1, design: "classic" as Design, version: 0 };

const RADIUS = { classic: { sm: 8, md: 12, lg: 16, pill: 999 }, soft: { sm: 12, md: 18, lg: 24, pill: 999 } };

// Switch palette, text size and look. Call it while rendering the app root, before the screens render.
export function applyTheme(scheme: Scheme, scale: number, design: Design = current.design) {
  if (scheme === current.scheme && scale === current.scale && design === current.design) return;
  const soft = design === "soft" ? (scheme === "dark" ? SOFT_DARK : SOFT_LIGHT) : {};
  Object.assign(colors, scheme === "dark" ? DARK : LIGHT, soft);
  const tints = scheme === "dark" ? TINT_DARK : TINT_LIGHT;
  for (const k of Object.keys(tints) as (keyof typeof tints)[]) Object.assign(tint[k], tints[k]);
  Object.assign(radius, RADIUS[design]);
  current = { scheme, scale, design, version: current.version + 1 };
}
export const themeScheme = () => current.scheme;
export const isSoft = () => current.design === "soft";
// Changes whenever the theme does: pass it to lists (FlatList extraData) so their rows redraw too.
export const themeVersion = () => current.version;

// The soft look's font, one file per weight (loaded in App.tsx). The weight itself goes back to normal, or the
// browser would thicken the already bold file a second time.
const FAMILY: [number, string][] = [
  [800, "PlusJakartaSans_800ExtraBold"],
  [700, "PlusJakartaSans_700Bold"],
  [600, "PlusJakartaSans_600SemiBold"],
  [500, "PlusJakartaSans_500Medium"],
  [0, "PlusJakartaSans_400Regular"],
];

// Only text styles that set a weight, or a size and a colour (a whole text style, as every Text has one), get a
// font file. A style that only changes the size (headlineWide) is laid over one of those and keeps its file.
function softFont(s: Record<string, unknown>) {
  if (s.fontFamily || (s.fontWeight === undefined && (typeof s.fontSize !== "number" || s.color === undefined))) return;
  const w = s.fontWeight === "bold" ? 700 : Number(s.fontWeight) || 400;
  s.fontFamily = FAMILY.find(([min]) => w >= min)![1];
  s.fontWeight = "normal";
  // Big bold headings sit a little tighter.
  if (typeof s.fontSize === "number" && s.fontSize >= 20 && w >= 700 && s.letterSpacing === undefined) s.letterSpacing = -Math.round(s.fontSize * 0.25) / 10;
}

const adjustText = <T extends object>(styles: T, scale: boolean): T => {
  const sized = scale && current.scale !== 1;
  if (!sized && current.design !== "soft") return styles;
  const out: Record<string, unknown> = {};
  for (const [name, style] of Object.entries(styles)) {
    const s = { ...(style as Record<string, unknown>) };
    if (sized && typeof s.fontSize === "number") s.fontSize = Math.round(s.fontSize * current.scale);
    if (sized && typeof s.lineHeight === "number") s.lineHeight = Math.round(s.lineHeight * current.scale);
    if (current.design === "soft") softFont(s);
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
      made = StyleSheet.create(adjustText(raw, opts.scaleText !== false)) as T;
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
// A smooth colour from bad (0) to good (1) through the five scale stops, for chart bars.
export function scaleColor(good: number): string {
  const stops = [colors.scale1, colors.scale2, colors.scale3, colors.scale4, colors.scale5];
  const x = Math.min(1, Math.max(0, Number.isFinite(good) ? good : 0.5)) * (stops.length - 1);
  const i = Math.min(stops.length - 2, Math.floor(x));
  const f = x - i;
  const rgb = (h: string) => [1, 3, 5].map((k) => parseInt(h.slice(k, k + 2), 16));
  const [a, b] = [rgb(stops[i]), rgb(stops[i + 1])];
  return `#${a.map((v, k) => Math.round(v + (b[k] - v) * f).toString(16).padStart(2, "0")).join("")}`;
}

// A 0-10 severity (pain, a symptom): teal for mild through yellow and orange to red for the worst.
export const severityColor = (n: number) => scaleColor(1 - n / 10);

// Dark or white text, whichever reads better on a chart colour such as scaleColor's.
export function inkOn(bg: string): string {
  const [r, g, b] = [1, 3, 5].map((k) => parseInt(bg.slice(k, k + 2), 16) / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.5 ? LIGHT.text : LIGHT.surface;
}

export const radius = { ...RADIUS.classic };
// A corner written for the classic look, in the current one: as written in the classic look, half again as round in
// the soft one.
export const round = (n: number) => (current.design === "soft" ? Math.round(n * 1.5) : n);
// A button's or chip's corners: as written in the classic look, fully round (a pill) in the soft one.
export const pillish = (n: number) => (current.design === "soft" ? 999 : n);
export const TOUCH = 44; // minimum touch target (iOS 44pt; Android adds hitSlop to reach 48dp)

const shadow = () =>
  current.design === "soft" ? softShadow() : Platform.select({
    web: { boxShadow: current.scheme === "dark" ? "0 1px 2px rgba(0, 0, 0, 0.4)" : "0 1px 2px rgba(17, 24, 39, 0.06), 0 2px 8px rgba(17, 24, 39, 0.05)" },
    default: { shadowColor: "#000000", shadowOpacity: current.scheme === "dark" ? 0.3 : 0.06, shadowRadius: 8, shadowOffset: { width: 0, height: 2 }, elevation: 1 },
  }) as object;

// The soft look's shadow: wide and faint, so a card floats rather than sits, with a light top edge on the web.
export const softShadow = () =>
  Platform.select({
    web: { boxShadow: `0 24px 48px -28px ${colors.glow}, 0 6px 18px -10px ${colors.hairline}, inset 0 1px 1px ${colors.highlight}` },
    default: { shadowColor: colors.glow, shadowOpacity: 1, shadowRadius: 20, shadowOffset: { width: 0, height: 12 }, elevation: 2 },
  }) as object;

// In the soft look, a top bar floats as a rounded panel with a little room around it (and below the status bar on a
// phone), instead of running edge to edge. Spread it last into a top bar's style; in the classic look it adds nothing.
export const floatingBar = () =>
  current.design === "soft"
    ? {
        marginHorizontal: 10,
        marginTop: Platform.OS === "web" ? 10 : 48,
        marginBottom: 4,
        paddingTop: 8,
        paddingBottom: 8,
        borderRadius: 28,
        borderWidth: 1,
        borderColor: colors.hairline,
        borderBottomColor: colors.hairline,
        ...softShadow(),
      }
    : {};

// The small line above a title (the date over the greeting, "Dashboard" over a tool's name): in the soft look, small
// spaced capitals, like the tags over the welcome page's headings. Spread it last into that text's style.
export const kicker = () => (current.design === "soft" ? { fontSize: 11, letterSpacing: 1.6, textTransform: "uppercase" as const, marginBottom: 2 } : {});

// Building blocks to spread into themed() styles. Their text isn't scaled here: the sheet that spreads them scales it.
export const ui = themed(
  () => ({
    card: { backgroundColor: colors.surface, borderWidth: 1, borderColor: current.design === "soft" ? colors.hairline : colors.border, borderRadius: radius.md, ...shadow() },
    chip: { minHeight: 40, justifyContent: "center" as const, borderWidth: 1, borderColor: colors.inputBorder, borderRadius: radius.pill, paddingHorizontal: 14 },
    chipOn: { backgroundColor: colors.primarySoft, borderColor: colors.primary },
    button: { minHeight: TOUCH, justifyContent: "center" as const, alignItems: "center" as const, backgroundColor: colors.primary, borderRadius: current.design === "soft" ? radius.pill : radius.md, paddingHorizontal: current.design === "soft" ? 22 : 16 },
    // Nothing here yet: a dashed card, so it reads as a place to fill rather than an error.
    empty: { color: colors.muted, fontSize: 15, lineHeight: 21, textAlign: "center" as const, padding: 16, borderWidth: 1, borderStyle: "dashed" as const, borderColor: colors.inputBorder, borderRadius: radius.md, backgroundColor: colors.surface },
    // "Add a medication", "Add an appointment": an outlined button, not a bare link.
    addButton: { flexDirection: "row" as const, alignItems: "center" as const, justifyContent: "center" as const, gap: 6, minHeight: TOUCH, paddingHorizontal: current.design === "soft" ? 20 : 16, borderWidth: 1, borderColor: colors.primary, borderRadius: current.design === "soft" ? radius.pill : radius.md, backgroundColor: colors.surface },
    section: { fontSize: 17, fontWeight: "700" as const, color: colors.text, marginTop: 8 },
  }),
  { scaleText: false },
);

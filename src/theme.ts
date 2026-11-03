import { Platform } from "react-native";

export const colors = {
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
  dangerBorder: "#FCA5A5",
  urgentBg: "#FEF2F2",
  amber: "#D97706", // chart fills only (3.2:1); use warningText for words
  warningSoft: "#FEF3C7",
  warningText: "#92400E",
  sleep: "#6366F1",
  seizure: "#7C3AED",
};

// Each health tool's colour: the icon (4.5:1 or better on its soft background) and that background.
export const tint = {
  journal: { fg: "#0B5D57", bg: "#E4F4EC" },
  medications: { fg: "#6D28D9", bg: "#EDE9FE" },
  exercise: { fg: "#C2410C", bg: "#FFEDD5" },
  appointments: { fg: "#1D4ED8", bg: "#DBEAFE" },
  reports: { fg: "#334155", bg: "#E2E8F0" },
  care: { fg: "#B91C1C", bg: "#FEE2E2" },
};

// Shared shapes for the Health tools screens: soft cards on a light page, comfortable touch targets.
export const radius = { sm: 8, md: 12, lg: 16, pill: 999 };
export const TOUCH = 44; // minimum touch target (iOS 44pt; Android adds hitSlop to reach 48dp)

const shadow = Platform.select({
  web: { boxShadow: "0 1px 2px rgba(17, 24, 39, 0.06), 0 2px 8px rgba(17, 24, 39, 0.05)" },
  default: { shadowColor: "#111827", shadowOpacity: 0.06, shadowRadius: 8, shadowOffset: { width: 0, height: 2 }, elevation: 1 },
}) as object;

export const ui = {
  card: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, ...shadow },
  chip: { minHeight: 40, justifyContent: "center" as const, borderWidth: 1, borderColor: colors.inputBorder, borderRadius: radius.pill, paddingHorizontal: 14 },
  chipOn: { backgroundColor: colors.primarySoft, borderColor: colors.primary },
  button: { minHeight: TOUCH, justifyContent: "center" as const, alignItems: "center" as const, backgroundColor: colors.primary, borderRadius: radius.md, paddingHorizontal: 16 },
  // Nothing here yet: a dashed card, so it reads as a place to fill rather than an error.
  empty: { color: colors.muted, fontSize: 15, lineHeight: 21, textAlign: "center" as const, padding: 16, borderWidth: 1, borderStyle: "dashed" as const, borderColor: colors.inputBorder, borderRadius: radius.md, backgroundColor: colors.surface },
  // "Add a medication", "Add an appointment": an outlined button, not a bare link.
  addButton: { flexDirection: "row" as const, alignItems: "center" as const, justifyContent: "center" as const, gap: 6, minHeight: TOUCH, paddingHorizontal: 16, borderWidth: 1, borderColor: colors.primary, borderRadius: radius.md, backgroundColor: colors.surface },
  section: { fontSize: 17, fontWeight: "700" as const, color: colors.text, marginTop: 8 },
};

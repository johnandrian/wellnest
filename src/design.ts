// Which look the whole app uses: "soft" (rounder cards set in a faint tray, pill buttons, a floating top bar and
// Plus Jakarta Sans; after the "soft" style in .claude/skills/soft-skill) or "classic" (the original). People using
// the app can't change it; it's set here, for developers:
// - DESIGN below sets it for every build.
// - EXPO_PUBLIC_DESIGN=classic (or soft) in the environment or .env.local overrides it for one build or dev server.
// - While developing on the web, ?design=classic or ?design=soft in the address overrides it for that page load.
import { Platform } from "react-native";

export type Design = "soft" | "classic";
export const DESIGN: Design = "soft";

const pick = (value: string | null | undefined): Design | null => (value === "soft" || value === "classic" ? value : null);

export function appDesign(): Design {
  if (__DEV__ && Platform.OS === "web") {
    try {
      const asked = pick(new URLSearchParams(window.location.search).get("design"));
      if (asked) return asked;
    } catch {
      // No address to read: fall through.
    }
  }
  return pick(process.env.EXPO_PUBLIC_DESIGN) ?? DESIGN;
}

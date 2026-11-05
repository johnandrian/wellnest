// Which look the welcome page and the free tools use: "soft" (src/WelcomeSoft.tsx, src/soft.tsx) or "classic" (the
// original). Add ?design=soft or ?design=classic to the address to switch; the choice is remembered in this browser.
// Change DEFAULT_DESIGN to switch everyone who hasn't picked one.
import { useState } from "react";
import { Platform } from "react-native";

export type Design = "soft" | "classic";
export const DEFAULT_DESIGN: Design = "soft";
const KEY = "wellnest.design";

function pick(value: string | null): Design | null {
  return value === "soft" || value === "classic" ? value : null;
}

export function landingDesign(): Design {
  if (Platform.OS !== "web") return DEFAULT_DESIGN;
  try {
    const asked = pick(new URLSearchParams(window.location.search).get("design"));
    if (asked) {
      localStorage.setItem(KEY, asked);
      return asked;
    }
    return pick(localStorage.getItem(KEY)) ?? DEFAULT_DESIGN;
  } catch {
    // Storage blocked: the default it is.
    return DEFAULT_DESIGN;
  }
}

export function useLandingDesign(): Design {
  const [design] = useState(landingDesign);
  return design;
}

// What both looks of the welcome page show (src/Welcome.tsx, src/WelcomeSoft.tsx): the icons for the features and
// free tools, and the made-up week in the preview.
import type { IconName } from "./Icon";
import type { tint } from "./theme";

// In the order of `s.landFeatures`: the tracker first.
export const FEATURES: { icon: IconName; tint: keyof typeof tint }[] = [
  { icon: "journal", tint: "journal" },
  { icon: "insights", tint: "appointments" },
  { icon: "medications", tint: "medications" },
  { icon: "guides", tint: "guides" },
  { icon: "circle", tint: "circle" },
  { icon: "history", tint: "records" },
];

export const TOOLS: { path: string; icon: IconName; tint: keyof typeof tint }[] = [
  { path: "/medication-list", icon: "medList", tint: "medications" },
  { path: "/appointment-checklist", icon: "guides", tint: "guides" },
];

// A made-up week for the preview card: pain eases as sleep gets longer.
export const PREVIEW = { pain: [6, 7, 5, 4, 3, 3, 2], sleep: [5, 5.5, 6.5, 7, 7.5, 7, 8] };

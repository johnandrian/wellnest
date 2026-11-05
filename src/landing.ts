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

// The welcome page's example stories (`s.landStories`, in this order), four weeks of made-up days each. `values`: the
// measure the bars show (0-10); `marked`: the days the weather factor hit (the markers above the bars). The numbers
// in the story text are worked out from these, and the example dashboard (src/DemoPage.tsx) uses the first one.
export type Story = { values: number[]; marked: number[]; max: number; icon: IconName; mark: "arrow-down" | "flower-outline" };
export const STORIES: Story[] = [
  // Rheumatoid arthritis: joint pain is 7 or more on 4 of the 5 days air pressure drops (7.2/10 on those days, 3.8 on the
  // other 23). Days 5 and 16 are left out of the dashboard, as unanswered days.
  {
    values: [4, 5, 4, 8, 6, 4, 3, 4, 5, 7, 4, 3, 4, 5, 4, 8, 4, 3, 4, 3, 5, 4, 3, 3, 3, 8, 3, 2],
    marked: [3, 9, 15, 20, 25],
    max: 10,
    icon: "pain",
    mark: "arrow-down",
  },
  // Asthma: reliever puffs, used on 6 of the 7 high-pollen days and on 3 of the other 21.
  {
    values: [0, 0, 0, 0, 3, 4, 2, 0, 0, 1, 0, 0, 0, 0, 3, 0, 0, 2, 0, 0, 0, 2, 4, 0, 0, 1, 0, 0],
    marked: [4, 5, 6, 13, 14, 21, 22],
    max: 5,
    icon: "asthma",
    mark: "flower-outline",
  },
];

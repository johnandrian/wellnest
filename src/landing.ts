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
// measure the bars show; `marked`: the days the factor hit (the markers above the bars); `med`: the day a medicine
// was started or its dose changed (the green marker). The numbers in the story text are worked out from these
// (src/landing.test.ts checks them), and the example dashboard (src/DemoPage.tsx) uses the first one.
export type Story = {
  values: number[];
  marked: number[];
  med: number;
  max: number;
  // Where the bars start (glucose doesn't go near 0), 0 when left out.
  floor?: number;
  icon: IconName;
  mark: "arrow-down" | "flower-outline" | "moon-outline";
  // The "warned you" beat's icon, when it isn't the weather.
  warnIcon?: IconName;
};
export const STORIES: Story[] = [
  // Rheumatoid arthritis: joint pain is 7 or more on 4 of the 5 days air pressure drops (7/10 on those days, 4.4 on
  // the other 23), and the dose change on day 13 brings it from 6.1 (the 2 weeks before) to 3.7 (the 2 weeks after).
  // Days 5 and 16 are left out of the dashboard, as unanswered days.
  {
    values: [5, 6, 5, 9, 7, 5, 6, 5, 6, 8, 6, 5, 6, 5, 4, 7, 4, 3, 4, 3, 7, 3, 3, 2, 3, 4, 3, 2],
    marked: [3, 9, 15, 20, 25],
    med: 13,
    max: 10,
    icon: "pain",
    mark: "arrow-down",
  },
  // Asthma: reliever puffs, 3.3 a day on the 7 high-pollen days and 1 on the other 21; starting the preventer on day
  // 10 brings them from 3 a day to 1.
  {
    values: [2, 1, 3, 2, 5, 5, 4, 2, 3, 3, 2, 1, 0, 2, 3, 0, 1, 0, 0, 1, 0, 2, 2, 0, 1, 0, 0, 0],
    marked: [4, 5, 6, 13, 14, 21, 22],
    med: 10,
    max: 5,
    icon: "asthma",
    mark: "flower-outline",
  },
  // Type 2 diabetes: the day's average glucose (mg/dL), 191 after the 5 nights under 6 hours of sleep and 150 on the
  // other 23 days; the metformin dose goes up on day 14, from 174 (the 2 weeks before) to 139 (the days after).
  {
    values: [160, 168, 210, 172, 158, 165, 162, 170, 205, 175, 160, 166, 198, 164, 158, 140, 136, 172, 138, 132, 135, 130, 137, 168, 133, 128, 134, 130],
    marked: [2, 8, 12, 17, 23],
    med: 14,
    max: 250,
    floor: 100,
    icon: "glucose",
    mark: "moon-outline",
    warnIcon: "history",
  },
];

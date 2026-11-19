// Bar colors for vitals by fixed thresholds, not by where a reading sits in the chart's range: the Trackers tab and
// the dashboard's 4-week charts both use them, so a 142 top number is never shown in the "good" green.
import { FEVER_C } from "../convex/lib/units";
import { colors } from "./theme";

// 180/120 and up is a crisis, 130/80 and up high, under 90/60 low.
export const bpColor = (sys: number, dia = 0) => {
  if (sys >= 180 || dia >= 120) return colors.danger;
  if (sys >= 130 || dia >= 80 || sys < 90) return colors.amber;
  return colors.mint;
};

// In °C: 38 and up is a fever, 37.5 and up is raised.
export const tempColor = (c: number) => (c >= FEVER_C ? colors.danger : c >= 37.5 ? colors.amber : colors.mint);

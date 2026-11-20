// Draws an icon from ./iconMap.ts, the one list of which picture means what.
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";

import { ICONS, type IconName } from "./iconMap";

export type { IconName };

export function Icon({ name, size = 20, color }: { name: IconName; size?: number; color: string }) {
  const [set, glyph] = ICONS[name];
  return set === "mci" ? (
    <MaterialCommunityIcons name={glyph as keyof typeof MaterialCommunityIcons.glyphMap} size={size} color={color} />
  ) : (
    <Ionicons name={glyph as keyof typeof Ionicons.glyphMap} size={size} color={color} />
  );
}

// The chart metric's icon on the dashboard.
export const METRIC_ICON: Record<string, IconName> = {
  pain: "pain",
  symptom: "symptoms",
  mood: "mood",
  energy: "energy",
  sleepQuality: "sleepQuality",
  sleepHours: "sleep",
  steps: "steps",
  restingHeartRate: "heart",
  hrv: "heart",
  weightKg: "weight",
  glucose: "glucose",
  peakFlow: "asthma",
  reliever: "asthma",
  seizures: "seizures",
  tempMax: "weather",
  bp: "bp",
  bodyTemp: "temperature",
  aqi: "weather",
  pollen: "weather",
};

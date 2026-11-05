// One icon per idea, used everywhere it appears, so no two tools or places share a picture.
// Mostly Ionicons; MaterialCommunityIcons where Ionicons has nothing that fits (pills, lungs, a brain, a hospital).
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";

const ICONS = {
  dashboard: ["ion", "grid-outline"],
  history: ["ion", "chatbubbles-outline"],
  newChat: ["ion", "create-outline"],
  journal: ["ion", "book-outline"],
  medications: ["mci", "pill"],
  exercise: ["ion", "barbell-outline"],
  appointments: ["ion", "calendar-outline"],
  reports: ["ion", "document-text-outline"],
  care: ["ion", "map-outline"],
  pain: ["ion", "flash-outline"],
  asthma: ["mci", "lungs"],
  seizures: ["mci", "brain"],
  symptoms: ["ion", "thermometer-outline"],
  mood: ["ion", "happy-outline"],
  energy: ["ion", "battery-charging-outline"],
  sleep: ["ion", "moon-outline"],
  sleepQuality: ["ion", "bed-outline"],
  steps: ["ion", "footsteps-outline"],
  heart: ["ion", "heart-outline"],
  weight: ["mci", "scale-bathroom"],
  glucose: ["mci", "water-outline"],
  weather: ["ion", "partly-sunny-outline"],
  er: ["mci", "hospital-building"],
  urgentCare: ["mci", "medical-bag"],
  pharmacy: ["mci", "mortar-pestle-plus"],
  doctor: ["mci", "stethoscope"],
  insights: ["ion", "analytics-outline"],
  doses: ["ion", "checkmark-done"],
  records: ["mci", "clipboard-pulse-outline"],
  recordLab: ["mci", "test-tube"],
  recordLetter: ["ion", "mail-open-outline"],
  recordImaging: ["mci", "radiology-box-outline"],
  recordOther: ["ion", "document-attach-outline"],
  pdf: ["mci", "file-pdf-box"],
  photo: ["ion", "camera-outline"],
  forecast: ["ion", "rainy-outline"],
  circle: ["ion", "people-outline"],
  invite: ["ion", "person-add-outline"],
  guides: ["ion", "checkbox-outline"],
  medList: ["ion", "list-outline"],
  scan: ["ion", "scan-outline"],
} as const;

export type IconName = keyof typeof ICONS;

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
  aqi: "weather",
  pollen: "weather",
};

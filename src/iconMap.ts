// One icon per idea, used everywhere it appears, so no two tools or places share a picture (tests/icons.test.ts
// checks no glyph is used twice). Mostly Ionicons; MaterialCommunityIcons where Ionicons has nothing that fits (pills,
// lungs, a brain, a hospital, the assistant). Drawn by ./Icon.tsx; kept apart so tests can read it.
export const ICONS = {
  // The app's places: the dashboard, the chat, Settings, and the menu that opens the tool rail on a phone.
  dashboard: ["ion", "grid-outline"],
  chat: ["ion", "chatbubble-ellipses-outline"],
  history: ["ion", "chatbubbles-outline"],
  newChat: ["ion", "add-circle-outline"],
  settings: ["ion", "settings-outline"],
  menu: ["ion", "menu-outline"],
  notifications: ["ion", "notifications-outline"],
  // The tools (src/HubPanel.tsx TOOLS).
  journal: ["ion", "book-outline"],
  medications: ["mci", "pill"],
  exercise: ["ion", "barbell-outline"],
  appointments: ["ion", "calendar-outline"],
  share: ["ion", "share-social-outline"],
  records: ["mci", "clipboard-pulse-outline"],
  care: ["ion", "map-outline"],
  circle: ["ion", "people-outline"],
  agent: ["mci", "robot-outline"],
  // Views inside a tool.
  journalLog: ["ion", "reader-outline"],
  trends: ["ion", "stats-chart-outline"],
  trackers: ["ion", "pulse-outline"],
  visitList: ["ion", "calendar-number-outline"],
  guides: ["ion", "checkbox-outline"], // the visit prep checklist
  exToday: ["ion", "today-outline"],
  exLater: ["ion", "hourglass-outline"],
  nearby: ["ion", "location-outline"],
  // Something the assistant writes for you (questions, a summary).
  suggest: ["ion", "sparkles-outline"],
  // What's tracked.
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
  bp: ["mci", "heart-pulse"],
  temperature: ["mci", "thermometer"],
  period: ["mci", "calendar-heart"],
  glucose: ["mci", "water-outline"],
  weather: ["ion", "partly-sunny-outline"],
  // Care nearby.
  er: ["mci", "hospital-building"],
  urgentCare: ["mci", "medical-bag"],
  pharmacy: ["mci", "mortar-pestle-plus"],
  doctor: ["mci", "stethoscope"],
  insights: ["ion", "analytics-outline"],
  doses: ["ion", "checkmark-done"],
  // Records and files.
  recordLab: ["mci", "test-tube"],
  recordLetter: ["ion", "mail-open-outline"],
  recordImaging: ["mci", "radiology-box-outline"],
  recordOther: ["ion", "document-attach-outline"],
  pdf: ["mci", "file-pdf-box"],
  shareLink: ["ion", "link-outline"],
  photo: ["ion", "camera-outline"],
  forecast: ["ion", "rainy-outline"],
  invite: ["ion", "person-add-outline"],
  medList: ["ion", "list-outline"],
  scan: ["ion", "scan-outline"],
  healthApp: ["ion", "fitness-outline"],
} as const;

export type IconName = keyof typeof ICONS;

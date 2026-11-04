// The privacy page (/privacy): what Wellnest keeps, the services that help run it, who can see what, and the
// choices people have. Open to everyone, signed in or not, in their language.
import { ScrollView, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Tap } from "./Tap";
import { Enter } from "./Motion";
import { colors, radius, TOUCH, ui, themed } from "./theme";
import type { Strings } from "./i18n";

export function Privacy({ s, onBack }: { s: Strings; onBack: () => void }) {
  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.page}>
      <Enter style={styles.inner}>
        <Tap style={styles.back} onPress={onBack} accessibilityRole="button" accessibilityLabel={s.landBack}>
          <Ionicons name="chevron-back" size={20} color={colors.primary} />
          <Text style={styles.backText}>{s.landBack}</Text>
        </Tap>
        <Text style={styles.title} accessibilityRole="header">
          {s.privacyTitle}
        </Text>
        <Text style={styles.updated}>{s.privacyUpdated}</Text>
        <Text style={styles.intro}>{s.privacyIntro}</Text>
        {s.privacySections.map((sec) => (
          <View key={sec.title} style={styles.section}>
            <Text style={styles.heading} accessibilityRole="header">
              {sec.title}
            </Text>
            <Text style={styles.body}>{sec.body}</Text>
          </View>
        ))}
      </Enter>
    </ScrollView>
  );
}

const styles = themed(() => ({
  scroll: { flex: 1, backgroundColor: colors.bg },
  page: { paddingHorizontal: 16, paddingVertical: 24 },
  inner: { width: "100%", maxWidth: 720, alignSelf: "center", gap: 12 },
  back: { flexDirection: "row", alignItems: "center", gap: 2, minHeight: TOUCH, alignSelf: "flex-start" },
  backText: { color: colors.primary, fontSize: 15, fontWeight: "600" },
  title: { fontSize: 30, lineHeight: 36, fontWeight: "800", color: colors.text },
  updated: { fontSize: 13, color: colors.muted },
  intro: { fontSize: 17, lineHeight: 25, color: colors.text },
  section: { ...ui.card, padding: 16, gap: 6, borderRadius: radius.lg },
  heading: { fontSize: 17, fontWeight: "700", color: colors.text },
  body: { fontSize: 15, lineHeight: 23, color: colors.text },
}));

// /demo, open to everyone from the welcome page: the real Health tools (HubPanel: the dashboard and every tool) for a
// made-up person with rheumatoid arthritis. The app's own Convex functions run here in the browser on sample data
// (src/demo/, loaded as its own bundle), so every tool can be opened and tried. Nothing is sent to the server, and a
// reload starts over. The chat and Settings say they open once you have an account.
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Animated, Text, useWindowDimensions, View } from "react-native";
import { ConvexProvider, type ConvexReactClient } from "convex/react";
import { Ionicons } from "@expo/vector-icons";
import { Tap } from "./Tap";
import { Icon } from "./Icon";
import { Enter, usePresence } from "./Motion";
import { colors, radius, themed, TOUCH } from "./theme";
import type { Lang, Strings } from "./i18n";
import { HubPanel, type HubTab } from "./HubPanel";

export function DemoPage({ s, lang, onBack, onCreate }: { s: Strings; lang: Lang; onBack: () => void; onCreate: () => void }) {
  const [client, setClient] = useState<ConvexReactClient | null>(null);
  const [failed, setFailed] = useState(false);
  const [tab, setTab] = useState<HubTab>("home");
  // The chat or Settings someone tried to open: a card at the bottom says it needs an account.
  const [locked, setLocked] = useState<string | null>(null);
  const narrow = useWindowDimensions().width < 520;
  const sRef = useRef(s);
  sRef.current = s;

  // A fresh made-up person in this language; a language switch starts over in the new one.
  useEffect(() => {
    let live = true;
    setClient(null);
    import("./demo")
      .then(({ createDemoClient }) => live && setClient(createDemoClient(lang, () => sRef.current.demoNeedsAccount)))
      .catch((e) => {
        console.warn("example dashboard failed to load", e);
        if (live) setFailed(true);
      });
    return () => {
      live = false;
    };
  }, [lang]);

  return (
    <View style={styles.page}>
      <View style={styles.strip}>
        <Tap style={styles.round} onPress={onBack} accessibilityRole="button" accessibilityLabel={s.landBack}>
          <Ionicons name="chevron-back" size={20} color={colors.text} />
        </Tap>
        <View style={styles.flex}>
          <Text style={styles.stripTitle} numberOfLines={1}>
            {s.demoTitle}
          </Text>
          <Text style={styles.stripText} numberOfLines={narrow ? 2 : 1}>
            {s.demoBanner}
          </Text>
        </View>
        <Tap style={[styles.create, narrow && styles.createNarrow]} onPress={onCreate} accessibilityRole="button" accessibilityLabel={s.landCreate}>
          <Ionicons name="person-add-outline" size={18} color={colors.onPrimary} />
          {!narrow && <Text style={styles.createText}>{s.landCreate}</Text>}
        </Tap>
      </View>
      {client ? (
        <Enter style={styles.flex}>
          <ConvexProvider client={client}>
            <HubPanel
              tab={tab}
              onTab={setTab}
              s={s}
              settingsOpen={false}
              onSettings={() => setLocked(s.settings)}
              onClose={() => setLocked(s.backToChat)}
            />
          </ConvexProvider>
        </Enter>
      ) : (
        <View style={styles.loading}>
          {failed ? <Text style={styles.stripText}>{s.demoFailed}</Text> : <ActivityIndicator color={colors.primary} />}
        </View>
      )}
      <Locked tool={locked} s={s} onCreate={onCreate} onClose={() => setLocked(null)} />
    </View>
  );
}

function Locked({ tool, s, onCreate, onClose }: { tool: string | null; s: Strings; onCreate: () => void; onClose: () => void }) {
  const { t, mounted } = usePresence(!!tool);
  // While it slides away, keep naming what it was about.
  const last = useRef(tool);
  if (tool) last.current = tool;
  if (!mounted) return null;
  return (
    <Animated.View
      style={[styles.locked, { opacity: t, transform: [{ translateY: t.interpolate({ inputRange: [0, 1], outputRange: [24, 0] }) }] }]}
      accessibilityLiveRegion="polite"
    >
      <View style={styles.lockedIcon}>
        <Icon name="dashboard" size={20} color={colors.primary} />
      </View>
      <Text style={[styles.lockedText, styles.flex]}>{s.demoLocked.replace("{tool}", last.current ?? "")}</Text>
      <Tap style={styles.lockedCreate} onPress={onCreate} accessibilityRole="button">
        <Text style={styles.lockedCreateText}>{s.landCreate}</Text>
      </Tap>
      <Tap style={styles.close} onPress={onClose} accessibilityRole="button" accessibilityLabel={s.close}>
        <Ionicons name="close" size={20} color={colors.muted} />
      </Tap>
    </Animated.View>
  );
}

const styles = themed(() => ({
  page: { flex: 1, backgroundColor: colors.bg },
  flex: { flex: 1, minWidth: 0 },
  strip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginHorizontal: 12,
    marginTop: 8,
    padding: 6,
    borderRadius: radius.lg,
    backgroundColor: colors.primarySoft,
    borderWidth: 1,
    borderColor: colors.mint,
  },
  round: { width: TOUCH, height: TOUCH, borderRadius: TOUCH / 2, alignItems: "center", justifyContent: "center" },
  stripTitle: { color: colors.text, fontWeight: "700", fontSize: 14 },
  stripText: { color: colors.text, fontSize: 13, lineHeight: 18 },
  create: { flexDirection: "row", alignItems: "center", gap: 6, minHeight: TOUCH, borderRadius: radius.pill, paddingHorizontal: 14, backgroundColor: colors.primary },
  createNarrow: { width: TOUCH, paddingHorizontal: 0, justifyContent: "center" },
  createText: { color: colors.onPrimary, fontWeight: "700", fontSize: 14 },
  loading: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
  locked: {
    position: "absolute",
    left: 16,
    right: 16,
    bottom: 16,
    maxWidth: 640,
    alignSelf: "center",
    marginHorizontal: "auto",
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    padding: 12,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.primary,
  },
  lockedIcon: { width: 36, height: 36, borderRadius: 27, alignItems: "center", justifyContent: "center", backgroundColor: colors.primarySoft },
  lockedText: { color: colors.text, fontSize: 14, lineHeight: 20 },
  lockedCreate: { minHeight: TOUCH, justifyContent: "center", paddingHorizontal: 14, borderRadius: radius.pill, backgroundColor: colors.primary },
  lockedCreateText: { color: colors.onPrimary, fontWeight: "700", fontSize: 14 },
  close: { width: TOUCH, height: TOUCH, alignItems: "center", justifyContent: "center" },
}));

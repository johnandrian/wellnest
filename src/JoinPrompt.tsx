// Joining a care circle from an invite link (./invite.ts, convex/circle.ts). After sign-in and account setup, a card
// over the chat says whose circle it is and what joining means, with Join and Not now. It fades and scales in and out.
import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Animated, Text, View } from "react-native";
import { useMutation, useQuery } from "convex/react";
import { api } from "../convex/_generated/api";
import { Tap } from "./Tap";
import { Icon } from "./Icon";
import { usePresence } from "./Motion";
import { clearInvite, pendingInvite } from "./invite";
import { colors, radius, tint, TOUCH, ui, themed } from "./theme";
import type { Strings } from "./i18n";

export function JoinPrompt({ s, onOpenCircle }: { s: Strings; onOpenCircle: () => void }) {
  const [token, setToken] = useState<string | null>(() => pendingInvite());
  const now = useMemo(() => Date.now(), []);
  const info = useQuery(api.circle.inviteInfo, token ? { token, now } : "skip");
  const join = useMutation(api.circle.join);
  const [busy, setBusy] = useState(false);
  const [joined, setJoined] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const open = !!token && info !== undefined;
  const { t, mounted } = usePresence(open);
  // What the card last said, so it doesn't go blank while it fades out.
  const [shown, setShown] = useState<{ title: string; body: string; kind: "ask" | "done" | "gone" } | null>(null);

  const close = () => {
    clearInvite();
    setToken(null);
  };

  useEffect(() => {
    if (!open) return;
    if (joined) setShown({ title: s.joinDone.replace("{name}", joined), body: "", kind: "done" });
    else if (info === null) setShown({ title: s.joinInvalid, body: "", kind: "gone" });
    else if (info?.own) setShown({ title: s.joinOwn, body: "", kind: "gone" });
    else if (info) setShown({ title: s.joinTitle.replace("{name}", info.name), body: s.joinBody, kind: "ask" });
  }, [open, info, joined, s]);

  const accept = async () => {
    if (!token) return;
    setBusy(true);
    setError(null);
    try {
      const res = await join({ token });
      clearInvite();
      setJoined(res.name);
    } catch (e) {
      setError((e as Error).message.replace(/^.*Uncaught Error: /, "").split("\n")[0]);
    } finally {
      setBusy(false);
    }
  };

  if (!mounted || !shown) return null;
  return (
    <View style={styles.overlay} pointerEvents={open ? "auto" : "none"}>
      <Animated.View style={[styles.backdrop, { opacity: t }]} />
      <Animated.View
        style={[styles.card, { opacity: t, transform: [{ scale: t.interpolate({ inputRange: [0, 1], outputRange: [0.96, 1] }) }] }]}
        accessibilityViewIsModal
        accessibilityRole="alert"
      >
        <View style={[styles.badge, { backgroundColor: tint.circle.bg }]}>
          <Icon name={shown.kind === "done" ? "doses" : "circle"} size={26} color={tint.circle.fg} />
        </View>
        <Text style={styles.title} accessibilityRole="header">
          {shown.title}
        </Text>
        {!!shown.body && <Text style={styles.body}>{shown.body}</Text>}
        {error && <Text style={styles.error}>{error}</Text>}
        {shown.kind === "ask" ? (
          <View style={styles.actions}>
            <Tap style={styles.secondary} onPress={close} accessibilityRole="button">
              <Text style={styles.secondaryText}>{s.joinDecline}</Text>
            </Tap>
            <Tap style={styles.primary} onPress={() => void accept()} disabled={busy} accessibilityRole="button">
              {busy ? <ActivityIndicator color={colors.onPrimary} /> : <Text style={styles.primaryText}>{s.joinAccept}</Text>}
            </Tap>
          </View>
        ) : (
          <View style={styles.actions}>
            <Tap style={styles.secondary} onPress={close} accessibilityRole="button">
              <Text style={styles.secondaryText}>{s.close}</Text>
            </Tap>
            {shown.kind === "done" && (
              <Tap
                style={styles.primary}
                onPress={() => {
                  close();
                  onOpenCircle();
                }}
                accessibilityRole="button"
              >
                <Text style={styles.primaryText}>{s.joinOpen}</Text>
              </Tap>
            )}
          </View>
        )}
      </Animated.View>
    </View>
  );
}

const styles = themed(() => ({
  overlay: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, zIndex: 30, alignItems: "center", justifyContent: "center", padding: 16 },
  backdrop: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: colors.backdrop },
  card: { ...ui.card, width: "100%", maxWidth: 440, padding: 20, gap: 10, borderRadius: radius.lg },
  badge: { width: 52, height: 52, borderRadius: 26, alignItems: "center", justifyContent: "center", alignSelf: "center" },
  title: { fontSize: 19, lineHeight: 25, fontWeight: "700", color: colors.text, textAlign: "center" },
  body: { fontSize: 15, lineHeight: 21, color: colors.muted, textAlign: "center" },
  error: { fontSize: 14, color: colors.danger, textAlign: "center" },
  actions: { flexDirection: "row", gap: 10, marginTop: 8 },
  primary: { ...ui.button, flex: 1 },
  primaryText: { color: colors.onPrimary, fontSize: 16, fontWeight: "700" },
  secondary: { flex: 1, minHeight: TOUCH, alignItems: "center", justifyContent: "center", borderRadius: radius.md, borderWidth: 1, borderColor: colors.inputBorder, backgroundColor: colors.surface },
  secondaryText: { color: colors.text, fontSize: 16, fontWeight: "600" },
}));

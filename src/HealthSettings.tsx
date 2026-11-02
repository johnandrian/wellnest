// The phone health data part of Settings (Apple Health on iPhone, Health Connect on Android): connect, sync status,
// sharing with analyses, disconnect. The web app shows the status and can disconnect.
import { ActivityIndicator, Alert, Platform, Pressable, StyleSheet, Switch, Text, View } from "react-native";
import { useMutation } from "convex/react";
import { Ionicons } from "@expo/vector-icons";
import { api } from "../convex/_generated/api";
import { colors } from "./theme";
import type { HealthSync } from "./useHealthSync";
import type { Strings } from "./i18n";

function confirm(title: string, message: string, action: string, cancel: string): Promise<boolean> {
  if (Platform.OS === "web") return Promise.resolve(window.confirm(message));
  return new Promise((resolve) =>
    Alert.alert(title, message, [
      { text: cancel, style: "cancel", onPress: () => resolve(false) },
      { text: action, style: "destructive", onPress: () => resolve(true) },
    ]),
  );
}

export function ago(ms: number, s: Strings, now = Date.now()) {
  const min = Math.round((now - ms) / 60_000);
  if (min < 1) return s.justNow;
  if (min < 60) return s.minAgo.replace("{n}", String(min));
  const h = Math.round(min / 60);
  return h < 24 ? s.hAgo.replace("{n}", String(h)) : s.dAgo.replace("{n}", String(Math.round(h / 24)));
}

export function HealthSettings({ health, s }: { health: HealthSync; s: Strings }) {
  const setShare = useMutation(api.health.setShareWithAnalysis);
  const disconnect = useMutation(api.health.disconnect);
  const { status } = health;
  if (!status) return null;

  const onDisconnect = async () => {
    const ok = await confirm(
      s.healthDisconnectTitle.replace("{name}", health.name),
      s.healthDisconnectBody.replace("{name}", health.name),
      s.disconnect,
      s.cancel,
    );
    if (ok) await disconnect();
  };

  return (
    <View style={styles.box}>
      <View style={styles.titleRow}>
        <Ionicons name="heart" size={18} color="#E5484D" />
        <Text style={styles.title}>{health.name}</Text>
        {health.syncing && <ActivityIndicator size="small" color={colors.primary} />}
      </View>

      {!status.connected ? (
        health.supported ? (
          <>
            <Text style={styles.note}>{s.healthIntro}</Text>
            <Pressable style={styles.button} onPress={() => void health.connect()} accessibilityRole="button">
              <Text style={styles.buttonText}>{s.healthConnect.replace("{name}", health.name)}</Text>
            </Pressable>
          </>
        ) : (
          <Text style={styles.note}>{s.healthWebNote}</Text>
        )
      ) : (
        <>
          <Text style={styles.note}>
            {s.healthStatus.replace("{ago}", ago(status.syncedAt, s))}
            {status.latestDate ? s.healthLatest.replace("{date}", status.latestDate) : ""}
          </Text>
          <View style={styles.row}>
            <Text style={styles.label}>{s.healthShare}</Text>
            <Switch value={status.shareWithAnalysis} onValueChange={(enabled) => void setShare({ enabled })} />
          </View>
          <Text style={styles.small}>{s.healthShareNote}</Text>
          <View style={styles.actions}>
            {health.supported && (
              <Pressable onPress={() => void health.syncNow()} disabled={health.syncing} accessibilityRole="button">
                <Text style={styles.link}>{s.syncNow}</Text>
              </Pressable>
            )}
            <Pressable onPress={() => void onDisconnect()} accessibilityRole="button">
              <Text style={[styles.link, styles.danger]}>{s.disconnectDelete}</Text>
            </Pressable>
          </View>
        </>
      )}
      {health.error && <Text style={styles.error}>{health.error}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { borderWidth: 1, borderColor: colors.border, borderRadius: 10, padding: 12, gap: 8 },
  titleRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  title: { fontSize: 16, fontWeight: "600", color: colors.text, flex: 1 },
  note: { color: colors.muted, fontSize: 14, lineHeight: 19 },
  small: { color: colors.muted, fontSize: 12 },
  row: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  label: { fontSize: 15, color: colors.text },
  button: { backgroundColor: colors.primary, borderRadius: 10, padding: 11, alignItems: "center" },
  buttonText: { color: "#fff", fontWeight: "600" },
  actions: { flexDirection: "row", gap: 20 },
  link: { color: colors.primary, fontWeight: "600" },
  danger: { color: colors.danger },
  error: { color: colors.danger, fontSize: 13 },
});

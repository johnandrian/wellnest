// The Apple Health part of Settings: connect (iPhone only), sync status, sharing with analyses, disconnect.
import { ActivityIndicator, Alert, Platform, Pressable, StyleSheet, Switch, Text, View } from "react-native";
import { useMutation } from "convex/react";
import { Ionicons } from "@expo/vector-icons";
import { api } from "../convex/_generated/api";
import { colors } from "./theme";
import type { HealthSync } from "./useHealthSync";

function confirm(title: string, message: string, action: string): Promise<boolean> {
  if (Platform.OS === "web") return Promise.resolve(window.confirm(message));
  return new Promise((resolve) =>
    Alert.alert(title, message, [
      { text: "Cancel", style: "cancel", onPress: () => resolve(false) },
      { text: action, style: "destructive", onPress: () => resolve(true) },
    ]),
  );
}

export function ago(ms: number, now = Date.now()) {
  const min = Math.round((now - ms) / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  const h = Math.round(min / 60);
  return h < 24 ? `${h} h ago` : `${Math.round(h / 24)} d ago`;
}

export function HealthSettings({ health }: { health: HealthSync }) {
  const setShare = useMutation(api.health.setShareWithAnalysis);
  const disconnect = useMutation(api.health.disconnect);
  const { status } = health;
  if (!status) return null;

  const onDisconnect = async () => {
    const ok = await confirm(
      "Disconnect Apple Health?",
      "Wellnest will stop syncing and delete the Apple Health summaries it has. Your data in the Health app isn't touched.",
      "Disconnect",
    );
    if (ok) await disconnect();
  };

  return (
    <View style={styles.box}>
      <View style={styles.titleRow}>
        <Ionicons name="heart" size={18} color="#E5484D" />
        <Text style={styles.title}>Apple Health</Text>
        {health.syncing && <ActivityIndicator size="small" color={colors.primary} />}
      </View>

      {!status.connected ? (
        health.supported ? (
          <>
            <Text style={styles.note}>
              Share daily summaries (sleep, steps, heart rate, HRV, breathing, SpO2, wrist temperature, weight and periods
              logged by apps like Flo) so Wellnest can use them in answers. Only daily totals are sent, never raw readings.
            </Text>
            <Pressable style={styles.button} onPress={() => void health.connect()} accessibilityRole="button">
              <Text style={styles.buttonText}>Connect Apple Health</Text>
            </Pressable>
          </>
        ) : (
          <Text style={styles.note}>Connect Apple Health from the Wellnest iPhone app. Once synced, it's used here too.</Text>
        )
      ) : (
        <>
          <Text style={styles.note}>
            Connected · synced {ago(status.syncedAt)}
            {status.latestDate ? ` · latest day ${status.latestDate}` : ""}
          </Text>
          <View style={styles.row}>
            <Text style={styles.label}>Include in symptom analyses</Text>
            <Switch value={status.shareWithAnalysis} onValueChange={(enabled) => void setShare({ enabled })} />
          </View>
          <Text style={styles.small}>Detailed analyses run on CREAO; with this on, your summaries are sent along.</Text>
          <View style={styles.actions}>
            {health.supported && (
              <Pressable onPress={() => void health.syncNow()} disabled={health.syncing} accessibilityRole="button">
                <Text style={styles.link}>Sync now</Text>
              </Pressable>
            )}
            <Pressable onPress={() => void onDisconnect()} accessibilityRole="button">
              <Text style={[styles.link, styles.danger]}>Disconnect and delete</Text>
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

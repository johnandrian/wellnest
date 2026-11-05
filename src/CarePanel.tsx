// Care tab: telehealth video visits (./TelehealthCard), and nearby ERs, urgent care, pharmacies and doctors
// (convex/care.ts, OpenStreetMap) with Call and Directions. In an emergency, call 911.
import { useState } from "react";
import { ActivityIndicator, Linking, Platform, ScrollView, Text, View } from "react-native";
import { Tap } from "./Tap";
import { useAction } from "convex/react";
import { Ionicons } from "@expo/vector-icons";
import * as Location from "expo-location";
import { api } from "../convex/_generated/api";
import { colors, round, themed, ui } from "./theme";
import type { Strings } from "./i18n";
import { TelehealthCard } from "./TelehealthCard";
import { EmergencyCard } from "./EmergencyCard";
import { Icon, IconName } from "./Icon";
import { SwapIcon } from "./Motion";

type Kind = "er" | "urgent_care" | "pharmacy" | "doctor";
type Place = { name: string; lat: number; lon: number; km: number; phone?: string; address?: string; hours?: string; open24?: boolean };

const KINDS: { kind: Kind; icon: IconName; label: (s: Strings) => string }[] = [
  { kind: "urgent_care", icon: "urgentCare", label: (s) => s.careUrgent },
  { kind: "er", icon: "er", label: (s) => s.careEr },
  { kind: "pharmacy", icon: "pharmacy", label: (s) => s.carePharmacy },
  { kind: "doctor", icon: "doctor", label: (s) => s.careDoctor },
];

const directions = (p: Place) => `https://www.google.com/maps/dir/?api=1&destination=${p.lat},${p.lon}`;

async function here(): Promise<{ lat: number; lon: number } | null> {
  const perm = await Location.requestForegroundPermissionsAsync();
  if (!perm.granted) return null;
  const pos = (await Location.getLastKnownPositionAsync({ maxAge: 10 * 60_000 })) ?? (await Location.getCurrentPositionAsync({}));
  return { lat: pos.coords.latitude, lon: pos.coords.longitude };
}

export function CarePanel({ s }: { s: Strings }) {
  const search = useAction(api.care.search);
  const [kind, setKind] = useState<Kind | null>(null);
  const [useHere, setUseHere] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ places: Place[]; near: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async (k: Kind, withHere = useHere) => {
    setKind(k);
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      let coords: { lat: number; lon: number } | null = null;
      if (withHere) {
        coords = await here().catch(() => null);
        if (!coords) setError(s.careNoLocationPermission);
      }
      const res = await search({ kind: k, ...(coords && { lat: coords.lat, lon: coords.lon }) });
      if ("error" in res) setError(res.error);
      else setResult(res);
    } catch (e) {
      setError((e as Error).message.replace(/^.*Uncaught Error: /, "").split("\n")[0]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.panel}>
      <Tap style={styles.emergency} onPress={() => void Linking.openURL(`tel:${s.emergencyNumber}`)} accessibilityRole="button">
        <Ionicons name="call" size={18} color={colors.onPrimary} />
        <Text style={styles.emergencyText}>{s.careCall911}</Text>
      </Tap>

      <EmergencyCard s={s} />
      <TelehealthCard s={s} />

      <Text style={styles.section}>{s.careNearby}</Text>
      <View style={styles.kinds}>
        {KINDS.map((k) => (
          <Tap
            key={k.kind}
            style={[styles.kind, kind === k.kind && styles.kindOn]}
            onPress={() => void run(k.kind)}
            accessibilityRole="button"
            accessibilityState={{ selected: kind === k.kind }}
          >
            <Icon name={k.icon} size={16} color={kind === k.kind ? colors.primary : colors.text} />
            <Text style={[styles.kindText, kind === k.kind && styles.kindTextOn]}>{k.label(s)}</Text>
          </Tap>
        ))}
      </View>
      <Tap
        style={styles.toggle}
        onPress={() => {
          const next = !useHere;
          setUseHere(next);
          if (kind) void run(kind, next);
        }}
        accessibilityRole="switch"
        accessibilityState={{ checked: useHere }}
      >
        <SwapIcon id={useHere ? "on" : "off"}>
          <Ionicons name={useHere ? "checkbox" : "square-outline"} size={20} color={colors.primary} />
        </SwapIcon>
        <Text style={styles.line}>{s.careUseHere}</Text>
      </Tap>

      {busy && <ActivityIndicator color={colors.primary} />}
      {error && <Text style={styles.error}>{error}</Text>}
      {result && (
        <>
          <Text style={styles.small}>
            {s.careNear.replace("{place}", result.near)} · {s.careHoursNote}
          </Text>
          {result.places.length === 0 && <Text style={styles.empty}>{s.careNone}</Text>}
          {result.places.map((p) => (
            <View key={`${p.name}-${p.lat}`} style={styles.card}>
              <Text style={styles.name}>{p.name}</Text>
              <Text style={styles.small}>
                {p.km} km{p.address ? ` · ${p.address}` : ""}
                {p.open24 ? ` · ${s.careOpen24}` : p.hours ? ` · ${p.hours}` : ""}
              </Text>
              <View style={styles.actions}>
                {p.phone && (
                  <Tap style={styles.action} onPress={() => void Linking.openURL(`tel:${p.phone!.replace(/[^\d+]/g, "")}`)} accessibilityRole="button">
                    <Ionicons name="call-outline" size={16} color={colors.primary} />
                    <Text style={styles.link}>{s.careCall}</Text>
                  </Tap>
                )}
                <Tap style={styles.action} onPress={() => void Linking.openURL(directions(p))} accessibilityRole="link">
                  <Ionicons name="navigate-outline" size={16} color={colors.primary} />
                  <Text style={styles.link}>{s.careDirections}</Text>
                </Tap>
              </View>
            </View>
          ))}
          <Text style={styles.attribution}>© OpenStreetMap contributors</Text>
        </>
      )}
    </ScrollView>
  );
}

const styles = themed(() => ({
  scroll: { flex: 1, backgroundColor: colors.bg },
  panel: { padding: 16, gap: 10, maxWidth: 760, width: "100%", alignSelf: "center" },
  emergency: { flexDirection: "row", gap: 8, alignItems: "center", justifyContent: "center", backgroundColor: colors.danger, borderRadius: round(10), padding: 11 },
  emergencyText: { color: colors.onPrimary, fontWeight: "700", fontSize: 14 },
  section: { fontSize: 17, fontWeight: "700", color: colors.text, marginTop: 6 },
  kinds: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  kind: { ...ui.chip, flexDirection: "row", alignItems: "center", gap: 5 },
  kindOn: { backgroundColor: colors.primarySoft, borderColor: colors.primary },
  kindText: { color: colors.text, fontSize: 14 },
  kindTextOn: { color: colors.primary, fontWeight: "600" },
  toggle: { flexDirection: "row", alignItems: "center", gap: 6, alignSelf: "flex-start" },
  line: { color: colors.text, fontSize: 14 },
  small: { color: colors.muted, fontSize: 13 },
  empty: { ...ui.empty },
  card: { ...ui.card, padding: 10, gap: 4 },
  name: { fontSize: 15, fontWeight: "600", color: colors.text },
  actions: { flexDirection: "row", gap: 18, marginTop: 2 },
  action: { flexDirection: "row", alignItems: "center", gap: 4 },
  link: { color: colors.primary, fontWeight: "600", fontSize: 14 },
  error: { color: colors.danger, fontSize: 13 },
  attribution: { color: colors.muted, fontSize: 12, textAlign: Platform.OS === "web" ? "right" : "left" },
}));

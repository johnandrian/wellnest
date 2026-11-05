// Share links (convex/share.ts): a private, read-only page of the sections you choose for a carer or doctor, with an
// expiry, open counts, and a switch to turn it off.
import { useMemo, useState } from "react";
import { Platform, Share, Text, TextInput, View } from "react-native";
import { Tap } from "./Tap";
import { useMutation, useQuery } from "convex/react";
import { Ionicons } from "@expo/vector-icons";
import { api } from "../convex/_generated/api";
import { colors, pillish, round, themed, TOUCH, ui } from "./theme";
import type { Strings } from "./i18n";
import { ReportSection, SectionChips } from "./ReportCard";

const RANGES = [30, 90, 365];
const EXPIRIES: (number | null)[] = [1, 7, 30, null];

export async function shareUrl(url: string, title: string) {
  if (Platform.OS === "web") {
    await navigator.clipboard.writeText(url);
    return "copied";
  }
  await Share.share({ message: url, url, title });
  return "shared";
}

const ago = (ms: number) => new Date(ms).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

export function ShareCard({ s, presetSections, presetLabel }: { s: Strings; presetSections?: ReportSection[]; presetLabel?: string }) {
  const now = useMemo(() => Math.floor(Date.now() / 60_000) * 60_000, []);
  const links = useQuery(api.share.list, { now });
  const create = useMutation(api.share.create);
  const revoke = useMutation(api.share.revoke);
  const [making, setMaking] = useState(false);
  const [label, setLabel] = useState(presetLabel ?? "");
  const [sections, setSections] = useState<ReportSection[]>(presetSections ?? ["medications", "journal", "trackers", "appointments"]);
  const [rangeDays, setRangeDays] = useState(90);
  const [expires, setExpires] = useState<number | null>(7);
  const [made, setMade] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const make = async () => {
    setError(null);
    try {
      const { url } = await create({ label: label || undefined, sections, rangeDays, expiresInDays: expires });
      setMade(url);
      setMaking(false);
      setLabel("");
    } catch (e) {
      setError((e as Error).message.replace(/^.*Uncaught Error: /, "").split("\n")[0]);
    }
  };

  const send = async (url: string) => {
    const how = await shareUrl(url, s.shareTitle).catch(() => null);
    if (how === "copied") {
      setNotice(s.copied);
      setTimeout(() => setNotice(null), 2000);
    }
  };

  const active = links?.filter((l) => l.status === "active") ?? [];
  const old = links?.filter((l) => l.status !== "active").slice(0, 5) ?? [];

  return (
    <View style={styles.card}>
      <View style={styles.inline}>
        <Ionicons name="link-outline" size={20} color={colors.primary} />
        <Text style={styles.title}>{s.shareTitle}</Text>
      </View>
      <Text style={styles.note}>{s.shareIntro}</Text>

      {made && (
        <View style={styles.made}>
          <Text style={styles.url} selectable numberOfLines={2}>{made}</Text>
          <Tap style={styles.button} onPress={() => void send(made)} accessibilityRole="button">
            <Ionicons name={Platform.OS === "web" ? "copy-outline" : "share-outline"} size={16} color={colors.onPrimary} />
            <Text style={styles.buttonText}>{Platform.OS === "web" ? s.copy : s.share}</Text>
          </Tap>
        </View>
      )}
      {notice && <Text style={styles.small}>✓ {notice}</Text>}

      {making ? (
        <View style={styles.form}>
          <TextInput style={styles.input} placeholder={s.shareLabelPlaceholder} placeholderTextColor={colors.muted} value={label} onChangeText={setLabel} maxLength={80} />
          <SectionChips value={sections} onChange={setSections} s={s} />
          <Text style={styles.label}>{s.shareRange}</Text>
          <View style={styles.chips}>
            {RANGES.map((n) => (
              <Tap key={n} style={[styles.chip, rangeDays === n && styles.chipOn]} onPress={() => setRangeDays(n)} accessibilityRole="radio" accessibilityState={{ selected: rangeDays === n }}>
                <Text style={[styles.chipText, rangeDays === n && styles.chipTextOn]}>{n === 365 ? s.lastYear : s.lastNDays.replace("{n}", String(n))}</Text>
              </Tap>
            ))}
          </View>
          <Text style={styles.label}>{s.shareExpires}</Text>
          <View style={styles.chips}>
            {EXPIRIES.map((n) => (
              <Tap key={String(n)} style={[styles.chip, expires === n && styles.chipOn]} onPress={() => setExpires(n)} accessibilityRole="radio" accessibilityState={{ selected: expires === n }}>
                <Text style={[styles.chipText, expires === n && styles.chipTextOn]}>{n === null ? s.shareNoExpiry : n === 1 ? s.share1Day : s.shareNDays.replace("{n}", String(n))}</Text>
              </Tap>
            ))}
          </View>
          <View style={styles.inline}>
            <Tap style={styles.button} onPress={() => void make()} disabled={!sections.length} accessibilityRole="button">
              <Text style={styles.buttonText}>{s.shareCreate}</Text>
            </Tap>
            <Tap onPress={() => setMaking(false)} accessibilityRole="button">
              <Text style={styles.link}>{s.cancel}</Text>
            </Tap>
          </View>
        </View>
      ) : (
        <Tap style={styles.addRow} onPress={() => (setMaking(true), setMade(null))} accessibilityRole="button">
          <Ionicons name="add-circle-outline" size={20} color={colors.primary} />
          <Text style={styles.link}>{s.shareNew}</Text>
        </Tap>
      )}
      {error && <Text style={styles.error}>{error}</Text>}

      {active.map((l) => (
        <View key={l._id} style={styles.linkRow}>
          <View style={styles.flex}>
            <Text style={styles.linkTitle}>{l.label ?? s.shareUnnamed}</Text>
            <Text style={styles.small}>
              {l.sections.map((x) => s[`rsec_${x}`]).join(", ")} · {l.expiresAt ? s.shareUntil.replace("{when}", ago(l.expiresAt)) : s.shareNoExpiry}
            </Text>
            <Text style={styles.small}>{l.lastOpenedAt ? s.shareOpened.replace("{n}", String(l.opens)).replace("{when}", ago(l.lastOpenedAt)) : s.shareNotOpened}</Text>
          </View>
          <Tap onPress={() => void send(l.url)} accessibilityRole="button" accessibilityLabel={Platform.OS === "web" ? s.copy : s.share}>
            <Ionicons name={Platform.OS === "web" ? "copy-outline" : "share-outline"} size={20} color={colors.primary} />
          </Tap>
          <Tap onPress={() => void revoke({ id: l._id })} accessibilityRole="button" accessibilityLabel={s.shareTurnOff}>
            <Text style={[styles.link, styles.danger]}>{s.shareTurnOff}</Text>
          </Tap>
        </View>
      ))}
      {old.map((l) => (
        <Text key={l._id} style={styles.small}>
          {l.label ?? s.shareUnnamed} · {l.status === "off" ? s.shareIsOff : s.shareIsExpired}
          {l.opens ? ` · ${s.shareOpened.replace("{n}", String(l.opens)).replace("{when}", ago(l.lastOpenedAt!))}` : ""}
        </Text>
      ))}
    </View>
  );
}

const styles = themed(() => ({
  card: { ...ui.card, padding: 12, gap: 8, marginTop: 6 },
  title: { fontSize: 16, fontWeight: "700", color: colors.text },
  note: { color: colors.muted, fontSize: 14, lineHeight: 19 },
  small: { color: colors.muted, fontSize: 12 },
  label: { color: colors.text, fontSize: 13, fontWeight: "600" },
  inline: { flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" },
  form: { gap: 8 },
  input: { color: colors.text, borderWidth: 1, borderColor: colors.inputBorder, backgroundColor: colors.surface, borderRadius: round(8), paddingHorizontal: 10, paddingVertical: 8, fontSize: 15, minWidth: 0 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  chip: { ...ui.chip },
  chipOn: { backgroundColor: colors.primarySoft, borderColor: colors.primary },
  chipText: { color: colors.text, fontSize: 13 },
  chipTextOn: { color: colors.primary, fontWeight: "600" },
  made: { backgroundColor: colors.primarySoft, borderRadius: round(8), padding: 10, gap: 8 },
  url: { color: colors.text, fontSize: 13 },
  button: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, backgroundColor: colors.primary, borderRadius: pillish(10), paddingVertical: 9, paddingHorizontal: 14, alignSelf: "flex-start", minHeight: TOUCH },
  buttonText: { color: colors.onPrimary, fontWeight: "600", fontSize: 14 },
  addRow: { ...ui.addButton },
  link: { color: colors.primary, fontWeight: "600", fontSize: 14 },
  danger: { color: colors.danger },
  linkRow: { flexDirection: "row", alignItems: "center", gap: 12, borderTopWidth: 1, borderTopColor: colors.bg, paddingTop: 8 },
  linkTitle: { fontSize: 14, fontWeight: "600", color: colors.text },
  flex: { flex: 1, minWidth: 0 },
  error: { color: colors.danger, fontSize: 13 },
}));

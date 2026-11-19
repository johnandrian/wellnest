// The pieces of "Share with my doctor" (./SharePanel.tsx): the time span and sections picked once for everything, a
// PDF report of them (convex/reports.ts: expo-print and the share sheet on phones, the print dialog on the web), and
// private read-only links (convex/share.ts) with an expiry, open counts, a QR code to scan off the screen, a preview of
// what the doctor sees, and a switch to turn each off (after a yes / no question).
import { useMemo, useState } from "react";
import { ActivityIndicator, Linking, Platform, Share, Text, TextInput, View } from "react-native";
import { Tap } from "./Tap";
import { useConvex, useMutation, useQuery } from "convex/react";
import { Ionicons } from "@expo/vector-icons";
import * as Print from "expo-print";
import * as Sharing from "expo-sharing";
import { api } from "../convex/_generated/api";
import { colors, themed, TOUCH, ui, radius } from "./theme";
import { confirmAsk, errorText, showToast } from "./feedback";
import { QrCode } from "./QrCode";
import { Reveal } from "./Motion";
import type { Strings } from "./i18n";
import { localDate } from "./DailyCard";
import { SwapIcon } from "./Motion";
import { DateField } from "./DateTimeField";
import { formatDateTime } from "./format";

export const REPORT_SECTIONS = ["facts", "medications", "journal", "trackers", "exercises", "health", "appointments", "emergency"] as const;
export type ReportSection = (typeof REPORT_SECTIONS)[number];
const PRESETS = [30, 90, 365];
const EXPIRIES: (number | null)[] = [1, 7, 30, null];

export const daysAgo = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return localDate(d);
};

// Days from `from` to today, counting both: a link's range always runs up to today.
export const daysSince = (from: string) => Math.max(1, Math.round((Date.parse(`${localDate()}T00:00:00`) - Date.parse(`${from}T00:00:00`)) / 86_400_000) + 1);

export async function shareUrl(url: string, title: string) {
  if (Platform.OS === "web") {
    await navigator.clipboard.writeText(url);
    return "copied";
  }
  await Share.share({ message: url, url, title });
  return "shared";
}

export function SectionChips({ value, onChange, s }: { value: ReportSection[]; onChange: (v: ReportSection[]) => void; s: Strings }) {
  return (
    <View style={styles.chips}>
      {REPORT_SECTIONS.map((x) => {
        const on = value.includes(x);
        return (
          <Tap key={x} style={[styles.chip, styles.iconChip, on && styles.chipOn]} onPress={() => onChange(on ? value.filter((y) => y !== x) : [...value, x])} accessibilityRole="checkbox" accessibilityState={{ checked: on }}>
            <SwapIcon id={on ? "on" : "off"}>
              <Ionicons name={on ? "checkbox" : "square-outline"} size={14} color={on ? colors.primary : colors.muted} />
            </SwapIcon>
            <Text style={[styles.chipText, on && styles.chipTextOn]}>{s[`rsec_${x}`]}</Text>
          </Tap>
        );
      })}
    </View>
  );
}

export function RangePicker({ from, to, onChange, s }: { from: string; to: string; onChange: (from: string, to: string) => void; s: Strings }) {
  return (
    <View style={styles.form}>
      <View style={styles.chips}>
        {PRESETS.map((n) => {
          const on = from === daysAgo(n - 1) && to === localDate();
          return (
            <Tap key={n} style={[styles.chip, on && styles.chipOn]} onPress={() => onChange(daysAgo(n - 1), localDate())} accessibilityRole="radio" accessibilityState={{ selected: on }}>
              <Text style={[styles.chipText, on && styles.chipTextOn]}>{n === 365 ? s.lastYear : s.lastNDays.replace("{n}", String(n))}</Text>
            </Tap>
          );
        })}
      </View>
      <View style={styles.inline}>
        <DateField value={from} onChange={(v) => onChange(v, to)} label={s.reportFrom} s={s} />
        <Text style={styles.label}>–</Text>
        <DateField value={to} onChange={(v) => onChange(from, v)} label={s.reportTo} s={s} />
      </View>
    </View>
  );
}

// The PDF report of the chosen span and sections.
export function PdfAction({ s, from, to, sections }: { s: Strings; from: string; to: string; sections: ReportSection[] }) {
  const convex = useConvex();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const make = async () => {
    setError(null);
    setBusy(true);
    try {
      const html = await convex.query(api.reports.html, { from, to, sections, generated: new Date().toLocaleString(s.locale) });
      if (Platform.OS === "web") {
        const win = window.open("", "_blank");
        if (!win) throw new Error(s.allowPopups);
        win.document.write(html);
        win.document.close();
        win.focus();
        win.print();
      } else {
        const { uri } = await Print.printToFileAsync({ html });
        if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(uri, { mimeType: "application/pdf", UTI: "com.adobe.pdf", dialogTitle: s.reportTitle });
        else await Print.printAsync({ uri });
      }
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.form}>
      <Text style={styles.note}>{s.reportIntro}</Text>
      <Tap style={[styles.button, busy && styles.busy]} onPress={() => void make()} disabled={busy || !sections.length} accessibilityRole="button" accessibilityState={{ busy, disabled: !sections.length }}>
        {busy ? <ActivityIndicator color={colors.onPrimary} /> : <Ionicons name={Platform.OS === "web" ? "print-outline" : "share-outline"} size={18} color={colors.onPrimary} />}
        <Text style={styles.buttonText}>{Platform.OS === "web" ? s.reportPrint : s.reportShare}</Text>
      </Tap>
      {!sections.length && <Text style={styles.small}>{s.shareNeedSection}</Text>}
      {error && <Text style={styles.error}>{error}</Text>}
    </View>
  );
}

// A new private link to the chosen sections, from the start of the span up to today.
export function LinkAction({ s, from, sections }: { s: Strings; from: string; sections: ReportSection[] }) {
  const create = useMutation(api.share.create);
  const [label, setLabel] = useState("");
  const [expires, setExpires] = useState<number | null>(7);
  const [made, setMade] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const make = async () => {
    setError(null);
    try {
      const { url } = await create({ label: label || undefined, sections, rangeDays: daysSince(from), expiresInDays: expires });
      setMade(url);
      setLabel("");
    } catch (e) {
      setError(errorText(e));
    }
  };

  return (
    <View style={styles.form}>
      <Text style={styles.note}>{s.shareIntro}</Text>
      {made && (
        <View style={styles.made}>
          <Text style={styles.url} selectable numberOfLines={2}>
            {made}
          </Text>
          <QrCode value={made} size={180} label={s.shareQrLabel} />
          <Text style={[styles.small, styles.center]}>{s.shareQrHint}</Text>
          <View style={styles.inline}>
            <SendButton url={made} s={s} />
            <PreviewButton url={made} s={s} />
          </View>
        </View>
      )}
      <TextInput style={styles.input} placeholder={s.shareLabelPlaceholder} placeholderTextColor={colors.muted} accessibilityLabel={s.shareLabelPlaceholder} value={label} onChangeText={setLabel} maxLength={80} />
      <Text style={styles.label}>{s.shareExpires}</Text>
      <View style={styles.chips}>
        {EXPIRIES.map((n) => (
          <Tap key={String(n)} style={[styles.chip, expires === n && styles.chipOn]} onPress={() => setExpires(n)} accessibilityRole="radio" accessibilityState={{ selected: expires === n }}>
            <Text style={[styles.chipText, expires === n && styles.chipTextOn]}>
              {n === null ? s.shareNoExpiry
              : n === 1 ? s.share1Day
              : s.shareNDays.replace("{n}", String(n))}
            </Text>
          </Tap>
        ))}
      </View>
      <Tap style={styles.button} onPress={() => void make()} disabled={!sections.length} accessibilityRole="button" accessibilityState={{ disabled: !sections.length }}>
        <Ionicons name="link-outline" size={18} color={colors.onPrimary} />
        <Text style={styles.buttonText}>{s.shareCreate}</Text>
      </Tap>
      {!sections.length && <Text style={styles.small}>{s.shareNeedSection}</Text>}
      {error && <Text style={styles.error}>{error}</Text>}
    </View>
  );
}

// Opens the link the way the doctor will see it.
function PreviewButton({ url, s }: { url: string; s: Strings }) {
  return (
    <Tap style={styles.icon} onPress={() => void Linking.openURL(url)} accessibilityRole="link" accessibilityLabel={s.sharePreview}>
      <View style={styles.inline}>
        <Ionicons name="eye-outline" size={18} color={colors.primary} />
        <Text style={styles.link}>{s.sharePreview}</Text>
      </View>
    </Tap>
  );
}

function SendButton({ url, s }: { url: string; s: Strings }) {
  const send = async () => {
    const how = await shareUrl(url, s.shareTitle).catch(() => null);
    if (how === "copied") showToast(s.copied);
  };
  return (
    <Tap style={styles.button} onPress={() => void send()} accessibilityRole="button">
      <Ionicons name={Platform.OS === "web" ? "copy-outline" : "share-outline"} size={16} color={colors.onPrimary} />
      <Text style={styles.buttonText}>{Platform.OS === "web" ? s.copy : s.share}</Text>
    </Tap>
  );
}

// The links made so far: the live ones with Send and Turn off, then the last few that are off or expired.
export function LinkList({ s }: { s: Strings }) {
  const now = useMemo(() => Math.floor(Date.now() / 60_000) * 60_000, []);
  const links = useQuery(api.share.list, { now });
  const revoke = useMutation(api.share.revoke);
  const [qrFor, setQrFor] = useState<string | null>(null);
  const turnOff = async (l: { _id: Parameters<typeof revoke>[0]["id"]; label?: string | null }) => {
    if (!(await confirmAsk({ title: s.shareTurnOffConfirm.replace("{name}", l.label ?? s.shareUnnamed), message: s.shareTurnOffBody, ok: s.shareTurnOff, cancel: s.cancel, destructive: true }))) return;
    await revoke({ id: l._id }).catch((e) => showToast(errorText(e)));
  };
  const active = links?.filter((l) => l.status === "active") ?? [];
  const old = links?.filter((l) => l.status !== "active").slice(0, 5) ?? [];
  if (!active.length && !old.length) return null;
  const when = (ms: number) => formatDateTime(ms, s);
  const send = async (url: string) => {
    const how = await shareUrl(url, s.shareTitle).catch(() => null);
    if (how === "copied") showToast(s.copied);
  };

  return (
    <View style={styles.card}>
      <Text style={styles.title}>{s.shareYourLinks}</Text>
      {active.map((l) => (
        <View key={l._id} style={styles.linkItem}>
        <View style={styles.linkRow}>
          <View style={styles.flex}>
            <Text style={styles.linkTitle}>{l.label ?? s.shareUnnamed}</Text>
            <Text style={styles.small}>
              {l.sections.map((x) => s[`rsec_${x}`]).join(", ")} · {l.expiresAt ? s.shareUntil.replace("{when}", when(l.expiresAt)) : s.shareNoExpiry}
            </Text>
            <Text style={styles.small}>{l.lastOpenedAt ? s.shareOpened.replace("{n}", String(l.opens)).replace("{when}", when(l.lastOpenedAt)) : s.shareNotOpened}</Text>
          </View>
          <Tap style={styles.icon} onPress={() => void send(l.url)} accessibilityRole="button" accessibilityLabel={Platform.OS === "web" ? s.copy : s.share}>
            <Ionicons name={Platform.OS === "web" ? "copy-outline" : "share-outline"} size={20} color={colors.primary} />
          </Tap>
          <Tap style={styles.icon} onPress={() => setQrFor(qrFor === l._id ? null : l._id)} accessibilityRole="button" accessibilityLabel={s.shareQrLabel} accessibilityState={{ expanded: qrFor === l._id }}>
            <Ionicons name="qr-code-outline" size={20} color={colors.primary} />
          </Tap>
          <Tap style={styles.icon} onPress={() => void turnOff(l)} accessibilityRole="button" accessibilityLabel={s.shareTurnOff}>
            <Text style={[styles.link, styles.danger]}>{s.shareTurnOff}</Text>
          </Tap>
        </View>
        <Reveal open={qrFor === l._id}>
          <View style={styles.qrBox}>
            <QrCode value={l.url} size={180} label={s.shareQrLabel} />
            <Text style={[styles.small, styles.center]}>{s.shareQrHint}</Text>
            <PreviewButton url={l.url} s={s} />
          </View>
        </Reveal>
        </View>
      ))}
      {old.map((l) => (
        <Text key={l._id} style={styles.small}>
          {l.label ?? s.shareUnnamed} · {l.status === "off" ? s.shareIsOff : s.shareIsExpired}
          {l.opens && l.lastOpenedAt ? ` · ${s.shareOpened.replace("{n}", String(l.opens)).replace("{when}", when(l.lastOpenedAt))}` : ""}
        </Text>
      ))}
    </View>
  );
}

const styles = themed(() => ({
  card: { ...ui.card, padding: 12, gap: 8 },
  title: { fontSize: 16, fontWeight: "700", color: colors.text },
  note: { color: colors.muted, fontSize: 14, lineHeight: 19 },
  small: { color: colors.muted, fontSize: 12 },
  form: { gap: 8 },
  inline: { flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" },
  label: { color: colors.text, fontSize: 13, fontWeight: "600" },
  input: { color: colors.text, borderWidth: 1, borderColor: colors.inputBorder, backgroundColor: colors.surface, borderRadius: 12, paddingHorizontal: 10, paddingVertical: 8, fontSize: 15, minWidth: 0 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  chip: { ...ui.chip },
  iconChip: { flexDirection: "row", alignItems: "center", gap: 4 },
  chipOn: { backgroundColor: colors.primarySoft, borderColor: colors.primary },
  chipText: { color: colors.text, fontSize: 13 },
  chipTextOn: { color: colors.primary, fontWeight: "600" },
  made: { backgroundColor: colors.primarySoft, borderRadius: 12, padding: 10, gap: 8 },
  url: { color: colors.text, fontSize: 13 },
  button: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: colors.primary, borderRadius: radius.pill, paddingVertical: 10, paddingHorizontal: 16, minHeight: TOUCH, alignSelf: "flex-start" },
  busy: { opacity: 0.7 },
  buttonText: { color: colors.onPrimary, fontWeight: "600", fontSize: 14 },
  link: { color: colors.primary, fontWeight: "600", fontSize: 14 },
  danger: { color: colors.danger },
  icon: { minWidth: TOUCH, minHeight: TOUCH, alignItems: "center", justifyContent: "center" },
  linkItem: { borderTopWidth: 1, borderTopColor: colors.hairline, paddingTop: 8 },
  linkRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  qrBox: { alignItems: "center", gap: 6, paddingVertical: 8 },
  center: { textAlign: "center" },
  linkTitle: { fontSize: 14, fontWeight: "600", color: colors.text },
  flex: { flex: 1, minWidth: 0 },
  error: { color: colors.danger, fontSize: 13 },
}));

// Records (convex/records.ts): lab reports and clinic letters added as a photo or PDF. Each is read into a plain
// summary and its test results; tests seen more than once (or out of range) get a small trend at the top.
import { useState } from "react";
import { ActivityIndicator, Alert, Linking, Platform, ScrollView, Text, View } from "react-native";
import { useMutation, useQuery } from "convex/react";
import { Ionicons } from "@expo/vector-icons";
import * as DocumentPicker from "expo-document-picker";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { Tap } from "./Tap";
import { Icon, IconName } from "./Icon";
import { colors, radius, tint, ui, themed } from "./theme";
import type { Strings } from "./i18n";
import { pickPhoto, uploadFile, uploadPhoto } from "./photo";
import { Enter, Reveal, SwapIcon } from "./Motion";

type Flag = "low" | "normal" | "high" | "abnormal";
const KIND_ICON: Record<string, IconName> = { lab: "recordLab", letter: "recordLetter", imaging: "recordImaging", other: "recordOther" };

const cleanError = (e: unknown) => (e as Error).message.replace(/^.*Uncaught Error: /, "").split("\n")[0];
const out = (f: Flag | null | undefined) => !!f && f !== "normal";

function confirm(title: string, message: string, ok: string, cancel: string): Promise<boolean> {
  if (Platform.OS === "web") return Promise.resolve(window.confirm(`${title}\n\n${message}`));
  return new Promise((resolve) =>
    Alert.alert(title, message, [
      { text: cancel, style: "cancel", onPress: () => resolve(false) },
      { text: ok, style: "destructive", onPress: () => resolve(true) },
    ]),
  );
}

const shortDate = (date: string, s: Strings) => new Date(`${date}T12:00:00`).toLocaleDateString(s.locale, { month: "short", year: "2-digit" });
const longDate = (date: string, s: Strings) => new Date(`${date}T12:00:00`).toLocaleDateString(s.locale, { day: "numeric", month: "short", year: "numeric" });
const valueText = (r: { value?: number | null; text?: string | null; unit?: string | null }) => `${r.value ?? r.text ?? ""}${r.unit ? ` ${r.unit}` : ""}`;
function rangeText(low: number | null | undefined, high: number | null | undefined, s: Strings) {
  if (low == null && high == null) return "";
  return s.recordsRange.replace("{range}", low != null && high != null ? `${low}–${high}` : low != null ? `≥ ${low}` : `≤ ${high}`);
}

function FlagChip({ flag, s }: { flag: Flag | null | undefined; s: Strings }) {
  if (!flag) return null;
  return (
    <View style={[styles.flag, out(flag) ? styles.flagOut : styles.flagOk]}>
      <Text style={[styles.flagText, out(flag) ? styles.flagTextOut : styles.flagTextOk]}>{s[`flag_${flag}`]}</Text>
    </View>
  );
}

// One test over time: a bar per result, the reference range as a band, out-of-range bars in amber.
function Trend({ t, s }: { t: { test: string; unit: string; low: number | null; high: number | null; flag: Flag | null; explanation: string; points: { date: string; value: number }[] }; s: Strings }) {
  const values = t.points.map((p) => p.value);
  // Scaled to the values and the range, not from zero, so a change from 5.9 to 6.1 shows.
  const hi = Math.max(...values, t.high ?? -Infinity);
  const lo = Math.min(...values, t.low ?? Infinity);
  const pad = (hi - lo || Math.abs(hi) || 1) * 0.25;
  const floor = Math.max(0, lo - pad);
  const span = hi + pad - floor;
  const latest = t.points[t.points.length - 1];
  const inRange = (v: number) => (t.low == null || v >= t.low) && (t.high == null || v <= t.high);
  const pct = (v: number) => `${Math.max(4, Math.min(100, ((v - floor) / span) * 100))}%` as const;
  return (
    <View style={styles.trend} accessibilityLabel={`${t.test}: ${t.points.map((p) => `${longDate(p.date, s)} ${p.value}`).join(", ")}`}>
      <View style={styles.rowTop}>
        <Text style={[styles.trendTitle, styles.flex]} numberOfLines={1}>
          {t.test}
        </Text>
        <FlagChip flag={t.flag} s={s} />
      </View>
      <Text style={styles.trendValue}>
        {valueText({ value: latest.value, unit: t.unit })} <Text style={styles.small}>· {longDate(latest.date, s)}</Text>
      </Text>
      <View style={styles.bars}>
        {t.high != null && <View style={[styles.band, { bottom: t.low != null ? pct(t.low) : 0, top: `${100 - Math.min(100, ((t.high - floor) / span) * 100)}%` }]} />}
        {t.points.slice(-8).map((p, i) => (
          <View key={`${p.date}${i}`} style={styles.barCol}>
            <View style={[styles.bar, { height: pct(p.value), backgroundColor: inRange(p.value) ? colors.primary : colors.amber }]} />
          </View>
        ))}
      </View>
      <View style={styles.barLabels}>
        {t.points.slice(-8).map((p, i) => (
          <Text key={`${p.date}${i}`} style={styles.barLabel} numberOfLines={1}>
            {shortDate(p.date, s)}
          </Text>
        ))}
      </View>
      {rangeText(t.low, t.high, s) ? <Text style={styles.small}>{rangeText(t.low, t.high, s)}</Text> : null}
    </View>
  );
}

function Detail({ id, s }: { id: Id<"records">; s: Strings }) {
  const record = useQuery(api.records.detail, { id });
  const remove = useMutation(api.records.remove);
  const [open, setOpen] = useState<string | null>(null);
  if (record === undefined) return <ActivityIndicator color={colors.primary} />;
  return (
    <View style={styles.detail}>
      {record.summary ? <Text style={styles.summary}>{record.summary}</Text> : null}
      {record.results.length > 0 && (
        <Text style={styles.label} accessibilityRole="header">
          {s.recordsTests}
        </Text>
      )}
      {record.results.map((r) => (
        <Tap key={r._id} style={styles.result} onPress={() => setOpen(open === r._id ? null : r._id)} accessibilityRole="button" accessibilityState={{ expanded: open === r._id }}>
          <View style={styles.rowTop}>
            <Text style={[styles.line, styles.flex]}>{r.test}</Text>
            <Text style={[styles.value, out(r.flag) && styles.valueOut]}>{valueText(r)}</Text>
            <FlagChip flag={r.flag} s={s} />
          </View>
          <Reveal open={open === r._id}>
            <View style={styles.explain}>
              {rangeText(r.low, r.high, s) ? <Text style={styles.small}>{rangeText(r.low, r.high, s)}</Text> : null}
              {r.explanation ? <Text style={styles.line}>{r.explanation}</Text> : null}
            </View>
          </Reveal>
        </Tap>
      ))}
      <View style={styles.actions}>
        {record.fileUrl && (
          <Tap style={styles.action} onPress={() => void Linking.openURL(record.fileUrl!)} accessibilityRole="link">
            <Icon name={record.fileType === "pdf" ? "pdf" : "photo"} size={18} color={colors.primary} />
            <Text style={styles.link}>{s.recordsOpenFile}</Text>
          </Tap>
        )}
        <Tap
          style={styles.action}
          onPress={async () => {
            if (await confirm(s.recordsDeleteTitle, s.recordsDeleteBody, s.remove, s.cancel)) await remove({ id });
          }}
          accessibilityRole="button"
        >
          <Ionicons name="trash-outline" size={18} color={colors.danger} />
          <Text style={[styles.link, styles.danger]}>{s.remove}</Text>
        </Tap>
      </View>
    </View>
  );
}

export function RecordsPanel({ s }: { s: Strings }) {
  const records = useQuery(api.records.list);
  const trends = useQuery(api.records.trends);
  const add = useMutation(api.records.add);
  const remove = useMutation(api.records.remove);
  const uploadUrl = useMutation(api.chat.generateUploadUrl);
  const claim = useMutation(api.chat.claimUpload);
  const [open, setOpen] = useState<Id<"records"> | null>(null);
  const [busy, setBusy] = useState<"photo" | "pdf" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const upload = async (kind: "photo" | "pdf") => {
    setError(null);
    try {
      let storageId: string;
      if (kind === "photo") {
        const photo = await pickPhoto(Platform.OS === "web" ? "library" : "camera");
        if (!photo) return;
        setBusy(kind);
        storageId = await uploadPhoto(photo, () => uploadUrl(), (sid) => claim({ storageId: sid as Id<"_storage"> }));
      } else {
        const picked = await DocumentPicker.getDocumentAsync({ type: "application/pdf", copyToCacheDirectory: true });
        const file = picked.canceled ? null : picked.assets[0];
        if (!file) return;
        setBusy(kind);
        storageId = await uploadFile(file.uri, file.mimeType ?? "application/pdf", () => uploadUrl(), (sid) => claim({ storageId: sid as Id<"_storage"> }));
      }
      await add({ storageId: storageId as Id<"_storage"> });
    } catch (e) {
      setError(cleanError(e));
    } finally {
      setBusy(null);
    }
  };

  const button = (kind: "photo" | "pdf", label: string) => (
    <Tap style={[styles.addRow, styles.flex]} onPress={() => void upload(kind)} disabled={!!busy} accessibilityRole="button" accessibilityState={{ busy: busy === kind }}>
      <SwapIcon id={busy === kind ? "busy" : kind}>
        {busy === kind ? <ActivityIndicator color={colors.primary} /> : <Icon name={kind} size={20} color={colors.primary} />}
      </SwapIcon>
      <Text style={styles.link}>{busy === kind ? s.recordsUploading : label}</Text>
    </Tap>
  );

  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.panel}>
      <Text style={styles.note}>{s.recordsIntro}</Text>
      <View style={styles.addRows}>
        {button("photo", Platform.OS === "web" ? s.recordsAddPhoto : s.recordsTakePhoto)}
        {button("pdf", s.recordsAddPdf)}
      </View>
      {error && <Text style={styles.error}>{error}</Text>}

      {!!trends?.length && (
        <>
          <Text style={styles.section} accessibilityRole="header">
            {s.recordsTrends}
          </Text>
          <View style={styles.trends}>
            {trends.map((t) => (
              <Enter key={t.key} style={styles.trendWrap}>
                <Trend t={t} s={s} />
              </Enter>
            ))}
          </View>
        </>
      )}

      {!!records?.length && (
        <Text style={styles.section} accessibilityRole="header">
          {s.recordsList}
        </Text>
      )}
      {records?.length === 0 && <Text style={styles.empty}>{s.recordsEmpty}</Text>}
      {records?.map((r) => {
        const c = tint.records;
        const expanded = open === r._id;
        return (
          <Enter key={r._id}>
            <View style={styles.card}>
              <View style={styles.head}>
                <Tap style={[styles.head, styles.flex]} onPress={() => r.status === "done" && setOpen(expanded ? null : r._id)} disabled={r.status !== "done"} accessibilityRole="button" accessibilityState={{ expanded, busy: r.status === "reading" }}>
                  <View style={[styles.kind, { backgroundColor: c.bg }]}>
                    <SwapIcon id={r.status === "reading" ? "reading" : (r.kind ?? "other")}>
                      {r.status === "reading" ? <ActivityIndicator color={c.fg} /> : <Icon name={KIND_ICON[r.kind ?? "other"]} size={22} color={c.fg} />}
                    </SwapIcon>
                  </View>
                  <View style={styles.flex}>
                    <Text style={styles.title} numberOfLines={2}>
                      {r.status === "reading" ? s.recordsReading : r.status === "failed" ? s.recordsFailedTitle : r.title}
                    </Text>
                    <Text style={styles.small} numberOfLines={r.status === "failed" ? 3 : 1}>
                      {r.status === "failed"
                        ? s[`recordsFailed_${(r.error ?? "failed") as "failed"}`] ?? s.recordsFailed_failed
                        : [r.date && longDate(r.date, s), r.source, r.kind && s[`recordKind_${r.kind}`]].filter(Boolean).join(" · ")}
                    </Text>
                    {r.status === "done" && r.results > 0 && (
                      <Text style={[styles.small, r.flagged > 0 && styles.warn]}>
                        {s.recordsResults.replace("{n}", String(r.results))}
                        {r.flagged > 0 ? ` · ${s.recordsFlagged.replace("{n}", String(r.flagged))}` : ""}
                      </Text>
                    )}
                  </View>
                  {r.status === "done" && (
                    <SwapIcon id={expanded ? "up" : "down"}>
                      <Ionicons name={expanded ? "chevron-up" : "chevron-down"} size={18} color={colors.muted} />
                    </SwapIcon>
                  )}
                </Tap>
                {r.status === "failed" && (
                  <Tap onPress={() => void remove({ id: r._id })} accessibilityRole="button" accessibilityLabel={s.remove}>
                    <Ionicons name="close" size={20} color={colors.muted} />
                  </Tap>
                )}
              </View>
              <Reveal open={expanded}>{expanded ? <Detail id={r._id} s={s} /> : null}</Reveal>
            </View>
          </Enter>
        );
      })}
      <Text style={styles.disclaimer}>{s.recordsDisclaimer}</Text>
    </ScrollView>
  );
}

const styles = themed(() => ({
  scroll: { flex: 1, backgroundColor: colors.bg },
  panel: { padding: 16, gap: 10, maxWidth: 760, width: "100%", alignSelf: "center" },
  note: { color: colors.muted, fontSize: 14, lineHeight: 19 },
  empty: { ...ui.empty },
  section: { ...ui.section },
  small: { color: colors.muted, fontSize: 13 },
  line: { color: colors.text, fontSize: 14, lineHeight: 20 },
  label: { color: colors.text, fontSize: 14, fontWeight: "700", marginTop: 4 },
  warn: { color: colors.warningText, fontWeight: "600" },
  flex: { flex: 1, minWidth: 0 },
  addRows: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
  addRow: { ...ui.addButton, minWidth: 200 },
  link: { color: colors.primary, fontWeight: "600", fontSize: 14 },
  danger: { color: colors.danger },
  error: { color: colors.danger, fontSize: 13 },
  card: { ...ui.card, padding: 12, gap: 8 },
  head: { flexDirection: "row", alignItems: "center", gap: 12 },
  kind: { width: 44, height: 44, borderRadius: radius.md, alignItems: "center", justifyContent: "center" },
  title: { color: colors.text, fontSize: 15, fontWeight: "600" },
  detail: { gap: 8, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 10 },
  summary: { color: colors.text, fontSize: 15, lineHeight: 22 },
  result: { gap: 4, paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: colors.border },
  rowTop: { flexDirection: "row", alignItems: "center", gap: 8 },
  value: { color: colors.text, fontSize: 14, fontWeight: "600" },
  valueOut: { color: colors.warningText },
  explain: { gap: 4, paddingTop: 2 },
  flag: { borderRadius: radius.pill, paddingHorizontal: 8, paddingVertical: 2 },
  flagOk: { backgroundColor: colors.successSoft },
  flagOut: { backgroundColor: colors.warningSoft },
  flagText: { fontSize: 12, fontWeight: "700" },
  flagTextOk: { color: colors.text },
  flagTextOut: { color: colors.warningText },
  actions: { flexDirection: "row", gap: 16, flexWrap: "wrap", paddingTop: 4 },
  action: { flexDirection: "row", alignItems: "center", gap: 6, minHeight: 40 },
  trends: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  trendWrap: { flexGrow: 1, flexBasis: 220 },
  trend: { ...ui.card, padding: 12, gap: 6 },
  trendTitle: { color: colors.text, fontSize: 14, fontWeight: "700" },
  trendValue: { color: colors.text, fontSize: 18, fontWeight: "700" },
  bars: { height: 64, flexDirection: "row", alignItems: "flex-end", gap: 6, position: "relative" },
  band: { position: "absolute", left: 0, right: 0, backgroundColor: colors.primarySoft, borderRadius: 4 },
  barCol: { flex: 1, height: "100%", justifyContent: "flex-end", alignItems: "center" },
  bar: { width: "60%", maxWidth: 28, borderRadius: 4, minHeight: 3 },
  barLabels: { flexDirection: "row", gap: 6 },
  barLabel: { flex: 1, color: colors.muted, fontSize: 11, textAlign: "center" },
  disclaimer: { color: colors.muted, fontSize: 12, lineHeight: 17, marginTop: 8 },
}));

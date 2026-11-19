// "Share with my doctor": one flow for everything a doctor or carer might get. Pick the time span and the sections
// once (./ShareParts.tsx), then how to send it: a one-page visit summary written from recent chats, the journal,
// analyses, medications, and health data (convex/visit.ts), a PDF report (convex/reports.ts), or a private link
// (convex/share.ts). The links made so far are listed underneath. A summary goes out as a PDF from the share sheet on
// phones (the print dialog on the web) and can be copied as text everywhere.
import { useState } from "react";
import { ActivityIndicator, Platform, ScrollView, Share, Text, TextInput, View } from "react-native";
import { Tap } from "./Tap";
import { useMutation, useQuery } from "convex/react";
import { Ionicons } from "@expo/vector-icons";
import * as Clipboard from "expo-clipboard";
import * as Print from "expo-print";
import * as Sharing from "expo-sharing";
import { api } from "../convex/_generated/api";
import { colors, themed, TOUCH, ui, radius } from "./theme";
import { confirmAsk, errorText, showToast } from "./feedback";
import type { Id } from "../convex/_generated/dataModel";
import { Markdown } from "./Markdown";
import { printablePage } from "./printable";
import type { Strings } from "./i18n";
import { daysAgo, daysSince, LinkAction, LinkList, PdfAction, RangePicker, ReportSection, SectionChips } from "./ShareParts";
import { localDate } from "./DailyCard";
import { formatDateTime } from "./format";
import { Enter } from "./Motion";

type Way = "summary" | "pdf" | "link";
const WAYS: { way: Way; icon: keyof typeof Ionicons.glyphMap }[] = [
  { way: "summary", icon: "sparkles-outline" },
  { way: "pdf", icon: "document-text-outline" },
  { way: "link", icon: "link-outline" },
];
// The summary reads at most this many days back (convex/visit.ts).
const SUMMARY_MAX_DAYS = 90;

// `forVisit`: opened from an appointment's "Make a visit summary", so the summary is made for it.
export function SharePanel({ s, forVisit }: { s: Strings; forVisit?: { id?: string; title: string } }) {
  const [from, setFrom] = useState(daysAgo(29));
  const [to, setTo] = useState(localDate());
  const [sections, setSections] = useState<ReportSection[]>(["facts", "medications", "journal", "trackers", "exercises", "health", "appointments"]);
  const [way, setWay] = useState<Way>("summary");
  const title = { summary: s.shareWaySummary, pdf: s.shareWayPdf, link: s.shareWayLink };
  const desc = { summary: s.shareWaySummaryDesc, pdf: s.shareWayPdfDesc, link: s.shareWayLinkDesc };

  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.panel}>
      <Text style={styles.heading} accessibilityRole="header">
        {s.shareFlowTitle}
      </Text>
      <Text style={styles.note}>{s.shareFlowIntro}</Text>

      <Text style={styles.step}>{s.shareStepSpan}</Text>
      <RangePicker from={from} to={to} onChange={(f, t) => (setFrom(f), setTo(t))} s={s} />

      <Text style={styles.step}>{s.shareStepWhat}</Text>
      <SectionChips value={sections} onChange={setSections} s={s} />

      <Text style={styles.step}>{s.shareStepHow}</Text>
      <View style={styles.ways} accessibilityRole="radiogroup" accessibilityLabel={s.shareStepHow}>
        {WAYS.map((w) => {
          const on = way === w.way;
          return (
            <Tap key={w.way} style={[styles.way, on && styles.wayOn]} onPress={() => setWay(w.way)} accessibilityRole="radio" accessibilityState={{ selected: on }} accessibilityLabel={`${title[w.way]}. ${desc[w.way]}`}>
              <Ionicons name={w.icon} size={22} color={on ? colors.primary : colors.muted} />
              <Text style={[styles.wayTitle, on && styles.wayTitleOn]}>{title[w.way]}</Text>
              <Text style={styles.small}>{desc[w.way]}</Text>
            </Tap>
          );
        })}
      </View>

      <Enter key={way} from={6} style={styles.card}>
        {way === "summary" && <SummaryAction s={s} days={Math.min(SUMMARY_MAX_DAYS, daysSince(from))} forVisit={forVisit} />}
        {way === "pdf" && <PdfAction s={s} from={from} to={to} sections={sections} />}
        {way === "link" && <LinkAction s={s} from={from} sections={sections} />}
      </Enter>

      <LinkList s={s} />
    </ScrollView>
  );
}

// The visit summary: write one for the span (and an optional reason), then read, share or print, copy, or delete it.
// Earlier ones stay in a list underneath, each with the appointment it was made for.
function SummaryAction({ s, days, forVisit }: { s: Strings; days: number; forVisit?: { id?: string; title: string } }) {
  const history = useQuery(api.visit.history);
  const create = useMutation(api.visit.create);
  const remove = useMutation(api.visit.remove);
  const [reason, setReason] = useState(forVisit?.title ?? "");
  const [error, setError] = useState<string | null>(null);
  const [composing, setComposing] = useState(!!forVisit);
  // Which summary is open: the newest unless an earlier one was picked.
  const [picked, setPicked] = useState<string | null>(null);
  const latest = history?.find((h) => h._id === picked) ?? history?.[0];
  const earlier = (history ?? []).filter((h) => h._id !== latest?._id && h.status === "ready");

  const generating = history?.[0]?.status === "generating";
  const showForm = composing || !latest || latest.status === "failed";

  const generate = async () => {
    setError(null);
    try {
      await create({ reason: reason.trim() || undefined, days, ...(forVisit?.id && { visitId: forVisit.id as Id<"visits"> }) });
      setPicked(null);
      setComposing(false);
    } catch (e) {
      setError(errorText(e));
    }
  };

  // Phones: the summary as a PDF in the share sheet (the same page the web prints). Web: the print dialog.
  const share = async (text: string) => {
    if (Platform.OS !== "web") {
      const { uri } = await Print.printToFileAsync({ html: printablePage(s.visitSummaryTitle, text) });
      if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(uri, { mimeType: "application/pdf", UTI: "com.adobe.pdf", dialogTitle: s.visitSummaryTitle });
      else await Share.share({ message: text, title: s.visitSummaryTitle });
      return;
    }
    const win = window.open("", "_blank");
    if (!win) return setError(s.allowPopups);
    win.document.write(printablePage(s.visitSummaryTitle, text));
    win.document.close();
    win.focus();
    win.print();
  };

  const copy = async (text: string) => {
    await Clipboard.setStringAsync(text);
    showToast(s.copied);
  };

  return (
    <View style={styles.form}>
      <Text style={styles.note}>{s.visitSummaryIntro}</Text>
      {showForm && !generating && (
        <>
          <TextInput style={styles.input} placeholder={s.visitReasonOptional} placeholderTextColor={colors.muted} accessibilityLabel={s.visitReasonOptional} value={reason} onChangeText={setReason} maxLength={300} />
          <Text style={styles.small}>{s.shareSummaryDays.replace("{n}", String(days))}</Text>
          <Tap style={styles.button} onPress={() => void generate()} accessibilityRole="button">
            <Ionicons name="sparkles-outline" size={18} color={colors.onPrimary} />
            <Text style={styles.buttonText}>{s.writeSummary}</Text>
          </Tap>
          {latest?.status === "failed" && !composing && <Text style={styles.error}>{s.summaryFailed}</Text>}
        </>
      )}

      {generating && (
        <View style={styles.generating}>
          <ActivityIndicator color={colors.primary} />
          <Text style={styles.note}>{s.writingSummary}</Text>
        </View>
      )}

      {latest?.status === "ready" && latest.text && !composing && (
        <View style={styles.form}>
          <Text style={styles.small}>{s.madeAt.replace("{when}", formatDateTime(latest._creationTime, s)).replace("{n}", String(latest.days))}</Text>
          {latest.visit && <Text style={styles.small}>{s.summaryFor.replace("{title}", latest.visit.title).replace("{when}", formatDateTime(latest.visit.startsAt, s))}</Text>}
          <View style={styles.doc}>
            <Markdown text={latest.text} style={styles.docText} />
          </View>
          <View style={styles.actions}>
            <Tap style={styles.action} onPress={() => void share(latest.text!).catch((e) => setError(errorText(e)))} accessibilityRole="button">
              <Ionicons name={Platform.OS === "web" ? "print-outline" : "share-outline"} size={18} color={colors.primary} />
              <Text style={styles.link}>{Platform.OS === "web" ? s.printPdf : s.sharePdf}</Text>
            </Tap>
            <Tap style={styles.action} onPress={() => void copy(latest.text!).catch((e) => setError(errorText(e)))} accessibilityRole="button">
              <Ionicons name="copy-outline" size={18} color={colors.primary} />
              <Text style={styles.link}>{s.copy}</Text>
            </Tap>
            <Tap style={styles.action} onPress={() => setComposing(true)} accessibilityRole="button">
              <Ionicons name="refresh" size={18} color={colors.primary} />
              <Text style={styles.link}>{s.newSummary}</Text>
            </Tap>
            <Tap
              style={styles.action}
              onPress={async () => {
                if (!(await confirmAsk({ title: s.summaryDeleteConfirm, ok: s.delete, cancel: s.cancel }))) return;
                setPicked(null);
                await remove({ id: latest._id }).catch((e) => setError(errorText(e)));
              }}
              accessibilityRole="button"
            >
              <Ionicons name="trash-outline" size={18} color={colors.danger} />
              <Text style={[styles.link, styles.danger]}>{s.delete}</Text>
            </Tap>
          </View>
        </View>
      )}
      {!!earlier.length && !composing && (
        <View style={styles.earlier}>
          <Text style={styles.label}>{s.summaryEarlier}</Text>
          {earlier.map((h) => (
            <Tap key={h._id} style={styles.earlierRow} onPress={() => setPicked(h._id)} accessibilityRole="button">
              <Ionicons name="document-outline" size={16} color={colors.primary} />
              <Text style={[styles.earlierText, styles.flex]} numberOfLines={1}>
                {formatDateTime(h._creationTime, s)}
                {h.visit ? ` · ${h.visit.title}` : h.reason ? ` · ${h.reason}` : ""}
              </Text>
              <Ionicons name="chevron-forward" size={16} color={colors.muted} />
            </Tap>
          ))}
        </View>
      )}
      {error && <Text style={styles.error}>{error}</Text>}
    </View>
  );
}

const styles = themed(() => ({
  scroll: { flex: 1, backgroundColor: colors.bg },
  panel: { padding: 16, gap: 10, maxWidth: 760, width: "100%", alignSelf: "center", paddingBottom: 32 },
  heading: { fontSize: 20, fontWeight: "700", color: colors.text },
  note: { color: colors.muted, fontSize: 14, lineHeight: 19, flexShrink: 1 },
  step: { fontSize: 15, fontWeight: "700", color: colors.text, marginTop: 6 },
  small: { color: colors.muted, fontSize: 12, lineHeight: 16 },
  ways: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  way: { ...ui.card, flexGrow: 1, flexBasis: 160, padding: 12, gap: 4, borderWidth: 2, borderColor: colors.hairline },
  wayOn: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
  wayTitle: { fontSize: 15, fontWeight: "700", color: colors.text },
  wayTitleOn: { color: colors.primary },
  card: { ...ui.card, padding: 12, gap: 8 },
  form: { gap: 8 },
  input: { color: colors.text, borderWidth: 1, borderColor: colors.inputBorder, backgroundColor: colors.surface, borderRadius: 12, paddingHorizontal: 10, paddingVertical: 9, fontSize: 15 },
  button: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: colors.primary, borderRadius: radius.pill, paddingVertical: 10, paddingHorizontal: 16, minHeight: TOUCH, alignSelf: "flex-start" },
  buttonText: { color: colors.onPrimary, fontWeight: "600", fontSize: 14 },
  generating: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 8 },
  doc: { borderWidth: 1, borderColor: colors.border, borderRadius: 15, padding: 14, backgroundColor: colors.bg },
  docText: { color: colors.text, fontSize: 15, lineHeight: 21 },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: 18 },
  action: { flexDirection: "row", alignItems: "center", gap: 4, minHeight: TOUCH },
  link: { color: colors.primary, fontWeight: "600", fontSize: 14 },
  danger: { color: colors.danger },
  error: { color: colors.danger, fontSize: 13 },
  label: { color: colors.text, fontSize: 13, fontWeight: "600" },
  earlier: { gap: 2, borderTopWidth: 1, borderTopColor: colors.hairline, paddingTop: 8 },
  earlierRow: { flexDirection: "row", alignItems: "center", gap: 8, minHeight: TOUCH },
  earlierText: { color: colors.text, fontSize: 14 },
  flex: { flex: 1, minWidth: 0 },
}));

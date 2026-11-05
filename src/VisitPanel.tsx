// "Prepare for a visit": writes a one-page summary of recent chats, the journal, analyses, medications and health data
// (convex/visit.ts), then lets the user read, share, copy or print it.
import { useState } from "react";
import { ActivityIndicator, Platform, ScrollView, Share, Text, TextInput, View } from "react-native";
import { Tap } from "./Tap";
import { useMutation, useQuery } from "convex/react";
import { Ionicons } from "@expo/vector-icons";
import { api } from "../convex/_generated/api";
import { colors, pillish, round, themed, TOUCH, ui } from "./theme";
import { Markdown } from "./Markdown";
import { printablePage } from "./printable";
import type { Strings } from "./i18n";
import { ReportCard } from "./ReportCard";
import { ShareCard } from "./ShareCard";

const PERIODS = [
  { days: 14, label: (s: Strings) => s.twoWeeks },
  { days: 30, label: (s: Strings) => s.lastNDays.replace("{n}", "30") },
  { days: 90, label: (s: Strings) => s.lastNDays.replace("{n}", "90") },
];

export function VisitPanel({ s, initialReason }: { s: Strings; initialReason?: string }) {
  const latest = useQuery(api.visit.latest);
  const create = useMutation(api.visit.create);
  const remove = useMutation(api.visit.remove);
  const [reason, setReason] = useState(initialReason ?? "");
  const [days, setDays] = useState(30);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [composing, setComposing] = useState(!!initialReason);

  const generating = latest?.status === "generating";
  const showForm = composing || !latest || latest.status === "failed";

  const generate = async () => {
    setError(null);
    try {
      await create({ reason: reason.trim() || undefined, days });
      setComposing(false);
    } catch (e) {
      setError((e as Error).message.replace(/^.*Uncaught Error: /, "").split("\n")[0]);
    }
  };

  const share = async (text: string) => {
    if (Platform.OS !== "web") {
      await Share.share({ message: text, title: s.visitSummaryTitle });
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
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.panel}>
      <View style={styles.titleRow}>
        <Ionicons name="clipboard-outline" size={20} color={colors.primary} />
        <Text style={styles.title}>{s.visitSummaryTitle}</Text>
      </View>
      <Text style={styles.note}>{s.visitSummaryIntro}</Text>

      {showForm && !generating && (
        <View style={styles.form}>
          <TextInput
            style={styles.input}
            placeholder={s.visitReasonOptional}
            placeholderTextColor={colors.muted}
            value={reason}
            onChangeText={setReason}
            maxLength={300}
          />
          <View style={styles.chips}>
            {PERIODS.map((p) => (
              <Tap
                key={p.days}
                style={[styles.chip, days === p.days && styles.chipOn]}
                onPress={() => setDays(p.days)}
                accessibilityRole="radio"
                accessibilityState={{ selected: days === p.days }}
              >
                <Text style={[styles.chipText, days === p.days && styles.chipTextOn]}>{p.label(s)}</Text>
              </Tap>
            ))}
          </View>
          <Tap style={styles.button} onPress={() => void generate()} accessibilityRole="button">
            <Text style={styles.buttonText}>{s.writeSummary}</Text>
          </Tap>
          {latest?.status === "failed" && !composing && (
            <Text style={styles.error}>{s.summaryFailed}</Text>
          )}
        </View>
      )}

      {generating && (
        <View style={styles.generating}>
          <ActivityIndicator color={colors.primary} />
          <Text style={styles.note}>{s.writingSummary}</Text>
        </View>
      )}

      {latest?.status === "ready" && latest.text && !composing && (
        <View style={styles.result}>
          <Text style={styles.small}>
            {s.madeAt.replace("{when}", new Date(latest._creationTime).toLocaleString()).replace("{n}", String(latest.days))}
          </Text>
          <View style={styles.doc}>
            <Markdown text={latest.text} style={styles.docText} />
          </View>
          <View style={styles.actions}>
            <Tap style={styles.action} onPress={() => void share(latest.text!)} accessibilityRole="button">
              <Ionicons name={Platform.OS === "web" ? "print-outline" : "share-outline"} size={18} color={colors.primary} />
              <Text style={styles.link}>{Platform.OS === "web" ? s.printPdf : s.share}</Text>
            </Tap>
            {Platform.OS === "web" && (
              <Tap style={styles.action} onPress={() => void copy(latest.text!)} accessibilityRole="button">
                <Ionicons name="copy-outline" size={18} color={colors.primary} />
                <Text style={styles.link}>{copied ? s.copied : s.copy}</Text>
              </Tap>
            )}
            <Tap style={styles.action} onPress={() => setComposing(true)} accessibilityRole="button">
              <Ionicons name="refresh" size={18} color={colors.primary} />
              <Text style={styles.link}>{s.newSummary}</Text>
            </Tap>
            <Tap style={styles.action} onPress={() => void remove({ id: latest._id })} accessibilityRole="button">
              <Ionicons name="trash-outline" size={18} color={colors.danger} />
              <Text style={[styles.link, { color: colors.danger }]}>{s.delete}</Text>
            </Tap>
          </View>
        </View>
      )}
      {error && <Text style={styles.error}>{error}</Text>}
      <ReportCard s={s} />
      <ShareCard s={s} />
    </ScrollView>
  );
}

const styles = themed(() => ({
  scroll: { flex: 1, backgroundColor: colors.bg },
  panel: { padding: 16, gap: 10, maxWidth: 760, width: "100%", alignSelf: "center" },
  titleRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  title: { fontSize: 17, fontWeight: "700", color: colors.text },
  note: { color: colors.muted, fontSize: 14, lineHeight: 19, flexShrink: 1 },
  small: { color: colors.muted, fontSize: 12 },
  form: { gap: 10 },
  input: { color: colors.text, borderWidth: 1, borderColor: colors.inputBorder, backgroundColor: colors.surface, borderRadius: round(8), paddingHorizontal: 10, paddingVertical: 9, fontSize: 15 },
  chips: { flexDirection: "row", gap: 8 },
  chip: { ...ui.chip },
  chipOn: { backgroundColor: colors.primarySoft, borderColor: colors.primary },
  chipText: { color: colors.text, fontSize: 14 },
  chipTextOn: { color: colors.primary, fontWeight: "600" },
  button: { backgroundColor: colors.primary, borderRadius: pillish(10), padding: 11, alignItems: "center", minHeight: TOUCH, justifyContent: "center" },
  buttonText: { color: colors.onPrimary, fontWeight: "600", fontSize: 14 },
  generating: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 8 },
  result: { gap: 8 },
  doc: { borderWidth: 1, borderColor: colors.border, borderRadius: round(10), padding: 14, backgroundColor: colors.bg },
  docText: { color: colors.text, fontSize: 15, lineHeight: 21 },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: 18 },
  action: { flexDirection: "row", alignItems: "center", gap: 4 },
  link: { color: colors.primary, fontWeight: "600", fontSize: 14 },
  error: { color: colors.danger, fontSize: 13 },
}));

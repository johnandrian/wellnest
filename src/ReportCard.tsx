// PDF reports (convex/reports.ts): pick a date range and sections, then save a PDF and share it (iOS/Android, via
// expo-print and the share sheet) or print / save as PDF (web).
import { useState } from "react";
import { ActivityIndicator, Platform, StyleSheet, Text, TextInput, View } from "react-native";
import { Tap } from "./Tap";
import { useConvex } from "convex/react";
import { Ionicons } from "@expo/vector-icons";
import * as Print from "expo-print";
import * as Sharing from "expo-sharing";
import { api } from "../convex/_generated/api";
import { colors, ui, TOUCH } from "./theme";
import type { Strings } from "./i18n";
import { localDate } from "./DailyCard";
import { SwapIcon } from "./Motion";

export const REPORT_SECTIONS = ["facts", "medications", "journal", "trackers", "exercises", "health", "appointments", "emergency"] as const;
export type ReportSection = (typeof REPORT_SECTIONS)[number];
const PRESETS = [30, 90, 365];

export const daysAgo = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return localDate(d);
};

export function SectionChips({ value, onChange, s }: { value: ReportSection[]; onChange: (v: ReportSection[]) => void; s: Strings }) {
  return (
    <View style={styles.chips}>
      {REPORT_SECTIONS.map((x) => {
        const on = value.includes(x);
        return (
          <Tap key={x} style={[styles.chip, on && styles.chipOn]} onPress={() => onChange(on ? value.filter((y) => y !== x) : [...value, x])} accessibilityRole="checkbox" accessibilityState={{ checked: on }}>
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
        <TextInput style={[styles.input, styles.date]} value={from} onChangeText={(v) => onChange(v, to)} accessibilityLabel={s.reportFrom} placeholder="YYYY-MM-DD" placeholderTextColor={colors.muted} />
        <Text style={styles.label}>–</Text>
        <TextInput style={[styles.input, styles.date]} value={to} onChangeText={(v) => onChange(from, v)} accessibilityLabel={s.reportTo} placeholder="YYYY-MM-DD" placeholderTextColor={colors.muted} />
      </View>
    </View>
  );
}

export function ReportCard({ s }: { s: Strings }) {
  const convex = useConvex();
  const [from, setFrom] = useState(daysAgo(89));
  const [to, setTo] = useState(localDate());
  const [sections, setSections] = useState<ReportSection[]>(["facts", "medications", "journal", "trackers", "exercises", "health", "appointments"]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const make = async () => {
    setError(null);
    setBusy(true);
    try {
      const html = await convex.query(api.reports.html, { from, to, sections, generated: new Date().toLocaleString() });
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
      setError((e as Error).message.replace(/^.*Uncaught Error: /, "").split("\n")[0]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.card}>
      <View style={styles.inline}>
        <Ionicons name="document-text-outline" size={20} color={colors.primary} />
        <Text style={styles.title}>{s.reportTitle}</Text>
      </View>
      <Text style={styles.note}>{s.reportIntro}</Text>
      <RangePicker from={from} to={to} onChange={(f, t) => (setFrom(f), setTo(t))} s={s} />
      <SectionChips value={sections} onChange={setSections} s={s} />
      <Tap style={[styles.button, busy && styles.busy]} onPress={() => void make()} disabled={busy || !sections.length} accessibilityRole="button">
        {busy ? <ActivityIndicator color={colors.onPrimary} /> : <Ionicons name={Platform.OS === "web" ? "print-outline" : "share-outline"} size={18} color={colors.onPrimary} />}
        <Text style={styles.buttonText}>{Platform.OS === "web" ? s.reportPrint : s.reportShare}</Text>
      </Tap>
      {error && <Text style={styles.error}>{error}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { ...ui.card, padding: 12, gap: 8, marginTop: 6 },
  title: { fontSize: 16, fontWeight: "700", color: colors.text },
  note: { color: colors.muted, fontSize: 14, lineHeight: 19 },
  form: { gap: 8 },
  inline: { flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" },
  label: { color: colors.text },
  input: { borderWidth: 1, borderColor: colors.inputBorder, backgroundColor: colors.surface, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 7, fontSize: 15, minWidth: 0 },
  date: { width: 120 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  chip: { ...ui.chip, flexDirection: "row", alignItems: "center", gap: 4 },
  chipOn: { backgroundColor: colors.primarySoft, borderColor: colors.primary },
  chipText: { color: colors.text, fontSize: 13 },
  chipTextOn: { color: colors.primary, fontWeight: "600" },
  button: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: colors.primary, borderRadius: 10, padding: 11, minHeight: TOUCH },
  busy: { opacity: 0.7 },
  buttonText: { color: colors.onPrimary, fontWeight: "600" },
  error: { color: colors.danger, fontSize: 13 },
});

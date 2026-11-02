// "Prepare for a visit": writes a one-page summary of recent chats, analyses, medications and Apple Health data
// (convex/visit.ts), then lets the user read, share, copy or print it.
import { useState } from "react";
import { ActivityIndicator, Platform, Pressable, ScrollView, Share, StyleSheet, Text, TextInput, View } from "react-native";
import { useMutation, useQuery } from "convex/react";
import { Ionicons } from "@expo/vector-icons";
import { api } from "../convex/_generated/api";
import { colors } from "./theme";
import { Markdown } from "./Markdown";
import { printablePage } from "./printable";

const PERIODS = [
  { days: 14, label: "2 weeks" },
  { days: 30, label: "30 days" },
  { days: 90, label: "90 days" },
];

export function VisitPanel() {
  const latest = useQuery(api.visit.latest);
  const create = useMutation(api.visit.create);
  const remove = useMutation(api.visit.remove);
  const [reason, setReason] = useState("");
  const [days, setDays] = useState(30);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [composing, setComposing] = useState(false);

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
      await Share.share({ message: text, title: "Visit summary" });
      return;
    }
    const win = window.open("", "_blank");
    if (!win) return setError("Allow pop-ups to print the summary.");
    win.document.write(printablePage("Visit summary", text));
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
        <Text style={styles.title}>Visit summary</Text>
      </View>
      <Text style={styles.note}>
        A one-page summary of what you've told Wellnest, your symptom analyses and Apple Health trends, to bring to your
        appointment. You can also just ask in chat: "prepare me for my doctor's appointment".
      </Text>

      {showForm && !generating && (
        <View style={styles.form}>
          <TextInput
            style={styles.input}
            placeholder="What's the visit about? (optional)"
            placeholderTextColor={colors.muted}
            value={reason}
            onChangeText={setReason}
            maxLength={300}
          />
          <View style={styles.chips}>
            {PERIODS.map((p) => (
              <Pressable
                key={p.days}
                style={[styles.chip, days === p.days && styles.chipOn]}
                onPress={() => setDays(p.days)}
                accessibilityRole="radio"
                accessibilityState={{ selected: days === p.days }}
              >
                <Text style={[styles.chipText, days === p.days && styles.chipTextOn]}>{p.label}</Text>
              </Pressable>
            ))}
          </View>
          <Pressable style={styles.button} onPress={() => void generate()} accessibilityRole="button">
            <Text style={styles.buttonText}>Write my summary</Text>
          </Pressable>
          {latest?.status === "failed" && !composing && (
            <Text style={styles.error}>The last summary couldn't be written. Try again.</Text>
          )}
        </View>
      )}

      {generating && (
        <View style={styles.generating}>
          <ActivityIndicator color={colors.primary} />
          <Text style={styles.note}>Writing your summary… this takes under a minute.</Text>
        </View>
      )}

      {latest?.status === "ready" && latest.text && !composing && (
        <View style={styles.result}>
          <Text style={styles.small}>
            Made {new Date(latest._creationTime).toLocaleString()} · last {latest.days} days
          </Text>
          <View style={styles.doc}>
            <Markdown text={latest.text} style={styles.docText} />
          </View>
          <View style={styles.actions}>
            <Pressable style={styles.action} onPress={() => void share(latest.text!)} accessibilityRole="button">
              <Ionicons name={Platform.OS === "web" ? "print-outline" : "share-outline"} size={18} color={colors.primary} />
              <Text style={styles.link}>{Platform.OS === "web" ? "Print / save PDF" : "Share"}</Text>
            </Pressable>
            {Platform.OS === "web" && (
              <Pressable style={styles.action} onPress={() => void copy(latest.text!)} accessibilityRole="button">
                <Ionicons name="copy-outline" size={18} color={colors.primary} />
                <Text style={styles.link}>{copied ? "Copied" : "Copy"}</Text>
              </Pressable>
            )}
            <Pressable style={styles.action} onPress={() => setComposing(true)} accessibilityRole="button">
              <Ionicons name="refresh" size={18} color={colors.primary} />
              <Text style={styles.link}>New</Text>
            </Pressable>
            <Pressable style={styles.action} onPress={() => void remove({ id: latest._id })} accessibilityRole="button">
              <Ionicons name="trash-outline" size={18} color={colors.danger} />
              <Text style={[styles.link, { color: colors.danger }]}>Delete</Text>
            </Pressable>
          </View>
        </View>
      )}
      {error && <Text style={styles.error}>{error}</Text>}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { maxHeight: "75%", flexGrow: 0, backgroundColor: "#fff", borderBottomWidth: 1, borderBottomColor: colors.border },
  panel: { padding: 16, gap: 10, maxWidth: 760, width: "100%", alignSelf: "center" },
  titleRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  title: { fontSize: 17, fontWeight: "700", color: colors.text },
  note: { color: colors.muted, fontSize: 14, lineHeight: 19, flexShrink: 1 },
  small: { color: colors.muted, fontSize: 12 },
  form: { gap: 10 },
  input: { borderWidth: 1, borderColor: colors.border, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 9, fontSize: 15 },
  chips: { flexDirection: "row", gap: 8 },
  chip: { borderWidth: 1, borderColor: colors.border, borderRadius: 16, paddingHorizontal: 12, paddingVertical: 6 },
  chipOn: { backgroundColor: colors.primarySoft, borderColor: colors.primary },
  chipText: { color: colors.text, fontSize: 14 },
  chipTextOn: { color: colors.primary, fontWeight: "600" },
  button: { backgroundColor: colors.primary, borderRadius: 10, padding: 11, alignItems: "center" },
  buttonText: { color: "#fff", fontWeight: "600" },
  generating: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 8 },
  result: { gap: 8 },
  doc: { borderWidth: 1, borderColor: colors.border, borderRadius: 10, padding: 14, backgroundColor: colors.bg },
  docText: { color: colors.text, fontSize: 15, lineHeight: 21 },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: 18 },
  action: { flexDirection: "row", alignItems: "center", gap: 4 },
  link: { color: colors.primary, fontWeight: "600" },
  error: { color: colors.danger, fontSize: 13 },
});

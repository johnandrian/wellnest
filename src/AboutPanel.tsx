// "What Wellnest knows about me" (convex/me.ts): saved facts (editable), everything stored, who sees what,
// export, and deletion by category or of the whole account.
import { useState } from "react";
import { ActivityIndicator, Alert, Platform, Pressable, ScrollView, Share, StyleSheet, Text, TextInput, View } from "react-native";
import { useAction, useMutation, useQuery } from "convex/react";
import { useAuthActions } from "@convex-dev/auth/react";
import { Ionicons } from "@expo/vector-icons";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { colors } from "./theme";

type Category = "chat" | "health" | "reminders" | "summaries" | "facts" | "journal" | "everything";

function confirm(title: string, message: string, action: string): Promise<boolean> {
  if (Platform.OS === "web") return Promise.resolve(window.confirm(`${title}\n\n${message}`));
  return new Promise((resolve) =>
    Alert.alert(title, message, [
      { text: "Cancel", style: "cancel", onPress: () => resolve(false) },
      { text: action, style: "destructive", onPress: () => resolve(true) },
    ]),
  );
}

const SHARING: [string, string][] = [
  ["Snowflake Cortex", "the AI model: reads your messages, photos, saved facts, reminders and (when it asks) Apple Health summaries to answer."],
  ["Jina AI", "turns messages into search vectors for memory, and runs web and PubMed searches."],
  ["Cartesia", "voice: your recordings are transcribed and replies are spoken."],
  ["TypeSafe Jev", "reads each message to route it (urgent, shopping, analysis)."],
  ["CREAO", "only when you OK a detailed symptom analysis: the symptoms, plus Apple Health if you turned that on."],
  ["Telegram", "only if you linked it: messages you send or get there."],
];

const count = (c: { n: number; more: boolean }) => `${c.n.toLocaleString()}${c.more ? "+" : ""}`;

export function AboutPanel() {
  const data = useQuery(api.me.overview);
  const addFact = useMutation(api.me.addFact);
  const updateFact = useMutation(api.me.updateFact);
  const deleteFact = useMutation(api.me.deleteFact);
  const deleteData = useMutation(api.me.deleteData);
  const exportData = useAction(api.me.exportData);
  const { signOut } = useAuthActions();
  const [newFact, setNewFact] = useState("");
  const [editing, setEditing] = useState<{ id: Id<"memoryFacts">; text: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (data === undefined) return <ActivityIndicator style={styles.loading} />;
  if (data === null) return null;
  const { profile, counts, facts } = data;

  const run = async (label: string, fn: () => Promise<unknown>) => {
    setError(null);
    setBusy(label);
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message.replace(/^.*Uncaught Error: /, "").split("\n")[0]);
    } finally {
      setBusy(null);
    }
  };

  const save = () => run("fact", async () => {
    if (!newFact.trim()) return;
    await addFact({ text: newFact });
    setNewFact("");
  });

  const download = () => run("export", async () => {
    const json = await exportData();
    if (Platform.OS === "web") {
      const url = URL.createObjectURL(new Blob([json], { type: "application/json" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = `wellnest-export-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } else {
      await Share.share({ message: json, title: "Wellnest export" });
    }
  });

  const remove = async (category: Category, what: string) => {
    if (category === "everything") {
      const ok =
        (await confirm("Delete your account?", "This deletes everything Wellnest has about you and signs you out. It can't be undone.", "Continue")) &&
        (await confirm("Are you sure?", "Your chats, photos, facts, reminders, summaries, analyses and Apple Health data will all be deleted.", "Delete everything"));
      if (!ok) return;
      await run(category, async () => {
        await deleteData({ category });
        await signOut();
      });
      return;
    }
    if (await confirm(`Delete ${what}?`, "This can't be undone.", "Delete")) await run(category, () => deleteData({ category }));
  };

  const rows: { label: string; value: string; category?: Category; what?: string }[] = [
    {
      label: "Messages",
      value: `${count(counts.messages)}${data.since ? ` since ${new Date(data.since).toLocaleDateString()}` : ""}${data.chatClearedAt ? " (some hidden by Clear chat, still stored)" : ""}`,
      category: "chat",
      what: "all messages, photos and symptom analyses",
    },
    { label: "Photos", value: count(counts.photos) },
    { label: "Symptom journal", value: count(counts.journal), category: counts.journal.n ? "journal" : undefined, what: "your symptom journal" },
    { label: "Symptom analyses", value: count(counts.analyses) },
    {
      label: "Apple Health",
      value: profile.healthConnected ? `${count(counts.healthDays)} days${profile.healthInAnalyses ? " · shared with analyses" : ""}` : "not connected",
      category: counts.healthDays.n ? "health" : undefined,
      what: "your Apple Health summaries (and disconnect)",
    },
    {
      label: "Reminders",
      value: `${count(counts.reminders)} (${count(counts.doses)} Taken / Skip answers)`,
      category: counts.reminders.n ? "reminders" : undefined,
      what: "all reminders and their history",
    },
    { label: "Visit summaries", value: count(counts.summaries), category: counts.summaries.n ? "summaries" : undefined, what: "all visit summaries" },
  ];

  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.panel}>
      <View style={styles.titleRow}>
        <Ionicons name="finger-print-outline" size={20} color={colors.primary} />
        <Text style={styles.title}>What Wellnest knows about me</Text>
      </View>

      <Text style={styles.section}>Saved facts</Text>
      <Text style={styles.note}>
        Wellnest keeps these in mind in every chat and visit summary. It saves lasting things you mention (like allergies);
        you can add, fix or remove them. Saying "forget that" in chat works too.
      </Text>
      {facts.length === 0 && <Text style={styles.empty}>Nothing saved yet.</Text>}
      {facts.map((f) =>
        editing?.id === f._id ? (
          <View key={f._id} style={styles.factRow}>
            <TextInput
              style={[styles.input, styles.flex]}
              value={editing.text}
              onChangeText={(text) => setEditing({ id: f._id, text })}
              autoFocus
              onSubmitEditing={() => void run("fact", async () => (await updateFact({ id: f._id, text: editing.text }), setEditing(null)))}
            />
            <Pressable onPress={() => void run("fact", async () => (await updateFact({ id: f._id, text: editing.text }), setEditing(null)))} accessibilityRole="button" accessibilityLabel="Save">
              <Ionicons name="checkmark" size={22} color={colors.primary} />
            </Pressable>
          </View>
        ) : (
          <View key={f._id} style={styles.factRow}>
            <Text style={[styles.fact, styles.flex]}>
              {f.text}
              <Text style={styles.small}>  {f.source === "assistant" ? "saved by Wellnest" : "added by you"}</Text>
            </Text>
            <Pressable onPress={() => setEditing({ id: f._id, text: f.text })} accessibilityRole="button" accessibilityLabel={`Edit ${f.text}`}>
              <Ionicons name="create-outline" size={19} color={colors.muted} />
            </Pressable>
            <Pressable onPress={() => void run("fact", () => deleteFact({ id: f._id }))} accessibilityRole="button" accessibilityLabel={`Remove ${f.text}`}>
              <Ionicons name="close" size={20} color={colors.danger} />
            </Pressable>
          </View>
        ),
      )}
      <View style={styles.factRow}>
        <TextInput
          style={[styles.input, styles.flex]}
          placeholder="Add a fact, e.g. Allergic to penicillin"
          placeholderTextColor={colors.muted}
          value={newFact}
          onChangeText={setNewFact}
          onSubmitEditing={() => void save()}
          maxLength={300}
        />
        <Pressable onPress={() => void save()} accessibilityRole="button" accessibilityLabel="Add fact">
          <Ionicons name="add-circle" size={26} color={colors.primary} />
        </Pressable>
      </View>

      <Text style={styles.section}>Your profile</Text>
      <Text style={styles.line}>Email: {profile.email ?? "none"}</Text>
      <Text style={styles.line}>Location: {profile.location ?? "not set"}</Text>
      <Text style={styles.line}>Time zone: {profile.timeZone ?? "not known yet"}</Text>
      <Text style={styles.line}>
        Voice: {profile.voiceMode ? "on" : "off"} · Telegram: {profile.telegramLinked ? "linked" : "not linked"}
      </Text>

      <Text style={styles.section}>What's stored</Text>
      {rows.map((r) => (
        <View key={r.label} style={styles.dataRow}>
          <Text style={styles.dataLabel}>{r.label}</Text>
          <Text style={[styles.small, styles.flex]}>{r.value}</Text>
          {r.category && (
            <Pressable onPress={() => void remove(r.category!, r.what!)} disabled={!!busy} accessibilityRole="button" accessibilityLabel={`Delete ${r.what}`}>
              {busy === r.category ? <ActivityIndicator size="small" /> : <Ionicons name="trash-outline" size={18} color={colors.danger} />}
            </Pressable>
          )}
        </View>
      ))}
      {facts.length > 0 && (
        <Pressable onPress={() => void remove("facts", "all saved facts")} accessibilityRole="button">
          <Text style={[styles.link, styles.danger]}>Delete all saved facts</Text>
        </Pressable>
      )}

      <Text style={styles.section}>Who sees what</Text>
      {SHARING.map(([who, what]) => (
        <Text key={who} style={styles.line}>
          <Text style={styles.bold}>{who}</Text>: {what}
        </Text>
      ))}
      <Text style={styles.small}>Everything is stored in Wellnest's Convex database. Wellnest isn't a doctor and this isn't a medical record.</Text>

      <View style={styles.actions}>
        <Pressable style={styles.button} onPress={() => void download()} disabled={!!busy} accessibilityRole="button">
          {busy === "export" ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Export my data</Text>}
        </Pressable>
        <Pressable style={[styles.button, styles.dangerButton]} onPress={() => void remove("everything", "")} disabled={!!busy} accessibilityRole="button">
          <Text style={[styles.buttonText, styles.danger]}>Delete everything</Text>
        </Pressable>
      </View>
      {error && <Text style={styles.error}>{error}</Text>}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  loading: { padding: 16 },
  scroll: { maxHeight: "80%", flexGrow: 0, backgroundColor: "#fff", borderBottomWidth: 1, borderBottomColor: colors.border },
  panel: { padding: 16, gap: 8, maxWidth: 760, width: "100%", alignSelf: "center" },
  titleRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  title: { fontSize: 17, fontWeight: "700", color: colors.text },
  section: { fontSize: 15, fontWeight: "700", color: colors.text, marginTop: 10 },
  note: { color: colors.muted, fontSize: 14, lineHeight: 19 },
  empty: { color: colors.muted, fontStyle: "italic" },
  small: { color: colors.muted, fontSize: 13 },
  line: { color: colors.text, fontSize: 14, lineHeight: 20 },
  bold: { fontWeight: "700" },
  flex: { flex: 1 },
  factRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  fact: { fontSize: 15, color: colors.text },
  input: { borderWidth: 1, borderColor: colors.border, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8, fontSize: 15 },
  dataRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 4, borderBottomWidth: 1, borderBottomColor: colors.bg },
  dataLabel: { width: 120, fontSize: 14, color: colors.text, fontWeight: "600" },
  actions: { flexDirection: "row", gap: 10, flexWrap: "wrap", marginTop: 8 },
  button: { backgroundColor: colors.primary, borderRadius: 10, paddingVertical: 10, paddingHorizontal: 16, minWidth: 150, alignItems: "center" },
  dangerButton: { backgroundColor: "#fff", borderWidth: 1, borderColor: colors.danger },
  buttonText: { color: "#fff", fontWeight: "600" },
  link: { color: colors.primary, fontWeight: "600" },
  danger: { color: colors.danger },
  error: { color: colors.danger, fontSize: 13 },
});

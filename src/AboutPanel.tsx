// "What Wellnest knows about me" (convex/me.ts): saved facts (editable), everything stored, who sees what,
// export, and deletion by category or of the whole account.
import { useState } from "react";
import { ActivityIndicator, Alert, Linking, Platform, Pressable, ScrollView, Share, Text, TextInput, View } from "react-native";
import { useAction, useMutation, useQuery } from "convex/react";
import { useAuthActions } from "@convex-dev/auth/react";
import { Ionicons } from "@expo/vector-icons";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { colors, pillish, round, themed } from "./theme";
import type { Strings } from "./i18n";

type Category = "chat" | "health" | "reminders" | "summaries" | "facts" | "journal" | "appointments" | "records" | "everything";

function confirm(title: string, message: string, action: string, cancel: string): Promise<boolean> {
  if (Platform.OS === "web") return Promise.resolve(window.confirm(`${title}\n\n${message}`));
  return new Promise((resolve) =>
    Alert.alert(title, message, [
      { text: cancel, style: "cancel", onPress: () => resolve(false) },
      { text: action, style: "destructive", onPress: () => resolve(true) },
    ]),
  );
}

const SHARING = ["shareCortex", "shareJina", "shareCartesia", "shareJev", "shareCreao", "shareTelehealth", "shareMaps", "shareTelegram"] as const;

const count = (c: { n: number; more: boolean }) => `${c.n.toLocaleString()}${c.more ? "+" : ""}`;

export function AboutPanel({ s }: { s: Strings }) {
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
        (await confirm(s.deleteAccountTitle, s.deleteAccountBody, s.continue, s.cancel)) &&
        (await confirm(s.areYouSure, s.deleteAllBody, s.deleteEverything, s.cancel));
      if (!ok) return;
      await run(category, async () => {
        await deleteData({ category });
        await signOut();
      });
      return;
    }
    if (await confirm(s.deleteWhatTitle.replace("{what}", what), s.cantUndo, s.delete, s.cancel)) await run(category, () => deleteData({ category }));
  };

  const rows: { label: string; value: string; category?: Category; what?: string }[] = [
    {
      label: s.rowMessages,
      value:
        (data.since ? s.messagesValue.replace("{n}", count(counts.messages)).replace("{date}", new Date(data.since).toLocaleDateString()) : count(counts.messages)) +
        (data.chatClearedAt ? s.clearedNote : ""),
      category: "chat",
      what: s.whatChat,
    },
    { label: s.rowPhotos, value: count(counts.photos) },
    { label: s.rowJournal, value: count(counts.journal), category: counts.journal.n ? "journal" : undefined, what: s.whatJournal },
    { label: s.rowAnalyses, value: count(counts.analyses) },
    {
      label: s.rowHealth,
      value: profile.healthConnected ? s.healthDays.replace("{n}", count(counts.healthDays)) + (profile.healthInAnalyses ? s.sharedWithAnalyses : "") : s.notConnected,
      category: counts.healthDays.n ? "health" : undefined,
      what: s.whatHealth,
    },
    {
      label: s.rowReminders,
      value: s.remindersValue.replace("{n}", count(counts.reminders)).replace("{d}", count(counts.doses)),
      category: counts.reminders.n ? "reminders" : undefined,
      what: s.whatReminders,
    },
    {
      label: s.rowAppointments,
      value: s.appointmentsValue.replace("{n}", count(counts.visits)).replace("{t}", count(counts.careTeam)),
      category: counts.visits.n || counts.careTeam.n ? "appointments" : undefined,
      what: s.whatAppointments,
    },
    { label: s.rowSummaries, value: count(counts.summaries), category: counts.summaries.n ? "summaries" : undefined, what: s.whatSummaries },
    { label: s.rowRecords, value: count(counts.records), category: counts.records.n ? "records" : undefined, what: s.whatRecords },
  ];

  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.panel}>
      <View style={styles.titleRow}>
        <Ionicons name="finger-print-outline" size={20} color={colors.primary} />
        <Text style={styles.title}>{s.aboutTitle}</Text>
      </View>

      <Text style={styles.section}>{s.savedFacts}</Text>
      <Text style={styles.note}>{s.factsIntro}</Text>
      {facts.length === 0 && <Text style={styles.empty}>{s.nothingSaved}</Text>}
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
            <Pressable onPress={() => void run("fact", async () => (await updateFact({ id: f._id, text: editing.text }), setEditing(null)))} accessibilityRole="button" accessibilityLabel={s.save}>
              <Ionicons name="checkmark" size={22} color={colors.primary} />
            </Pressable>
          </View>
        ) : (
          <View key={f._id} style={styles.factRow}>
            <Text style={[styles.fact, styles.flex]}>
              {f.text}
              <Text style={styles.small}>  {f.source === "assistant" ? s.savedByWellnest : s.addedByYou}</Text>
            </Text>
            <Pressable onPress={() => setEditing({ id: f._id, text: f.text })} accessibilityRole="button" accessibilityLabel={`${s.edit}: ${f.text}`}>
              <Ionicons name="create-outline" size={19} color={colors.muted} />
            </Pressable>
            <Pressable onPress={() => void run("fact", () => deleteFact({ id: f._id }))} accessibilityRole="button" accessibilityLabel={`${s.remove}: ${f.text}`}>
              <Ionicons name="close" size={20} color={colors.danger} />
            </Pressable>
          </View>
        ),
      )}
      <View style={styles.factRow}>
        <TextInput
          style={[styles.input, styles.flex]}
          placeholder={s.factPlaceholder}
          placeholderTextColor={colors.muted}
          value={newFact}
          onChangeText={setNewFact}
          onSubmitEditing={() => void save()}
          maxLength={300}
        />
        <Pressable onPress={() => void save()} accessibilityRole="button" accessibilityLabel={s.addFact}>
          <Ionicons name="add-circle" size={26} color={colors.primary} />
        </Pressable>
      </View>

      <Text style={styles.section}>{s.yourProfile}</Text>
      <Text style={styles.line}>{s.emailLine.replace("{v}", profile.email ?? s.none)}</Text>
      <Text style={styles.line}>{s.locationLine.replace("{v}", profile.location ?? s.notSet)}</Text>
      <Text style={styles.line}>{s.timeZoneLine.replace("{v}", profile.timeZone ?? s.notKnownYet)}</Text>
      <Text style={styles.line}>{s.telegramLine.replace("{v}", profile.telegramLinked ? s.linked : s.notLinked)}</Text>

      <Text style={styles.section}>{s.whatsStored}</Text>
      {rows.map((r) => (
        <View key={r.label} style={styles.dataRow}>
          <Text style={styles.dataLabel}>{r.label}</Text>
          <Text style={[styles.small, styles.flex]}>{r.value}</Text>
          {r.category && (
            <Pressable onPress={() => void remove(r.category!, r.what!)} disabled={!!busy} accessibilityRole="button" accessibilityLabel={s.deleteWhatTitle.replace("{what}", r.what!)}>
              {busy === r.category ? <ActivityIndicator size="small" /> : <Ionicons name="trash-outline" size={18} color={colors.danger} />}
            </Pressable>
          )}
        </View>
      ))}
      {facts.length > 0 && (
        <Pressable onPress={() => void remove("facts", s.whatFacts)} accessibilityRole="button">
          <Text style={[styles.link, styles.danger]}>{s.deleteAllFacts}</Text>
        </Pressable>
      )}

      <Text style={styles.section}>{s.whoSees}</Text>
      {SHARING.map((key) => {
        const [who, ...rest] = s[key].split(": ");
        return (
          <Text key={key} style={styles.line}>
            <Text style={styles.bold}>{who}</Text>: {rest.join(": ")}
          </Text>
        );
      })}
      <Text style={styles.small}>{s.storedNote}</Text>

      <View style={styles.actions}>
        <Pressable style={styles.button} onPress={() => void download()} disabled={!!busy} accessibilityRole="button">
          {busy === "export" ? <ActivityIndicator color={colors.onPrimary} /> : <Text style={styles.buttonText}>{s.exportData}</Text>}
        </Pressable>
        <Pressable style={[styles.button, styles.dangerButton]} onPress={() => void remove("everything", "")} disabled={!!busy} accessibilityRole="button">
          <Text style={[styles.buttonText, styles.danger]}>{s.deleteEverything}</Text>
        </Pressable>
      </View>
      {error && <Text style={styles.error}>{error}</Text>}
      <Pressable
        onPress={() => void Linking.openURL(Platform.OS === "web" ? "/privacy" : "https://talktothebeak.health/privacy")}
        accessibilityRole="link"
      >
        <Text style={styles.link}>{s.landPrivacy}</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = themed(() => ({
  loading: { padding: 16 },
  scroll: { flexGrow: 0, flexShrink: 1, backgroundColor: colors.surface, borderBottomWidth: 1, borderBottomColor: colors.border },
  panel: { padding: 16, gap: 8, maxWidth: 760, width: "100%", alignSelf: "center" },
  titleRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  title: { fontSize: 17, fontWeight: "700", color: colors.text },
  section: { fontSize: 15, fontWeight: "700", color: colors.text, marginTop: 10 },
  note: { color: colors.muted, fontSize: 14, lineHeight: 19 },
  empty: { color: colors.muted, fontStyle: "italic", fontSize: 14 },
  small: { color: colors.muted, fontSize: 13 },
  line: { color: colors.text, fontSize: 14, lineHeight: 20 },
  bold: { fontWeight: "700" },
  flex: { flex: 1 },
  factRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  fact: { fontSize: 15, color: colors.text },
  input: { color: colors.text, borderWidth: 1, borderColor: colors.border, borderRadius: round(8), paddingHorizontal: 10, paddingVertical: 8, fontSize: 15 },
  dataRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 4, borderBottomWidth: 1, borderBottomColor: colors.bg },
  dataLabel: { width: 120, fontSize: 14, color: colors.text, fontWeight: "600" },
  actions: { flexDirection: "row", gap: 10, flexWrap: "wrap", marginTop: 8 },
  button: { backgroundColor: colors.primary, borderRadius: pillish(10), paddingVertical: 10, paddingHorizontal: 16, minWidth: 150, alignItems: "center" },
  dangerButton: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.danger },
  buttonText: { color: colors.onPrimary, fontWeight: "600", fontSize: 14 },
  link: { color: colors.primary, fontWeight: "600", fontSize: 14 },
  danger: { color: colors.danger },
  error: { color: colors.danger, fontSize: 13 },
}));

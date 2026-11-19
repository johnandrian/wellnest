// Actions: the agent's inbox (convex/agent.ts). Each card says what the assistant wants to do, why, and the logged
// facts it's based on; nothing happens until the user taps Approve. Red flags carry a fixed "call your care team or
// 911" notice, written here rather than by the model. A doctor message draft can be changed before approving and
// copied at any time. Handled actions move to History, grouped by week, with what happened.
import { useState } from "react";
import { ActivityIndicator, ScrollView, Text, TextInput, View } from "react-native";
import * as Clipboard from "expo-clipboard";
import { Ionicons } from "@expo/vector-icons";
import { useMutation, useQuery } from "convex/react";
import { api } from "../convex/_generated/api";
import type { Doc, Id } from "../convex/_generated/dataModel";
import { Tap } from "./Tap";
import { Icon } from "./Icon";
import { Enter, Reveal, SwapIcon } from "./Motion";
import { colors, radius, tint, TOUCH, ui, themed } from "./theme";
import type { Strings } from "./i18n";
import { errorText, showToast } from "./feedback";
import { formatDate } from "./format";

type Action = Doc<"agentActions">;

// Monday of the week `at` falls in, local time.
function weekStart(at: number) {
  const d = new Date(at);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d.getTime();
}

// History in weeks, newest first: "This week", "Last week", then "Week of Nov 3".
function byWeek(actions: Action[], s: Strings) {
  const now = weekStart(Date.now());
  const weeks: { label: string; items: Action[] }[] = [];
  let key: number | null = null;
  for (const a of actions) {
    const start = weekStart(a.decidedAt ?? a._creationTime);
    if (start !== key) {
      key = start;
      const ago = Math.round((now - start) / (7 * 86_400_000));
      const label =
        ago <= 0 ? s.agentThisWeek
        : ago === 1 ? s.agentLastWeek
        : s.agentWeekOf.replace("{date}", formatDate(start, s));
      weeks.push({ label, items: [] });
    }
    weeks[weeks.length - 1].items.push(a);
  }
  return weeks;
}


export function AgentPanel({ s }: { s: Strings }) {
  const actions = useQuery(api.agent.list);
  if (actions === undefined) return <ActivityIndicator style={styles.loading} color={colors.primary} />;
  const open = actions.filter((a) => a.status === "proposed");
  // Most recently decided first.
  const past = actions.filter((a) => a.status !== "proposed").sort((a, b) => (b.decidedAt ?? b._creationTime) - (a.decidedAt ?? a._creationTime));
  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.panel}>
      <View style={styles.head}>
        <View style={[styles.headIcon, { backgroundColor: tint.agent.bg }]}>
          <Icon name="agent" size={22} color={tint.agent.fg} />
        </View>
        <Text style={styles.title} accessibilityRole="header">
          {s.agentNeedsYou}
        </Text>
      </View>
      {open.length === 0 ? (
        <Text style={styles.empty}>{s.agentEmpty}</Text>
      ) : (
        open.map((a) => (
          <Enter key={a._id}>
            <ActionCard s={s} action={a} />
          </Enter>
        ))
      )}
      {past.length > 0 && (
        <>
          <Text style={styles.section} accessibilityRole="header">
            {s.agentHistory}
          </Text>
          {byWeek(past, s).map((w) => (
            <View key={w.label} style={styles.week}>
              <Text style={styles.weekLabel}>{w.label}</Text>
              {w.items.map((a) => (
                <Enter key={a._id}>
                  <ActionCard s={s} action={a} />
                </Enter>
              ))}
            </View>
          ))}
        </>
      )}
    </ScrollView>
  );
}

function ActionCard({ s, action }: { s: Strings; action: Action }) {
  const approve = useMutation(api.agent.approve);
  const dismiss = useMutation(api.agent.dismiss);
  const editDraft = useMutation(api.agent.editDraft);
  const [busy, setBusy] = useState<"approve" | "dismiss" | null>(null);
  const [editing, setEditing] = useState<{ subject: string; body: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showWhy, setShowWhy] = useState(false);
  const pending = action.status === "proposed";
  const d = action.details;

  async function run(which: "approve" | "dismiss", id: Id<"agentActions">) {
    setBusy(which);
    setError(null);
    try {
      await (which === "approve" ? approve : dismiss)({ id });
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <View style={[styles.card, action.urgent && styles.cardUrgent]}>
      {action.urgent && (
        <View style={styles.urgent} accessibilityRole="alert">
          <Ionicons name="warning" size={18} color={colors.danger} />
          <Text style={styles.urgentText}>{s.agentUrgent}</Text>
        </View>
      )}
      <View style={styles.row}>
        <Text style={styles.kind}>{s.agentKind[d.kind]}</Text>
        {!pending && (
          <View style={styles.statusRow}>
            <SwapIcon id={action.status}>
              <StatusIcon status={action.status} />
            </SwapIcon>
            <Text style={styles.status}>{s.agentStatus[action.status]}</Text>
          </View>
        )}
      </View>
      <Text style={styles.cardTitle}>{action.title}</Text>
      <Text style={styles.reason}>{action.reason}</Text>

      {d.kind === "message_doctor" && (
        <View style={styles.draft}>
          <Text style={styles.small}>
            {s.agentTo}: {d.to}
          </Text>
          {editing ? (
            <>
              <TextInput
                style={[styles.input, styles.draftSubject]}
                value={editing.subject}
                onChangeText={(subject) => setEditing({ ...editing, subject })}
                maxLength={200}
                accessibilityLabel={s.agentSubject}
              />
              <TextInput
                style={[styles.input, styles.draftBody, styles.bodyInput]}
                value={editing.body}
                onChangeText={(body) => setEditing({ ...editing, body })}
                multiline
                maxLength={4000}
                textAlignVertical="top"
                accessibilityLabel={s.agentMessage}
              />
              <View style={styles.inline}>
                <Tap
                  style={ui.button}
                  disabled={saving}
                  onPress={async () => {
                    setSaving(true);
                    setError(null);
                    try {
                      await editDraft({ id: action._id, ...editing });
                      setEditing(null);
                    } catch (e) {
                      setError(errorText(e));
                    } finally {
                      setSaving(false);
                    }
                  }}
                  accessibilityRole="button"
                >
                  {saving ? <ActivityIndicator color={colors.onPrimary} /> : <Text style={styles.buttonText}>{s.save}</Text>}
                </Tap>
                <Tap style={styles.textButton} onPress={() => setEditing(null)} accessibilityRole="button">
                  <Text style={styles.link}>{s.cancel}</Text>
                </Tap>
              </View>
            </>
          ) : (
            <>
              <Text style={styles.draftSubject}>{d.subject}</Text>
              <Text style={styles.draftBody} selectable>
                {d.body}
              </Text>
              <View style={styles.inline}>
                {pending && (
                  <Tap style={styles.textButton} onPress={() => setEditing({ subject: d.subject, body: d.body })} accessibilityRole="button" accessibilityLabel={`${s.agentEditDraft}: ${action.title}`}>
                    <Ionicons name="create-outline" size={16} color={colors.primary} />
                    <Text style={styles.link}>{s.agentEditDraft}</Text>
                  </Tap>
                )}
                <Tap
                  style={styles.textButton}
                  onPress={() =>
                    void Clipboard.setStringAsync(`${d.subject}\n\n${d.body}`).then(
                      () => showToast(s.copied),
                      (e) => showToast(errorText(e)),
                    )
                  }
                  accessibilityRole="button"
                >
                  <Ionicons name="copy-outline" size={16} color={colors.primary} />
                  <Text style={styles.link}>{s.copy}</Text>
                </Tap>
              </View>
            </>
          )}
        </View>
      )}

      {action.evidence.length > 0 && (
        <>
          <Tap style={styles.why} onPress={() => setShowWhy(!showWhy)} accessibilityRole="button" accessibilityLabel={s.agentBasedOn} accessibilityState={{ expanded: showWhy }}>
            <Text style={styles.link}>{s.agentBasedOn}</Text>
            <SwapIcon id={showWhy ? "up" : "down"}>
              <Ionicons name={showWhy ? "chevron-up" : "chevron-down"} size={16} color={colors.primary} />
            </SwapIcon>
          </Tap>
          <Reveal open={showWhy}>
            <View style={styles.evidence}>
              {action.evidence.map((e, i) => (
                <View key={i} style={styles.evRow}>
                  <Text style={styles.evLabel}>
                    {e.label}
                    {e.date ? ` · ${e.date}` : ""}
                  </Text>
                  <Text style={styles.evValue}>{e.value}</Text>
                </View>
              ))}
            </View>
          </Reveal>
        </>
      )}

      {action.result && <Text style={styles.small}>{action.result}</Text>}
      {action.error && <Text style={styles.error}>{action.error}</Text>}
      {error && <Text style={styles.error}>{error}</Text>}

      {pending && (
        <View style={styles.buttons}>
          <Tap style={[ui.button, styles.grow]} onPress={() => run("approve", action._id)} disabled={busy !== null} accessibilityRole="button" accessibilityLabel={`${s.agentApprove}: ${action.title}`}>
            {busy === "approve" ? <ActivityIndicator color={colors.onPrimary} /> : <Text style={styles.buttonText}>{s.agentApprove}</Text>}
          </Tap>
          <Tap style={[ui.addButton, styles.grow]} onPress={() => run("dismiss", action._id)} disabled={busy !== null} accessibilityRole="button" accessibilityLabel={`${s.agentDismiss}: ${action.title}`}>
            {busy === "dismiss" ? <ActivityIndicator color={colors.primary} /> : <Text style={styles.link}>{s.agentDismiss}</Text>}
          </Tap>
        </View>
      )}
    </View>
  );
}

function StatusIcon({ status }: { status: Action["status"] }) {
  if (status === "running" || status === "approved") return <ActivityIndicator size="small" color={colors.muted} />;
  if (status === "done") return <Ionicons name="checkmark-circle" size={16} color={colors.primary} />;
  if (status === "failed") return <Ionicons name="alert-circle" size={16} color={colors.danger} />;
  return <Ionicons name="remove-circle-outline" size={16} color={colors.muted} />;
}

const styles = themed(() => ({
  loading: { flex: 1 },
  scroll: { flex: 1, backgroundColor: colors.bg },
  panel: { padding: 16, gap: 12, maxWidth: 760, width: "100%", alignSelf: "center", paddingBottom: 40 },
  head: { flexDirection: "row", alignItems: "center", gap: 12 },
  headIcon: { width: 44, height: 44, borderRadius: radius.md, alignItems: "center", justifyContent: "center" },
  title: { flex: 1, fontSize: 20, fontWeight: "700", color: colors.text },
  empty: { ...ui.empty },
  section: { ...ui.section },
  card: { ...ui.card, padding: 14, gap: 8 },
  cardUrgent: { borderColor: colors.dangerBorder },
  urgent: { flexDirection: "row", alignItems: "flex-start", gap: 8, padding: 10, borderRadius: radius.sm, backgroundColor: colors.dangerSoft },
  urgentText: { flex: 1, color: colors.danger, fontWeight: "700", fontSize: 14, lineHeight: 20 },
  row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  kind: { fontSize: 12, fontWeight: "700", color: tint.agent.fg, textTransform: "uppercase", letterSpacing: 0.8 },
  statusRow: { flexDirection: "row", alignItems: "center", gap: 4 },
  status: { fontSize: 13, fontWeight: "600", color: colors.muted },
  cardTitle: { fontSize: 17, fontWeight: "700", color: colors.text },
  reason: { fontSize: 15, lineHeight: 21, color: colors.text },
  draft: { gap: 4, padding: 12, borderRadius: radius.sm, backgroundColor: colors.bg, borderWidth: 1, borderColor: colors.hairline },
  draftSubject: { fontSize: 15, fontWeight: "700", color: colors.text },
  draftBody: { fontSize: 15, lineHeight: 21, color: colors.text },
  input: { borderWidth: 1, borderColor: colors.inputBorder, backgroundColor: colors.surface, borderRadius: radius.sm, paddingHorizontal: 10, paddingVertical: 8 },
  bodyInput: { minHeight: 140 },
  inline: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 12, marginTop: 4 },
  textButton: { flexDirection: "row", alignItems: "center", gap: 4, minHeight: TOUCH },
  week: { gap: 10 },
  weekLabel: { fontSize: 13, fontWeight: "700", color: colors.muted, marginTop: 4 },
  why: { flexDirection: "row", alignItems: "center", gap: 4, minHeight: TOUCH, alignSelf: "flex-start" },
  evidence: { gap: 6, paddingBottom: 4 },
  evRow: { flexDirection: "row", justifyContent: "space-between", gap: 12 },
  evLabel: { flex: 1, fontSize: 14, color: colors.muted },
  evValue: { fontSize: 14, fontWeight: "600", color: colors.text },
  small: { fontSize: 13, color: colors.muted, lineHeight: 18 },
  error: { fontSize: 13, color: colors.danger, lineHeight: 18 },
  link: { color: colors.primary, fontWeight: "600", fontSize: 14 },
  buttons: { flexDirection: "row", gap: 8, marginTop: 4 },
  grow: { flex: 1 },
  buttonText: { color: colors.onPrimary, fontWeight: "600", fontSize: 14 },
}));

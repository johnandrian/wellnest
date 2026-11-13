// Actions: the agent's inbox (convex/agent.ts). Each card says what the assistant wants to do, why, and the logged
// facts it's based on; nothing happens until the user taps Approve. Red flags carry a fixed "call your care team or
// 911" notice, written here rather than by the model. Handled actions move to History with what happened.
import { useState } from "react";
import { ActivityIndicator, ScrollView, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useMutation, useQuery } from "convex/react";
import { api } from "../convex/_generated/api";
import type { Doc, Id } from "../convex/_generated/dataModel";
import { Tap } from "./Tap";
import { Icon } from "./Icon";
import { Enter, Reveal, SwapIcon } from "./Motion";
import { colors, radius, tint, TOUCH, ui, themed } from "./theme";
import type { Strings } from "./i18n";

type Action = Doc<"agentActions">;

const cleanError = (e: unknown) => (e as Error).message.replace(/^.*Uncaught Error: /, "").split("\n")[0];

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
          {past.map((a) => (
            <Enter key={a._id}>
              <ActionCard s={s} action={a} />
            </Enter>
          ))}
        </>
      )}
    </ScrollView>
  );
}

function ActionCard({ s, action }: { s: Strings; action: Action }) {
  const approve = useMutation(api.agent.approve);
  const dismiss = useMutation(api.agent.dismiss);
  const [busy, setBusy] = useState<"approve" | "dismiss" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showWhy, setShowWhy] = useState(action.status === "proposed");
  const pending = action.status === "proposed";
  const d = action.details;

  async function run(which: "approve" | "dismiss", id: Id<"agentActions">) {
    setBusy(which);
    setError(null);
    try {
      await (which === "approve" ? approve : dismiss)({ id });
    } catch (e) {
      setError(cleanError(e));
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
          <Text style={styles.draftSubject}>{d.subject}</Text>
          <Text style={styles.draftBody} selectable>
            {d.body}
          </Text>
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

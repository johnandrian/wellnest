// Care circle (convex/circle.ts). Two sides on one screen: the people who invited you, each opening a read-only
// view of how they're doing; and your own circle, where you invite family or carers with a one-time link, pick
// which alerts each gets (missed doses, the flare forecast) and remove them.
import { useMemo, useState } from "react";
import { ActivityIndicator, Linking, Platform, ScrollView, Switch, Text, TextInput, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useConvex, useMutation, useQuery } from "convex/react";
import * as Print from "expo-print";
import * as Sharing from "expo-sharing";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { Tap } from "./Tap";
import { Icon } from "./Icon";
import { Enter, Reveal, SwapIcon } from "./Motion";
import { shareUrl } from "./ShareCard";
import { colors, radius, tint, TOUCH, ui, themed } from "./theme";
import type { Strings } from "./i18n";

type Alerts = { missedDoses: boolean; forecast: boolean };
type Person = { ownerId: Id<"users">; name: string };

const errorText = (e: unknown) => (e as Error).message.replace(/^.*Uncaught Error: /, "").split("\n")[0];
const shortDate = (at: number | string, locale: string) =>
  new Date(typeof at === "string" ? `${at}T12:00:00` : at).toLocaleDateString(locale, { month: "short", day: "numeric" });
const alertList = (a: Alerts, s: Strings) =>
  [a.missedDoses && s.circleAlertMissed, a.forecast && s.circleAlertForecast].filter(Boolean).join(", ") || s.circleAlertsNone;

export function CirclePanel({ s }: { s: Strings }) {
  const [person, setPerson] = useState<Person | null>(null);
  return person ? (
    <Enter key={person.ownerId} style={styles.flex}>
      <PersonView s={s} person={person} onBack={() => setPerson(null)} />
    </Enter>
  ) : (
    <Enter key="list" style={styles.flex}>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.panel}>
        <CaringFor s={s} onOpen={setPerson} />
        <MyCircle s={s} />
      </ScrollView>
    </Enter>
  );
}

// ---------- The people who invited you ----------

function CaringFor({ s, onOpen }: { s: Strings; onOpen: (p: Person) => void }) {
  const people = useQuery(api.circle.caringFor);
  if (!people?.length) return null;
  return (
    <View style={styles.section}>
      <Text style={styles.heading} accessibilityRole="header">
        {s.circleCaringFor}
      </Text>
      {people.map((p) => (
        <Tap key={p._id} style={styles.personRow} onPress={() => onOpen({ ownerId: p.ownerId, name: p.name })} accessibilityRole="button" accessibilityLabel={p.name}>
          <View style={[styles.avatar, { backgroundColor: tint.circle.bg }]}>
            <Text style={[styles.avatarText, { color: tint.circle.fg }]}>{p.name.charAt(0).toUpperCase()}</Text>
          </View>
          <View style={styles.flex}>
            <Text style={styles.name} numberOfLines={1}>
              {p.name}
            </Text>
            <Text style={styles.small} numberOfLines={1}>
              {s.circleAlertsYou.replace("{list}", alertList(p.alerts, s))}
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={20} color={colors.muted} />
        </Tap>
      ))}
    </View>
  );
}

const STATUS: Record<"taken" | "skipped" | "missed" | "due", { label: (s: Strings) => string; bg: () => string; fg: () => string }> = {
  taken: { label: (s: Strings) => s.circleDoseTaken, bg: () => colors.successSoft, fg: () => colors.text },
  skipped: { label: (s: Strings) => s.circleDoseSkipped, bg: () => colors.warningSoft, fg: () => colors.warningText },
  missed: { label: (s: Strings) => s.circleDoseMissed, bg: () => colors.dangerSoft, fg: () => colors.danger },
  due: { label: (s: Strings) => s.circleDoseDue, bg: () => colors.codeBg, fg: () => colors.muted },
};

function PersonView({ s, person, onBack }: { s: Strings; person: Person; onBack: () => void }) {
  const now = useMemo(() => Math.floor(Date.now() / 60_000) * 60_000, []);
  const view = useQuery(api.circle.person, { ownerId: person.ownerId, now });
  const caringFor = useQuery(api.circle.caringFor);
  const leave = useMutation(api.circle.remove);
  const convex = useConvex();
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const row = caringFor?.find((p) => p.ownerId === person.ownerId);

  const openReport = async () => {
    setError(null);
    setBusy(true);
    try {
      const html = await convex.query(api.circle.report, { ownerId: person.ownerId, now: Date.now(), generated: new Date().toLocaleString() });
      if (Platform.OS === "web") {
        const win = window.open("", "_blank");
        if (!win) throw new Error(s.allowPopups);
        win.document.write(html);
        win.document.close();
        win.focus();
      } else {
        const { uri } = await Print.printToFileAsync({ html });
        if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(uri, { mimeType: "application/pdf", UTI: "com.adobe.pdf", dialogTitle: s.circleReport });
        else await Print.printAsync({ uri });
      }
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.panel}>
      <View style={styles.inline}>
        <Tap style={styles.back} onPress={onBack} accessibilityRole="button" accessibilityLabel={s.circleBack}>
          <Ionicons name="chevron-back" size={20} color={colors.primary} />
          <Text style={styles.link}>{s.circleBack}</Text>
        </Tap>
      </View>
      <Text style={styles.title} accessibilityRole="header">
        {person.name}
      </Text>

      {view === undefined ? (
        <ActivityIndicator color={colors.primary} />
      ) : view === null ? (
        <Text style={ui.empty}>{s.joinInvalid}</Text>
      ) : (
        <>
          {!!view.forecast.length && (
            <View style={[styles.card, styles.warnCard]}>
              <View style={styles.inline}>
                <Icon name="forecast" size={20} color={colors.warningText} />
                <Text style={[styles.cardTitle, { color: colors.warningText }]}>{s.homeTomorrow}</Text>
              </View>
              {view.forecast.map((line) => (
                <Text key={line} style={styles.body}>
                  {line}
                </Text>
              ))}
            </View>
          )}

          <View style={styles.card}>
            <View style={styles.inline}>
              <Icon name="doses" size={20} color={tint.medications.fg} />
              <Text style={styles.cardTitle}>{s.circleTodayDoses}</Text>
            </View>
            {view.doses.length ? (
              view.doses.map((d) => {
                const st = STATUS[d.status];
                return (
                  <View key={`${d.name}-${d.at}`} style={styles.doseRow}>
                    <Text style={[styles.body, styles.flex]} numberOfLines={1}>
                      {d.name}
                    </Text>
                    <Text style={styles.small}>{new Date(d.at).toLocaleTimeString(s.locale, { hour: "numeric", minute: "2-digit" })}</Text>
                    <View style={[styles.pill, { backgroundColor: st.bg() }]}>
                      <Text style={[styles.pillText, { color: st.fg() }]}>{st.label(s)}</Text>
                    </View>
                  </View>
                );
              })
            ) : (
              <Text style={styles.muted}>{s.circleNoDoses}</Text>
            )}
          </View>

          <View style={styles.card}>
            <View style={styles.inline}>
              <Icon name="medications" size={20} color={tint.medications.fg} />
              <Text style={styles.cardTitle}>{s.circleMeds}</Text>
            </View>
            {view.meds.length ? (
              view.meds.map((m) => (
                <Text key={m.name} style={styles.body}>
                  • {m.name}
                  {m.dose ? ` · ${m.dose}` : ""}
                  {m.paused ? ` (${s.circlePaused})` : ""}
                </Text>
              ))
            ) : (
              <Text style={styles.muted}>{s.circleNoMeds}</Text>
            )}
          </View>

          <View style={styles.card}>
            <View style={styles.inline}>
              <Icon name="insights" size={20} color={tint.journal.fg} />
              <Text style={styles.cardTitle}>{s.circleWeek}</Text>
            </View>
            {view.week.length ? (
              view.week.map((line) => (
                <Text key={line} style={styles.body}>
                  • {line}
                </Text>
              ))
            ) : (
              <Text style={styles.muted}>{s.circleNoWeek}</Text>
            )}
            {view.lastLogged && <Text style={styles.small}>{s.circleLastLogged.replace("{date}", shortDate(view.lastLogged, s.locale))}</Text>}
          </View>

          {!!view.contacts.length && (
            <View style={styles.card}>
              <View style={styles.inline}>
                <Icon name="care" size={20} color={tint.care.fg} />
                <Text style={styles.cardTitle}>{s.circleContacts}</Text>
              </View>
              {view.contacts.map((c) => (
                <View key={`${c.name}-${c.phone}`} style={styles.doseRow}>
                  <View style={styles.flex}>
                    <Text style={styles.body}>{c.name}</Text>
                    {!!c.relation && <Text style={styles.small}>{c.relation}</Text>}
                  </View>
                  <Tap style={styles.callButton} onPress={() => void Linking.openURL(`tel:${c.phone}`)} accessibilityRole="button" accessibilityLabel={`${s.circleCall} ${c.name}`}>
                    <Ionicons name="call-outline" size={16} color={colors.onPrimary} />
                    <Text style={styles.buttonText}>{s.circleCall}</Text>
                  </Tap>
                </View>
              ))}
            </View>
          )}

          <Tap style={styles.addButton} onPress={() => void openReport()} disabled={busy} accessibilityRole="button">
            {busy ? <ActivityIndicator color={colors.primary} /> : <Icon name="reports" size={18} color={colors.primary} />}
            <Text style={styles.link}>{s.circleReport}</Text>
          </Tap>
          {error && <Text style={styles.error}>{error}</Text>}
          <Text style={styles.small}>{s.circleAlertsYou.replace("{list}", alertList(view.alerts, s))}</Text>

          {row && (
            <>
              <Tap onPress={() => setConfirm(!confirm)} accessibilityRole="button">
                <Text style={[styles.link, styles.danger]}>{s.circleLeave}</Text>
              </Tap>
              <Reveal open={confirm} style={styles.confirm}>
                <Text style={styles.body}>{s.circleLeaveAsk.replace("{name}", person.name)}</Text>
                <View style={styles.inline}>
                  <Tap
                    style={[styles.button, styles.dangerButton]}
                    onPress={() => void leave({ id: row._id }).then(onBack, (e) => setError(errorText(e)))}
                    accessibilityRole="button"
                  >
                    <Text style={styles.dangerButtonText}>{s.circleLeave}</Text>
                  </Tap>
                  <Tap onPress={() => setConfirm(false)} accessibilityRole="button">
                    <Text style={styles.link}>{s.cancel}</Text>
                  </Tap>
                </View>
              </Reveal>
            </>
          )}
        </>
      )}
    </ScrollView>
  );
}

// ---------- Your own circle ----------

function AlertSwitches({ value, onChange, s }: { value: Alerts; onChange: (a: Alerts) => void; s: Strings }) {
  return (
    <View style={styles.switches}>
      {(
        [
          ["missedDoses", s.circleAlertMissed],
          ["forecast", s.circleAlertForecast],
        ] as const
      ).map(([key, label]) => (
        <View key={key} style={styles.switchRow}>
          <Text style={[styles.body, styles.flex]}>{label}</Text>
          <Switch value={value[key]} onValueChange={(on) => onChange({ ...value, [key]: on })} accessibilityLabel={label} />
        </View>
      ))}
    </View>
  );
}

function MyCircle({ s }: { s: Strings }) {
  const now = useMemo(() => Math.floor(Date.now() / 60_000) * 60_000, []);
  const mine = useQuery(api.circle.mine, { now });
  const invite = useMutation(api.circle.invite);
  const cancelInvite = useMutation(api.circle.cancelInvite);
  const setAlerts = useMutation(api.circle.setAlerts);
  const remove = useMutation(api.circle.remove);
  const [making, setMaking] = useState(false);
  const [label, setLabel] = useState("");
  const [alerts, setNewAlerts] = useState<Alerts>({ missedDoses: true, forecast: true });
  const [made, setMade] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const create = async () => {
    setError(null);
    try {
      const { url } = await invite({ label: label || undefined, alerts });
      setMade(url);
      setMaking(false);
      setLabel("");
    } catch (e) {
      setError(errorText(e));
    }
  };

  const send = async (url: string) => {
    const how = await shareUrl(url, s.circleInviteShareTitle).catch(() => null);
    if (how === "copied") {
      setNotice(s.copied);
      setTimeout(() => setNotice(null), 2000);
    }
  };

  return (
    <View style={styles.section}>
      <Text style={styles.heading} accessibilityRole="header">
        {s.circleYours}
      </Text>
      <Text style={styles.muted}>{s.circleIntro}</Text>

      {mine === undefined ? (
        <ActivityIndicator color={colors.primary} />
      ) : (
        <>
          {!mine?.members.length && !mine?.invites.length && <Text style={ui.empty}>{s.circleNoMembers}</Text>}
          {mine?.members.map((m) => (
            <View key={m._id} style={styles.card}>
              <View style={styles.inline}>
                <View style={[styles.avatar, { backgroundColor: tint.circle.bg }]}>
                  <Text style={[styles.avatarText, { color: tint.circle.fg }]}>{(m.label ?? m.name).charAt(0).toUpperCase()}</Text>
                </View>
                <View style={styles.flex}>
                  <Text style={styles.name} numberOfLines={1}>
                    {m.label ?? m.name}
                  </Text>
                  {!!m.label && (
                    <Text style={styles.small} numberOfLines={1}>
                      {m.name}
                    </Text>
                  )}
                </View>
                <Tap onPress={() => setRemoving(removing === m._id ? null : m._id)} accessibilityRole="button">
                  <Text style={[styles.link, styles.danger]}>{s.circleRemove}</Text>
                </Tap>
              </View>
              <AlertSwitches value={m.alerts} onChange={(a) => void setAlerts({ id: m._id, alerts: a }).catch((e) => setError(errorText(e)))} s={s} />
              <Reveal open={removing === m._id} style={styles.confirm}>
                <Text style={styles.body}>{s.circleRemoveAsk.replace("{name}", m.label ?? m.name)}</Text>
                <View style={styles.inline}>
                  <Tap style={[styles.button, styles.dangerButton]} onPress={() => void remove({ id: m._id }).catch((e) => setError(errorText(e)))} accessibilityRole="button">
                    <Text style={styles.dangerButtonText}>{s.circleRemove}</Text>
                  </Tap>
                  <Tap onPress={() => setRemoving(null)} accessibilityRole="button">
                    <Text style={styles.link}>{s.circleKeep}</Text>
                  </Tap>
                </View>
              </Reveal>
            </View>
          ))}

          {mine?.invites.map((i) => (
            <View key={i._id} style={[styles.card, styles.pending]}>
              <View style={styles.inline}>
                <Icon name="invite" size={20} color={colors.muted} />
                <View style={styles.flex}>
                  <Text style={styles.name} numberOfLines={1}>
                    {i.label ?? s.circleUnnamed}
                  </Text>
                  <Text style={styles.small}>{s.circlePending.replace("{when}", shortDate(i.expiresAt, s.locale))}</Text>
                </View>
                <Tap onPress={() => void send(i.url)} accessibilityRole="button" accessibilityLabel={Platform.OS === "web" ? s.copy : s.share}>
                  <Ionicons name={Platform.OS === "web" ? "copy-outline" : "share-outline"} size={20} color={colors.primary} />
                </Tap>
                <Tap onPress={() => void cancelInvite({ id: i._id })} accessibilityRole="button">
                  <Text style={[styles.link, styles.danger]}>{s.cancel}</Text>
                </Tap>
              </View>
            </View>
          ))}
        </>
      )}

      <Reveal open={!!made}>
        {made && (
          <View style={styles.made}>
            <Text style={styles.body}>{s.circleInviteReady}</Text>
            <Text style={styles.url} selectable numberOfLines={2}>
              {made}
            </Text>
            <Tap style={styles.button} onPress={() => void send(made)} accessibilityRole="button">
              <Ionicons name={Platform.OS === "web" ? "copy-outline" : "share-outline"} size={16} color={colors.onPrimary} />
              <Text style={styles.buttonText}>{Platform.OS === "web" ? s.copy : s.share}</Text>
            </Tap>
          </View>
        )}
      </Reveal>
      {notice && <Text style={styles.small}>✓ {notice}</Text>}

      {!making && (
        <Tap style={styles.addButton} onPress={() => (setMaking(true), setMade(null))} accessibilityRole="button">
          <SwapIcon id="add">
            <Icon name="invite" size={18} color={colors.primary} />
          </SwapIcon>
          <Text style={styles.link}>{s.circleInvite}</Text>
        </Tap>
      )}
      <Reveal open={making} style={styles.card}>
        <TextInput
          style={styles.input}
          placeholder={s.circleLabelPlaceholder}
          placeholderTextColor={colors.muted}
          value={label}
          onChangeText={setLabel}
          maxLength={60}
        />
        <Text style={styles.label}>{s.circleAlertsLabel}</Text>
        <AlertSwitches value={alerts} onChange={setNewAlerts} s={s} />
        <View style={styles.inline}>
          <Tap style={styles.button} onPress={() => void create()} accessibilityRole="button">
            <Text style={styles.buttonText}>{s.circleCreate}</Text>
          </Tap>
          <Tap onPress={() => setMaking(false)} accessibilityRole="button">
            <Text style={styles.link}>{s.cancel}</Text>
          </Tap>
        </View>
      </Reveal>
      {error && <Text style={styles.error}>{error}</Text>}
    </View>
  );
}

const styles = themed(() => ({
  flex: { flex: 1, minWidth: 0 },
  scroll: { flex: 1 },
  panel: { padding: 16, gap: 16, width: "100%", maxWidth: 792, alignSelf: "center", paddingBottom: 40 },
  section: { gap: 10 },
  heading: { ...ui.section },
  title: { fontSize: 22, fontWeight: "700", color: colors.text },
  card: { ...ui.card, padding: 14, gap: 8 },
  warnCard: { backgroundColor: colors.warningSoft, borderColor: colors.warningSoft },
  pending: { borderStyle: "dashed", borderColor: colors.inputBorder },
  cardTitle: { fontSize: 16, fontWeight: "700", color: colors.text },
  inline: { flexDirection: "row", alignItems: "center", gap: 10, flexWrap: "wrap" },
  personRow: { ...ui.card, flexDirection: "row", alignItems: "center", gap: 12, padding: 12, minHeight: TOUCH + 12 },
  avatar: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  avatarText: { fontSize: 17, fontWeight: "700" },
  name: { fontSize: 16, fontWeight: "600", color: colors.text },
  body: { fontSize: 15, lineHeight: 21, color: colors.text },
  muted: { fontSize: 14, lineHeight: 20, color: colors.muted },
  small: { fontSize: 13, lineHeight: 18, color: colors.muted },
  label: { fontSize: 14, fontWeight: "600", color: colors.text },
  link: { fontSize: 15, fontWeight: "600", color: colors.primary },
  danger: { color: colors.danger },
  error: { fontSize: 14, color: colors.danger },
  back: { flexDirection: "row", alignItems: "center", gap: 2, minHeight: TOUCH },
  doseRow: { flexDirection: "row", alignItems: "center", gap: 10, minHeight: 36 },
  pill: { borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 3 },
  pillText: { fontSize: 13, fontWeight: "600" },
  switches: { gap: 2 },
  switchRow: { flexDirection: "row", alignItems: "center", gap: 10, minHeight: TOUCH },
  confirm: { gap: 8, paddingTop: 4 },
  made: { backgroundColor: colors.primarySoft, borderRadius: radius.md, padding: 12, gap: 8 },
  url: { fontSize: 13, color: colors.text },
  input: { color: colors.text, borderWidth: 1, borderColor: colors.inputBorder, backgroundColor: colors.surface, borderRadius: radius.sm, paddingHorizontal: 10, paddingVertical: 10, fontSize: 15 },
  button: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, backgroundColor: colors.primary, borderRadius: radius.md, paddingHorizontal: 14, minHeight: TOUCH },
  buttonText: { color: colors.onPrimary, fontSize: 15, fontWeight: "600" },
  dangerButton: { backgroundColor: colors.danger },
  dangerButtonText: { color: colors.onDanger, fontSize: 15, fontWeight: "600" },
  callButton: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: colors.primary, borderRadius: radius.pill, paddingHorizontal: 14, minHeight: 40 },
  addButton: { ...ui.addButton },
}));

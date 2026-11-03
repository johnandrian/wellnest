// Emergency action plan (convex/emergency.ts) in the Care tab: write your steps (templates to start from), contacts
// and asthma action plan; show it full screen with call buttons; share it with carers through a private link.
import { useState } from "react";
import { Linking, Modal, Platform, ScrollView, Text, TextInput, View } from "react-native";
import { Tap } from "./Tap";
import { useMutation, useQuery } from "convex/react";
import { Ionicons } from "@expo/vector-icons";
import { api } from "../convex/_generated/api";
import { colors, ui, TOUCH, themed } from "./theme";
import type { Strings } from "./i18n";
import { shareUrl } from "./ShareCard";

type Section = { title: string; steps: string[] };
type Contact = { name: string; relation?: string; phone: string };
type Asthma = { preventer?: string; reliever?: string; green?: string; yellow?: string; red?: string; best?: number };

const tel = (phone: string) => `tel:${phone.replace(/[^\d+]/g, "")}`;
const cleanError = (e: unknown) => (e as Error).message.replace(/^.*Uncaught Error: /, "").split("\n")[0];

function PlanView({ sections, contacts, asthma, notes, s, big = false }: { sections: Section[]; contacts: Contact[]; asthma?: Asthma; notes?: string; s: Strings; big?: boolean }) {
  return (
    <View style={styles.view}>
      {sections.map((sec, i) => (
        <View key={i} style={styles.block}>
          <Text style={[styles.secTitle, big && styles.bigTitle]}>{sec.title}</Text>
          {sec.steps.map((step, j) => (
            <Text key={j} style={[styles.step, big && styles.bigStep]}>
              {j + 1}. {step}
            </Text>
          ))}
        </View>
      ))}
      {asthma && Object.values(asthma).some(Boolean) && (
        <View style={styles.block}>
          <Text style={[styles.secTitle, big && styles.bigTitle]}>{s.emAsthmaPlan}</Text>
          {asthma.preventer && <Text style={[styles.step, big && styles.bigStep]}>{s.emPreventer}: {asthma.preventer}</Text>}
          {asthma.reliever && <Text style={[styles.step, big && styles.bigStep]}>{s.emReliever}: {asthma.reliever}</Text>}
          {asthma.green && <Text style={[styles.zone, styles.green, big && styles.bigStep]}>{s.emGreen}: {asthma.green}</Text>}
          {asthma.yellow && <Text style={[styles.zone, styles.amber, big && styles.bigStep]}>{s.emYellow}: {asthma.yellow}</Text>}
          {asthma.red && <Text style={[styles.zone, styles.red, big && styles.bigStep]}>{s.emRed}: {asthma.red}</Text>}
          {asthma.best && <Text style={styles.small}>{s.trkBest}: {asthma.best}</Text>}
        </View>
      )}
      {contacts.map((c, i) => (
        <Tap key={i} style={styles.contact} onPress={() => void Linking.openURL(tel(c.phone))} accessibilityRole="button" accessibilityLabel={`${s.careCall} ${c.name}`}>
          <Ionicons name="call" size={big ? 22 : 18} color={colors.primary} />
          <Text style={[styles.contactText, big && styles.bigStep]}>
            {c.name}
            {c.relation ? ` (${c.relation})` : ""} · {c.phone}
          </Text>
        </Tap>
      ))}
      {notes && <Text style={styles.small}>{notes}</Text>}
    </View>
  );
}

export function EmergencyCard({ s }: { s: Strings }) {
  const plan = useQuery(api.emergency.get);
  const save = useMutation(api.emergency.save);
  const createLink = useMutation(api.share.create);
  const [editing, setEditing] = useState(false);
  const [full, setFull] = useState(false);
  const [sections, setSections] = useState<Section[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [asthma, setAsthma] = useState<Asthma | null>(null);
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const templates: Section[] = [
    { title: s.tplSeizureTitle, steps: s.tplSeizureSteps.split("\n") },
    { title: s.tplAsthmaTitle, steps: s.tplAsthmaSteps.split("\n") },
    { title: s.tplFlareTitle, steps: s.tplFlareSteps.split("\n") },
  ];

  const startEdit = () => {
    if (plan?.exists) {
      setSections(plan.sections);
      setContacts(plan.contacts);
      setAsthma(plan.asthma ?? null);
      setNotes(plan.notes ?? "");
    } else {
      setSections([]);
      setContacts([]);
      setAsthma(null);
      setNotes("");
    }
    setEditing(true);
  };

  const submit = async () => {
    setError(null);
    try {
      await save({ sections, contacts, notes: notes || undefined, ...(asthma && { asthma }) });
      setEditing(false);
    } catch (e) {
      setError(cleanError(e));
    }
  };

  const shareWithCarers = async () => {
    setError(null);
    try {
      const { url } = await createLink({ label: s.emShareLabel, sections: ["emergency"], rangeDays: 1, expiresInDays: null });
      if ((await shareUrl(url, s.emTitle)) === "copied") {
        setNotice(s.emLinkCopied);
        setTimeout(() => setNotice(null), 3000);
      }
    } catch (e) {
      setError(cleanError(e));
    }
  };

  if (plan === undefined || plan === null) return null;

  return (
    <View style={styles.card}>
      <View style={styles.inline}>
        <Ionicons name="alert-circle-outline" size={20} color={colors.danger} />
        <Text style={styles.title}>{s.emTitle}</Text>
      </View>

      {editing ? (
        <View style={styles.form}>
          <Text style={styles.note}>{s.emEditIntro}</Text>
          {sections.map((sec, i) => (
            <View key={i} style={styles.editBlock}>
              <View style={styles.inline}>
                <TextInput style={[styles.input, styles.flex]} value={sec.title} onChangeText={(title) => setSections(sections.map((x, j) => (j === i ? { ...x, title } : x)))} placeholder={s.emSectionTitle} placeholderTextColor={colors.muted} />
                <Tap onPress={() => setSections(sections.filter((_, j) => j !== i))} accessibilityRole="button" accessibilityLabel={s.remove}>
                  <Ionicons name="trash-outline" size={18} color={colors.danger} />
                </Tap>
              </View>
              <TextInput
                style={[styles.input, styles.multi]}
                value={sec.steps.join("\n")}
                onChangeText={(t) => setSections(sections.map((x, j) => (j === i ? { ...x, steps: t.split("\n") } : x)))}
                placeholder={s.emStepsPlaceholder}
                placeholderTextColor={colors.muted}
                multiline
              />
            </View>
          ))}
          <View style={styles.chips}>
            {templates.map((tpl) => (
              <Tap key={tpl.title} style={styles.chip} onPress={() => setSections([...sections, tpl])} accessibilityRole="button">
                <Text style={styles.chipText}>+ {tpl.title}</Text>
              </Tap>
            ))}
            <Tap style={styles.chip} onPress={() => setSections([...sections, { title: "", steps: [] }])} accessibilityRole="button">
              <Text style={styles.chipText}>+ {s.emBlank}</Text>
            </Tap>
          </View>
          <Text style={styles.small}>{s.emTemplateNote}</Text>

          <Text style={styles.label}>{s.emContacts}</Text>
          {contacts.map((c, i) => (
            <View key={i} style={styles.inline}>
              <TextInput style={[styles.input, styles.flex]} value={c.name} onChangeText={(name) => setContacts(contacts.map((x, j) => (j === i ? { ...x, name } : x)))} placeholder={s.careTeam_name} placeholderTextColor={colors.muted} />
              <TextInput style={[styles.input, styles.rel]} value={c.relation ?? ""} onChangeText={(relation) => setContacts(contacts.map((x, j) => (j === i ? { ...x, relation } : x)))} placeholder={s.emRelation} placeholderTextColor={colors.muted} />
              <TextInput style={[styles.input, styles.phone]} value={c.phone} onChangeText={(phone) => setContacts(contacts.map((x, j) => (j === i ? { ...x, phone } : x)))} placeholder={s.careTeam_phone} placeholderTextColor={colors.muted} keyboardType="phone-pad" />
              <Tap onPress={() => setContacts(contacts.filter((_, j) => j !== i))} accessibilityRole="button" accessibilityLabel={s.remove}>
                <Ionicons name="close" size={18} color={colors.danger} />
              </Tap>
            </View>
          ))}
          <Tap onPress={() => setContacts([...contacts, { name: "", phone: "" }])} accessibilityRole="button">
            <Text style={styles.link}>+ {s.emAddContact}</Text>
          </Tap>

          {asthma ? (
            <View style={styles.form}>
              <Text style={styles.label}>{s.emAsthmaPlan}</Text>
              {(["preventer", "reliever", "green", "yellow", "red"] as const).map((k) => (
                <TextInput
                  key={k}
                  style={[styles.input, k.length > 6 ? undefined : styles.multi]}
                  value={asthma[k] ?? ""}
                  onChangeText={(t) => setAsthma({ ...asthma, [k]: t })}
                  placeholder={{ preventer: s.emPreventer, reliever: s.emReliever, green: s.emGreen, yellow: s.emYellow, red: s.emRed }[k]}
                  placeholderTextColor={colors.muted}
                  multiline={k === "green" || k === "yellow" || k === "red"}
                />
              ))}
              <Text style={styles.small}>{s.emAsthmaNote}</Text>
            </View>
          ) : (
            <Tap onPress={() => setAsthma({})} accessibilityRole="button">
              <Text style={styles.link}>+ {s.emAddAsthma}</Text>
            </Tap>
          )}
          <TextInput style={[styles.input, styles.multi]} value={notes} onChangeText={setNotes} placeholder={s.emNotes} placeholderTextColor={colors.muted} multiline />
          <View style={styles.inline}>
            <Tap style={styles.button} onPress={() => void submit()} accessibilityRole="button">
              <Text style={styles.buttonText}>{s.save}</Text>
            </Tap>
            <Tap onPress={() => setEditing(false)} accessibilityRole="button">
              <Text style={styles.link}>{s.cancel}</Text>
            </Tap>
          </View>
        </View>
      ) : plan.exists ? (
        <>
          <PlanView sections={plan.sections} contacts={plan.contacts} asthma={plan.asthma} notes={plan.notes} s={s} />
          <View style={styles.inline}>
            <Tap style={[styles.button, styles.redButton]} onPress={() => setFull(true)} accessibilityRole="button">
              <Ionicons name="expand-outline" size={16} color={colors.onPrimary} />
              <Text style={styles.buttonText}>{s.emShowFull}</Text>
            </Tap>
            <Tap onPress={() => void shareWithCarers()} accessibilityRole="button">
              <Text style={styles.link}>{s.emShare}</Text>
            </Tap>
            <Tap onPress={startEdit} accessibilityRole="button">
              <Text style={styles.link}>{s.edit}</Text>
            </Tap>
          </View>
          {notice && <Text style={styles.small}>✓ {notice}</Text>}
        </>
      ) : (
        <>
          <Text style={styles.note}>{s.emIntro}</Text>
          <Tap style={styles.button} onPress={startEdit} accessibilityRole="button">
            <Text style={styles.buttonText}>{s.emCreate}</Text>
          </Tap>
        </>
      )}
      {error && <Text style={styles.error}>{error}</Text>}

      {plan.exists && (
        <Modal visible={full} animationType="slide" onRequestClose={() => setFull(false)}>
          <ScrollView contentContainerStyle={styles.fullScreen}>
            <View style={styles.fullHead}>
              <Text style={styles.fullTitle}>{s.emTitle}</Text>
              <Tap onPress={() => setFull(false)} accessibilityRole="button" accessibilityLabel={s.close}>
                <Ionicons name="close" size={30} color={colors.text} />
              </Tap>
            </View>
            <Tap style={styles.call911} onPress={() => void Linking.openURL(`tel:${s.emergencyNumber}`)} accessibilityRole="button">
              <Ionicons name="call" size={24} color={colors.onPrimary} />
              <Text style={styles.call911Text}>{s.careCall911}</Text>
            </Tap>
            <PlanView sections={plan.sections} contacts={plan.contacts} asthma={plan.asthma} notes={plan.notes} s={s} big />
          </ScrollView>
        </Modal>
      )}
    </View>
  );
}

const styles = themed(() => ({
  card: { ...ui.card, borderColor: colors.dangerBorder, padding: 12, gap: 8 },
  title: { fontSize: 16, fontWeight: "700", color: colors.text },
  note: { color: colors.muted, fontSize: 14, lineHeight: 19 },
  small: { color: colors.muted, fontSize: 12, lineHeight: 17 },
  label: { fontSize: 14, fontWeight: "700", color: colors.text, marginTop: 4 },
  inline: { flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" },
  flex: { flex: 1 },
  form: { gap: 8 },
  editBlock: { gap: 6, borderWidth: 1, borderColor: colors.border, borderRadius: 8, padding: 8 },
  input: { color: colors.text, borderWidth: 1, borderColor: colors.inputBorder, backgroundColor: colors.surface, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8, fontSize: 15, minWidth: 0 },
  multi: { minHeight: 70, textAlignVertical: "top" },
  rel: { width: 90 },
  phone: { width: 130 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  chip: { ...ui.chip },
  chipText: { color: colors.primary, fontSize: 13, fontWeight: "600" },
  view: { gap: 10 },
  block: { gap: 3 },
  secTitle: { fontSize: 15, fontWeight: "700", color: colors.text },
  step: { fontSize: 14, color: colors.text, lineHeight: 20 },
  zone: { fontSize: 14, lineHeight: 20, borderRadius: 6, padding: 6, color: colors.text },
  green: { backgroundColor: colors.successSoft },
  amber: { backgroundColor: colors.warningSoft },
  red: { backgroundColor: colors.dangerSoft },
  contact: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 4 },
  contactText: { fontSize: 15, color: colors.primary, fontWeight: "600", flexShrink: 1 },
  button: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: colors.primary, borderRadius: 10, paddingVertical: 9, paddingHorizontal: 14, alignSelf: "flex-start", minHeight: TOUCH, justifyContent: "center" },
  redButton: { backgroundColor: colors.danger },
  buttonText: { color: colors.onPrimary, fontWeight: "600", fontSize: 14 },
  link: { color: colors.primary, fontWeight: "600", fontSize: 14 },
  error: { color: colors.danger, fontSize: 13 },
  fullScreen: { padding: 20, paddingTop: Platform.OS === "web" ? 20 : 60, gap: 16, maxWidth: 760, width: "100%", alignSelf: "center" },
  fullHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  fullTitle: { fontSize: 26, fontWeight: "800", color: colors.danger },
  call911: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10, backgroundColor: colors.danger, borderRadius: 14, padding: 18 },
  call911Text: { color: colors.onPrimary, fontSize: 20, fontWeight: "800" },
  bigTitle: { fontSize: 20 },
  bigStep: { fontSize: 18, lineHeight: 26 },
}));

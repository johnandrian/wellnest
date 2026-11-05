// The free tools anyone can use without an account, linked from the welcome page:
// - /medication-list: type medicines (name, strength / dose, when and how, notes) and print the list or save a PDF.
//   What's typed stays in this browser (localStorage) and is never sent anywhere.
// - /appointment-checklist: the appointment prep checklist from the Guides tool, ticks kept in this browser.
// Each ends with an invitation to keep it in Wellnest instead. Both follow the welcome page's look (src/design.ts):
// in the soft one, the cards sit in trays, the buttons are pills and the headings are larger.
import { ReactNode, useEffect, useState } from "react";
import { Alert, Image, Platform, ScrollView, Text, TextInput, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Tap } from "./Tap";
import { Icon } from "./Icon";
import { Enter, Reveal } from "./Motion";
import { colors, isSoft, pillish, radius, round, themed, tint, TOUCH, ui } from "./theme";
import type { Strings } from "./i18n";
import { MedRow, medListHtml, printHtml } from "./medList";
import { Checklist } from "./GuidesPanel";
import { Bezel, Eyebrow, font, Pill } from "./soft";

const LIST_KEY = "wellnest.medList";
const CHECK_KEY = "wellnest.checklist";
const EMPTY: MedRow = { name: "", dose: "", when: "", notes: "" };

function load<T>(key: string, fallback: T): T {
  try {
    const raw = typeof localStorage !== "undefined" ? localStorage.getItem(key) : null;
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function save(key: string, value: unknown) {
  try {
    if (typeof localStorage !== "undefined") localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Private browsing or storage turned off: the page still works, it just won't remember.
  }
}

function confirm(text: string, ok: string, cancel: string): Promise<boolean> {
  if (Platform.OS === "web") return Promise.resolve(window.confirm(text));
  return new Promise((resolve) =>
    Alert.alert(text, undefined, [
      { text: cancel, style: "cancel", onPress: () => resolve(false) },
      { text: ok, style: "destructive", onPress: () => resolve(true) },
    ]),
  );
}

function Page({ s, onBack, children }: { s: Strings; onBack: () => void; children: ReactNode }) {
  if (isSoft()) {
    return (
      <ScrollView style={styles.scroll} contentContainerStyle={soft.page} keyboardShouldPersistTaps="handled">
        <Enter style={soft.inner}>
          <View style={soft.nav}>
            <Tap style={soft.back} onPress={onBack} accessibilityRole="button" accessibilityLabel={s.landBack}>
              <Ionicons name="chevron-back" size={20} color={colors.primary} />
              <Image source={require("../assets/wellnest-mark.png")} style={soft.mark} accessibilityIgnoresInvertColors />
              <Text style={soft.brand}>Wellnest</Text>
            </Tap>
          </View>
          <Eyebrow text={s.softToolEyebrow} />
          {children}
        </Enter>
      </ScrollView>
    );
  }
  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
      <Enter style={styles.inner}>
        <Tap style={styles.back} onPress={onBack} accessibilityRole="button" accessibilityLabel={s.landBack}>
          <Ionicons name="chevron-back" size={20} color={colors.primary} />
          <Text style={styles.backText}>Wellnest</Text>
        </Tap>
        {children}
      </Enter>
    </ScrollView>
  );
}

function Cta({ s, text, onCreate }: { s: Strings; text: string; onCreate: () => void }) {
  if (isSoft()) {
    return (
      <Bezel tone="primary" style={soft.ctaShell} core={soft.ctaCore}>
        <Text style={soft.ctaText}>{text}</Text>
        <Pill label={s.landCreate} kind="light" onPress={onCreate} />
      </Bezel>
    );
  }
  return (
    <View style={styles.cta}>
      <Text style={styles.ctaText}>{text}</Text>
      <Tap style={styles.ctaButton} onPress={onCreate} accessibilityRole="button">
        <Text style={styles.ctaButtonText}>{s.landCreate}</Text>
      </Tap>
    </View>
  );
}

// A medicine's card: a plain card, or in the soft look a card in a tray.
function Card({ children }: { children: ReactNode }) {
  if (isSoft()) {
    return (
      <Enter from={10}>
        <Bezel core={soft.cardCore}>{children}</Bezel>
      </Enter>
    );
  }
  return (
    <Enter style={styles.card} from={10}>
      {children}
    </Enter>
  );
}

export function MedListTool({ s, onBack, onCreate }: { s: Strings; onBack: () => void; onCreate: () => void }) {
  const [who, setWho] = useState(() => load(LIST_KEY, { who: "", rows: [EMPTY] }).who);
  const [rows, setRows] = useState<MedRow[]>(() => load(LIST_KEY, { who: "", rows: [EMPTY] }).rows);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => save(LIST_KEY, { who, rows }), [who, rows]);
  const set = (i: number, patch: Partial<MedRow>) => setRows(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const filled = rows.filter((r) => r.name.trim());
  const st = isSoft() ? soft : styles;

  const print = async () => {
    setError(null);
    try {
      await printHtml(medListHtml(filled, s, who), s, s.medList);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <Page s={s} onBack={onBack}>
      <View style={st.titleRow}>
        <View style={[st.titleIcon, { backgroundColor: tint.medications.bg }]}>
          <Icon name="medList" size={24} color={tint.medications.fg} />
        </View>
        <Text style={st.title} accessibilityRole="header">
          {s.mlTitle}
        </Text>
      </View>
      <Text style={st.intro}>{s.mlIntro}</Text>
      <TextInput style={st.input} value={who} onChangeText={setWho} placeholder={s.mlListName} placeholderTextColor={colors.muted} maxLength={80} accessibilityLabel={s.mlListName} />
      {rows.map((r, i) => (
        <Card key={i}>
          <View style={styles.cardHead}>
            <Text style={st.cardTitle}>{s.mlMedicine.replace("{n}", String(i + 1))}</Text>
            {rows.length > 1 && (
              <Tap style={styles.remove} onPress={() => setRows(rows.filter((_, j) => j !== i))} accessibilityRole="button" accessibilityLabel={`${s.remove}: ${r.name || s.mlMedicine.replace("{n}", String(i + 1))}`}>
                <Ionicons name="trash-outline" size={18} color={colors.muted} />
              </Tap>
            )}
          </View>
          <TextInput style={st.input} value={r.name} onChangeText={(name) => set(i, { name })} placeholder={s.mlNamePh} placeholderTextColor={colors.muted} maxLength={80} accessibilityLabel={s.mlNamePh} />
          <TextInput style={st.input} value={r.dose} onChangeText={(dose) => set(i, { dose })} placeholder={s.mlDosePh} placeholderTextColor={colors.muted} maxLength={80} accessibilityLabel={s.mlDosePh} />
          <TextInput style={st.input} value={r.when} onChangeText={(when) => set(i, { when })} placeholder={s.mlWhenPh} placeholderTextColor={colors.muted} maxLength={160} accessibilityLabel={s.mlWhenPh} />
          <TextInput style={[st.input, styles.multi]} value={r.notes} onChangeText={(notes) => set(i, { notes })} placeholder={s.mlNotesPh} placeholderTextColor={colors.muted} maxLength={300} multiline accessibilityLabel={s.mlNotesPh} />
        </Card>
      ))}
      {st === soft ? (
        <View style={styles.buttons}>
          <Pill label={s.mlAdd} kind="quiet" icon="add" onPress={() => setRows([...rows, EMPTY])} disabled={rows.length >= 40} />
          <Pill label={s.mlPrint} icon="print-outline" onPress={() => void print()} disabled={!filled.length} />
          <Tap
            style={styles.clear}
            onPress={async () => {
              if (await confirm(s.mlClearAsk, s.mlClear, s.cancel)) {
                setWho("");
                setRows([EMPTY]);
              }
            }}
            accessibilityRole="button"
          >
            <Text style={[styles.clearText, soft.clearText]}>{s.mlClear}</Text>
          </Tap>
        </View>
      ) : (
      <View style={styles.buttons}>
        <Tap style={ui.addButton} onPress={() => setRows([...rows, EMPTY])} disabled={rows.length >= 40} accessibilityRole="button">
          <Ionicons name="add-circle-outline" size={18} color={colors.primary} />
          <Text style={styles.link}>{s.mlAdd}</Text>
        </Tap>
        <Tap style={[ui.button, styles.print, !filled.length && styles.disabled]} onPress={() => void print()} disabled={!filled.length} accessibilityRole="button">
          <Ionicons name="print-outline" size={18} color={colors.onPrimary} />
          <Text style={styles.printText}>{s.mlPrint}</Text>
        </Tap>
        <Tap
          style={styles.clear}
          onPress={async () => {
            if (await confirm(s.mlClearAsk, s.mlClear, s.cancel)) {
              setWho("");
              setRows([EMPTY]);
            }
          }}
          accessibilityRole="button"
        >
          <Text style={styles.clearText}>{s.mlClear}</Text>
        </Tap>
      </View>
      )}
      <Reveal open={!!error}>
        <Text style={styles.error}>{error}</Text>
      </Reveal>
      <View style={styles.notes}>
        <View style={styles.noteRow}>
          <Ionicons name="lock-closed-outline" size={16} color={colors.muted} />
          <Text style={styles.note}>{s.mlPrivacy}</Text>
        </View>
        <View style={styles.noteRow}>
          <Ionicons name="information-circle-outline" size={16} color={colors.muted} />
          <Text style={styles.note}>{s.mlCheck}</Text>
        </View>
      </View>
      <Cta s={s} text={s.mlCta} onCreate={onCreate} />
    </Page>
  );
}

export function ChecklistPage({ s, onBack, onCreate }: { s: Strings; onBack: () => void; onCreate: () => void }) {
  const [checked, setChecked] = useState<string[]>(() => load(CHECK_KEY, [] as string[]));
  useEffect(() => save(CHECK_KEY, checked), [checked]);
  const st = isSoft() ? soft : styles;
  return (
    <Page s={s} onBack={onBack}>
      <View style={st.titleRow}>
        <View style={[st.titleIcon, { backgroundColor: tint.guides.bg }]}>
          <Icon name="guides" size={24} color={tint.guides.fg} />
        </View>
        <Text style={st.title} accessibilityRole="header">
          {s.clTitle}
        </Text>
      </View>
      <Text style={st.intro}>{s.clIntro}</Text>
      <Checklist s={s} extras={[0, 1, 2]} checked={checked} onToggle={(id, on) => setChecked((c) => (on ? [...c, id] : c.filter((x) => x !== id)))} />
      <Cta s={s} text={s.landHeadline} onCreate={onCreate} />
    </Page>
  );
}

const styles = themed(() => ({
  scroll: { flex: 1, backgroundColor: colors.bg },
  page: { paddingHorizontal: 16, paddingVertical: 24 },
  inner: { width: "100%", maxWidth: 720, alignSelf: "center", gap: 12 },
  back: { flexDirection: "row", alignItems: "center", gap: 2, minHeight: TOUCH, alignSelf: "flex-start" },
  backText: { color: colors.primary, fontSize: 15, fontWeight: "600" },
  titleRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  titleIcon: { width: 48, height: 48, borderRadius: radius.md, alignItems: "center", justifyContent: "center" },
  title: { flex: 1, fontSize: 28, lineHeight: 34, fontWeight: "800", color: colors.text },
  intro: { fontSize: 17, lineHeight: 25, color: colors.text },
  card: { ...ui.card, padding: 14, gap: 8, borderRadius: radius.lg },
  cardHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  cardTitle: { fontSize: 16, fontWeight: "700", color: colors.text },
  remove: { width: TOUCH, height: TOUCH, alignItems: "center", justifyContent: "center" },
  input: { minHeight: TOUCH, borderWidth: 1, borderColor: colors.inputBorder, borderRadius: radius.md, paddingHorizontal: 12, fontSize: 16, color: colors.text, backgroundColor: colors.surface },
  multi: { minHeight: 72, paddingVertical: 10, textAlignVertical: "top" },
  buttons: { flexDirection: "row", flexWrap: "wrap", gap: 10, alignItems: "center" },
  print: { flexDirection: "row", gap: 8 },
  printText: { color: colors.onPrimary, fontSize: 15, fontWeight: "700" },
  disabled: { opacity: 0.5 },
  clear: { minHeight: TOUCH, justifyContent: "center", paddingHorizontal: 8 },
  clearText: { color: colors.danger, fontSize: 15, fontWeight: "600" },
  link: { color: colors.primary, fontWeight: "600", fontSize: 15 },
  error: { color: colors.danger, fontSize: 14 },
  notes: { gap: 6 },
  noteRow: { flexDirection: "row", gap: 8, alignItems: "flex-start" },
  note: { flex: 1, fontSize: 14, lineHeight: 20, color: colors.muted },
  cta: { backgroundColor: colors.primary, borderRadius: radius.lg, padding: 20, gap: 12, marginTop: 8 },
  ctaText: { fontSize: 16, lineHeight: 24, color: colors.onPrimary, fontWeight: "600" },
  ctaButton: { alignSelf: "flex-start", minHeight: 48, paddingHorizontal: 20, justifyContent: "center", borderRadius: pillish(radius.md), backgroundColor: colors.surface },
  ctaButtonText: { color: colors.primary, fontSize: 16, fontWeight: "700" },
}));

// The soft look: the same page with roomier type, tray cards and pill buttons.
const soft = themed(() => ({
  page: { paddingHorizontal: 16, paddingTop: 16, paddingBottom: 56 },
  inner: { width: "100%", maxWidth: 760, alignSelf: "center", gap: 18 },
  nav: { flexDirection: "row", alignSelf: "flex-start", paddingRight: 18, paddingLeft: 6, paddingVertical: 4, marginBottom: 20, borderRadius: 999, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.hairline },
  back: { flexDirection: "row", alignItems: "center", gap: 6, minHeight: TOUCH, paddingLeft: 6 },
  mark: { width: 26, height: 26 },
  brand: { ...font.heavy, fontSize: 17, letterSpacing: -0.3, color: colors.text },
  titleRow: { flexDirection: "row", alignItems: "center", gap: 16 },
  titleIcon: { width: 56, height: 56, borderRadius: round(18), alignItems: "center", justifyContent: "center" },
  title: { ...font.heavy, flex: 1, fontSize: 36, lineHeight: 42, letterSpacing: -1.1, color: colors.text },
  intro: { ...font.regular, fontSize: 18, lineHeight: 28, color: colors.muted, marginBottom: 8 },
  cardCore: { padding: 20, gap: 10 },
  cardTitle: { ...font.bold, fontSize: 17, color: colors.text },
  input: { ...font.regular, minHeight: 50, borderWidth: 1, borderColor: colors.inputBorder, borderRadius: round(16), paddingHorizontal: 16, fontSize: 16, color: colors.text, backgroundColor: colors.surface },
  clearText: { ...font.semibold },
  ctaShell: { marginTop: 24 },
  ctaCore: { padding: 28, gap: 18 },
  ctaText: { ...font.bold, fontSize: 20, lineHeight: 28, letterSpacing: -0.3, color: colors.onPrimary },
}));

// What people see before they sign in: a welcome page that leads with the tracker (log in a tap, see trends and
// patterns, with an example story in src/LandingStory.tsx), then medications, visit prep, the Care Circle and talking or typing, how it
// works, the free tools (/medication-list, /appointment-checklist) and how data stays theirs, then sign-in or a new
// account. In the phone's or browser's language, with a switch at the bottom. Someone who came from a Care Circle
// invite sees whose it is first.
import { useMemo, useState } from "react";
import { ScrollView, Text, useWindowDimensions, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useQuery } from "convex/react";
import { api } from "../convex/_generated/api";
import { Tap } from "./Tap";
import { Icon } from "./Icon";
import { Enter } from "./Motion";
import { SingingBrand, SingingMark } from "./SingingMark";
import { BreathingGrid } from "./BreathingGrid";
import { SignIn } from "./SignIn";
import { pendingInvite } from "./invite";
import { colors, isSoft, radius, tint, TOUCH, ui, themed } from "./theme";
import { LANGUAGE_NAMES, Lang, Strings, strings } from "./i18n";
import { SoftLanding } from "./WelcomeSoft";
import { FEATURES, TOOLS } from "./landing";
import { LandingStory } from "./LandingStory";

const LANG_KEY = "wellnest.lang";

// The language before there's an account: the one picked here last time, else the browser's or phone's.
export function deviceLang(): Lang {
  try {
    const saved = typeof localStorage !== "undefined" ? localStorage.getItem(LANG_KEY) : null;
    if (saved === "en" || saved === "es" || saved === "el" || saved === "zh") return saved;
  } catch {
    // Storage blocked: fall through to the device language.
  }
  const locale = (Intl.DateTimeFormat().resolvedOptions().locale || "en").toLowerCase();
  return locale.startsWith("es") ? "es" : locale.startsWith("el") ? "el" : locale.startsWith("zh") ? "zh" : "en";
}

function saveLang(lang: Lang) {
  try {
    if (typeof localStorage !== "undefined") localStorage.setItem(LANG_KEY, lang);
  } catch {
    // Only a convenience.
  }
}

export function Welcome({ onOpen, initialAuth = null }: { onOpen: (path: string) => void; initialAuth?: "signIn" | "signUp" | null }) {
  const [lang, setLang] = useState<Lang>(deviceLang);
  const [auth, setAuth] = useState<"signIn" | "signUp" | null>(initialAuth);
  const s = strings(lang);
  const pick = (l: Lang) => {
    setLang(l);
    saveLang(l);
  };
  if (auth) return <SignIn key={auth} s={s} initialFlow={auth} onBack={() => setAuth(null)} />;
  // The soft or the classic look (src/design.ts): same words and links, different layout.
  const Page = isSoft() ? SoftLanding : Landing;
  return <Page s={s} lang={lang} onLang={pick} onAuth={setAuth} onOpen={onOpen} />;
}

function Landing({ s, lang, onLang, onAuth, onOpen }: { s: Strings; lang: Lang; onLang: (l: Lang) => void; onAuth: (flow: "signIn" | "signUp") => void; onOpen: (path: string) => void }) {
  const { width } = useWindowDimensions();
  const wide = width >= 760;
  const token = useMemo(() => pendingInvite(), []);
  const now = useMemo(() => Date.now(), []);
  const invite = useQuery(api.circle.inviteInfo, token ? { token, now } : "skip");

  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.page}>
      <BreathingGrid height={wide ? 820 : 700} lane={wide ? [72, 110] : undefined} />
      <View style={styles.inner}>
        <View style={styles.topBar}>
          <View style={styles.brand}>
            <SingingBrand style={styles.singer}>
              <SingingMark size={32} />
              <Text style={styles.brandText}>Wellnest</Text>
            </SingingBrand>
          </View>
          <Tap style={styles.topSignIn} onPress={() => onAuth("signIn")} accessibilityRole="button">
            <Text style={styles.topSignInText}>{s.landSignIn}</Text>
          </Tap>
        </View>

        <Enter style={[styles.hero, wide && styles.heroWide]}>
          <View style={[styles.heroText, wide && styles.flex]}>
            {invite && !invite.own && (
              <View style={styles.invite}>
                <Icon name="circle" size={20} color={tint.circle.fg} />
                <Text style={styles.inviteText}>{s.landInvite.replace("{name}", invite.name)}</Text>
              </View>
            )}
            <Text style={[styles.headline, wide && styles.headlineWide]} accessibilityRole="header">
              {s.landHeadline}
            </Text>
            <Text style={styles.sub}>{s.landSub}</Text>
            <View style={styles.ctas}>
              <Tap style={styles.primary} onPress={() => onAuth("signUp")} accessibilityRole="button">
                <Text style={styles.primaryText}>{s.landCreate}</Text>
              </Tap>
              <Tap style={styles.secondary} onPress={() => onAuth("signIn")} accessibilityRole="button">
                <Text style={styles.secondaryText}>{s.landSignIn}</Text>
              </Tap>
            </View>
            <Tap style={styles.demo} onPress={() => onOpen("/demo")} accessibilityRole="link">
              <Icon name="dashboard" size={18} color={colors.primary} />
              <Text style={styles.demoText}>{s.landDemo}</Text>
              <Ionicons name="arrow-forward" size={16} color={colors.primary} />
            </Tap>
          </View>
          <View style={wide ? styles.previewWide : undefined}>
            <LandingStory s={s} />
          </View>
        </Enter>

        <Enter style={styles.grid} from={24}>
          {s.landFeatures.map((f, i) => (
            <View key={f.title} style={[styles.feature, wide ? styles.third : styles.full]}>
              <View style={[styles.featureIcon, { backgroundColor: tint[FEATURES[i].tint].bg }]}>
                <Icon name={FEATURES[i].icon} size={22} color={tint[FEATURES[i].tint].fg} />
              </View>
              <Text style={styles.featureTitle}>{f.title}</Text>
              <Text style={styles.featureBody}>{f.body}</Text>
            </View>
          ))}
        </Enter>

        <Enter style={styles.block} from={32}>
          <Text style={styles.sectionTitle} accessibilityRole="header">
            {s.landHowTitle}
          </Text>
          <View style={[styles.steps, wide && styles.stepsWide]}>
            {s.landHow.map((step, i) => (
              <View key={step} style={[styles.step, wide && styles.flex]}>
                <View style={styles.stepNumber}>
                  <Text style={styles.stepNumberText}>{i + 1}</Text>
                </View>
                <Text style={[styles.stepText, styles.flex]}>{step}</Text>
              </View>
            ))}
          </View>
        </Enter>

        <Enter style={styles.block} from={32}>
          <Text style={styles.sectionTitle} accessibilityRole="header">
            {s.landToolsTitle}
          </Text>
          <Text style={styles.sectionSub}>{s.landToolsSub}</Text>
          <View style={[styles.steps, wide && styles.stepsWide]}>
            {s.landTools.map((t, i) => (
              <Tap key={t.title} style={[styles.tool, wide && styles.flex]} onPress={() => onOpen(TOOLS[i].path)} accessibilityRole="link">
                <View style={[styles.featureIcon, { backgroundColor: tint[TOOLS[i].tint].bg }]}>
                  <Icon name={TOOLS[i].icon} size={22} color={tint[TOOLS[i].tint].fg} />
                </View>
                <View style={styles.flex}>
                  <Text style={styles.featureTitle}>{t.title}</Text>
                  <Text style={styles.featureBody}>{t.body}</Text>
                </View>
                <Ionicons name="chevron-forward" size={20} color={colors.primary} />
              </Tap>
            ))}
          </View>
        </Enter>

        <Enter style={styles.trust} from={32}>
          <Text style={styles.trustTitle} accessibilityRole="header">
            {s.landTrustTitle}
          </Text>
          <Text style={styles.trustBody}>{s.landTrust}</Text>
          <Text style={styles.notDoctor}>{s.landNotDoctor}</Text>
          <Tap style={styles.primaryOnTeal} onPress={() => onAuth("signUp")} accessibilityRole="button">
            <Text style={styles.primaryOnTealText}>{s.landCreate}</Text>
          </Tap>
        </Enter>

        <View style={styles.footer}>
          <View style={styles.langs} accessibilityRole="radiogroup" accessibilityLabel={s.landLanguage}>
            {(Object.keys(LANGUAGE_NAMES) as Lang[]).map((code) => (
              <Tap
                key={code}
                style={[styles.langChip, lang === code && styles.langChipOn]}
                onPress={() => onLang(code)}
                accessibilityRole="radio"
                accessibilityState={{ selected: lang === code }}
              >
                <Text style={[styles.langText, lang === code && styles.langTextOn]}>{LANGUAGE_NAMES[code]}</Text>
              </Tap>
            ))}
          </View>
          <View style={styles.footerRow}>
            <Tap onPress={() => onOpen("/privacy")} accessibilityRole="link">
              <Text style={styles.footerLink}>{s.landPrivacy}</Text>
            </Tap>
            {s.landTools.map((t, i) => (
              <Tap key={t.title} onPress={() => onOpen(TOOLS[i].path)} accessibilityRole="link">
                <Text style={styles.footerLink}>{t.title}</Text>
              </Tap>
            ))}
            <Text style={styles.footerText}>© {new Date().getFullYear()} Wellnest</Text>
          </View>
        </View>
      </View>
    </ScrollView>
  );
}

const styles = themed(() => ({
  flex: { flex: 1, minWidth: 0 },
  scroll: { flex: 1, backgroundColor: colors.bg },
  page: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 32 },
  inner: { width: "100%", maxWidth: 1040, alignSelf: "center", gap: 28 },
  topBar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", minHeight: 56 },
  brand: { flexDirection: "row", alignItems: "center", gap: 8 },
  singer: { flexDirection: "row", alignItems: "center", gap: 8 },
  mark: { width: 32, height: 32 },
  brandText: { fontSize: 20, fontWeight: "800", color: colors.text },
  topSignIn: { minHeight: TOUCH, paddingHorizontal: 16, justifyContent: "center", borderRadius: radius.pill, borderWidth: 1, borderColor: colors.inputBorder, backgroundColor: colors.surface },
  topSignInText: { fontSize: 15, fontWeight: "600", color: colors.primary },

  hero: { gap: 20, alignItems: "stretch" },
  heroWide: { flexDirection: "row", alignItems: "center", gap: 40, paddingVertical: 24 },
  heroText: { gap: 14 },
  invite: { flexDirection: "row", alignItems: "center", gap: 10, padding: 12, borderRadius: radius.md, backgroundColor: tint.circle.bg },
  inviteText: { flex: 1, fontSize: 15, lineHeight: 21, fontWeight: "600", color: colors.text },
  headline: { fontSize: 34, lineHeight: 40, fontWeight: "800", color: colors.text, letterSpacing: -0.5 },
  headlineWide: { fontSize: 48, lineHeight: 54 },
  sub: { fontSize: 18, lineHeight: 27, color: colors.muted },
  ctas: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginTop: 6 },
  primary: { ...ui.button, paddingHorizontal: 22, minHeight: 50 },
  primaryText: { color: colors.onPrimary, fontSize: 16, fontWeight: "700" },
  secondary: { minHeight: 50, paddingHorizontal: 22, justifyContent: "center", alignItems: "center", borderRadius: radius.md, borderWidth: 1, borderColor: colors.inputBorder, backgroundColor: colors.surface },
  secondaryText: { color: colors.text, fontSize: 16, fontWeight: "600" },
  demo: { flexDirection: "row", alignItems: "center", alignSelf: "flex-start", gap: 8, minHeight: TOUCH, marginTop: 4, paddingHorizontal: 4 },
  demoText: { color: colors.primary, fontSize: 16, fontWeight: "700", textDecorationLine: "underline" },
  previewWide: { width: 500 },
  sectionSub: { fontSize: 15, color: colors.muted, marginTop: -8 },
  tool: { ...ui.card, flexDirection: "row", alignItems: "center", gap: 14, padding: 16, borderRadius: radius.lg },

  grid: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
  feature: { ...ui.card, padding: 18, gap: 8, borderRadius: radius.lg },
  full: { width: "100%" },
  third: { width: "31.8%", flexGrow: 1 },
  featureIcon: { width: 44, height: 44, borderRadius: radius.md, alignItems: "center", justifyContent: "center", marginBottom: 4 },
  featureTitle: { fontSize: 17, fontWeight: "700", color: colors.text },
  featureBody: { fontSize: 15, lineHeight: 22, color: colors.muted },

  block: { gap: 14 },
  sectionTitle: { fontSize: 24, fontWeight: "800", color: colors.text },
  steps: { gap: 10 },
  stepsWide: { flexDirection: "row", gap: 14 },
  step: { flexDirection: "row", alignItems: "flex-start", gap: 12, ...ui.card, padding: 16, borderRadius: radius.lg },
  stepNumber: { width: 32, height: 32, borderRadius: 16, backgroundColor: colors.primarySoft, alignItems: "center", justifyContent: "center" },
  stepNumberText: { fontSize: 15, fontWeight: "800", color: colors.primary },
  stepText: { fontSize: 15, lineHeight: 22, color: colors.text },

  trust: { backgroundColor: colors.primary, borderRadius: radius.lg, padding: 24, gap: 10 },
  trustTitle: { fontSize: 24, fontWeight: "800", color: colors.onPrimary },
  trustBody: { fontSize: 16, lineHeight: 24, color: colors.onPrimary },
  notDoctor: { fontSize: 14, lineHeight: 20, color: colors.onPrimary, opacity: 0.9 },
  primaryOnTeal: { alignSelf: "flex-start", minHeight: 50, paddingHorizontal: 22, justifyContent: "center", borderRadius: radius.md, backgroundColor: colors.surface, marginTop: 6 },
  primaryOnTealText: { color: colors.primary, fontSize: 16, fontWeight: "700" },

  footer: { gap: 14, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 20 },
  langs: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  langChip: { ...ui.chip },
  langChipOn: { ...ui.chipOn },
  langText: { fontSize: 14, color: colors.text },
  langTextOn: { color: colors.primary, fontWeight: "700" },
  footerRow: { flexDirection: "row", alignItems: "center", gap: 16, flexWrap: "wrap" },
  footerLink: { fontSize: 15, fontWeight: "600", color: colors.primary, minHeight: TOUCH, textAlignVertical: "center", paddingVertical: 12 },
  footerText: { fontSize: 14, color: colors.muted },
}));

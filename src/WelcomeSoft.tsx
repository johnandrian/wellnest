// The welcome page in the soft design (src/design.ts picks it): the same words, links and invite banner as the
// classic page in src/Welcome.tsx, laid out with more room. A floating pill bar at the top; a large headline beside
// the preview of a week; the six features as a grid of cards in two sizes; how it works; the free tools; the privacy
// promise on teal; then the language switch and links. Each section fades up as it scrolls into view.
import { useMemo } from "react";
import { Image, Pressable, ScrollView, Text, useWindowDimensions, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useQuery } from "convex/react";
import { api } from "../convex/_generated/api";
import { Tap } from "./Tap";
import { Icon } from "./Icon";
import { Enter, Rise } from "./Motion";
import { pendingInvite } from "./invite";
import { colors, tint, TOUCH, themed } from "./theme";
import { LANGUAGE_NAMES, Lang, Strings } from "./i18n";
import { FEATURES, PREVIEW, TOOLS } from "./landing";
import { Bezel, Eyebrow, font, Pill, settle } from "./soft";

type Props = { s: Strings; lang: Lang; onLang: (l: Lang) => void; onAuth: (flow: "signIn" | "signUp") => void; onOpen: (path: string) => void };

// A week of pain and sleep as rounded bars, and the pattern Wellnest found in it.
function Preview({ s }: { s: Strings }) {
  const rows = [
    { label: s.landPreviewPain, values: PREVIEW.pain, max: 10, color: tint.care.fg, icon: "pain" as const },
    { label: s.landPreviewSleep, values: PREVIEW.sleep, max: 9, color: tint.journal.fg, icon: "sleep" as const },
  ];
  return (
    <Bezel core={styles.previewCore}>
      <View accessible accessibilityLabel={`${s.landPreviewTitle}. ${s.landPreviewPattern}`} style={styles.previewInner}>
        <Text style={styles.previewTitle}>{s.landPreviewTitle}</Text>
        {rows.map((r) => (
          <View key={r.label} style={styles.previewRow}>
            <View style={styles.previewLabel}>
              <Icon name={r.icon} size={16} color={r.color} />
              <Text style={styles.previewLabelText} numberOfLines={1}>
                {r.label}
              </Text>
            </View>
            <View style={styles.previewBars}>
              {r.values.map((v, i) => (
                <View key={i} style={styles.previewSlot}>
                  <View style={[styles.previewBar, { height: `${(v / r.max) * 100}%`, backgroundColor: r.color }]} />
                </View>
              ))}
            </View>
          </View>
        ))}
        <View style={styles.previewPattern}>
          <View style={styles.previewPatternIcon}>
            <Icon name="insights" size={18} color={colors.primary} />
          </View>
          <Text style={styles.previewPatternText}>{s.landPreviewPattern}</Text>
        </View>
      </View>
    </Bezel>
  );
}

function Feature({ i, title, body, big }: { i: number; title: string; body: string; big?: boolean }) {
  const t = tint[FEATURES[i].tint];
  return (
    <Bezel style={styles.fill} core={styles.featureCore}>
      <View style={[styles.featureIcon, { backgroundColor: t.bg }]}>
        <Icon name={FEATURES[i].icon} size={24} color={t.fg} />
      </View>
      <Text style={[styles.featureTitle, big && styles.featureTitleBig]}>{title}</Text>
      <Text style={styles.featureBody}>{body}</Text>
    </Bezel>
  );
}

export function SoftLanding({ s, lang, onLang, onAuth, onOpen }: Props) {
  const { width } = useWindowDimensions();
  const wide = width >= 768;
  const large = width >= 1080;
  const token = useMemo(() => pendingInvite(), []);
  const now = useMemo(() => Date.now(), []);
  const invite = useQuery(api.circle.inviteInfo, token ? { token, now } : "skip");
  const f = s.landFeatures;

  return (
    <ScrollView style={styles.scroll} contentContainerStyle={[styles.page, wide && styles.pageWide]}>
      <View style={[styles.inner, wide && styles.innerWide]}>
        <Enter style={styles.navWrap} from={-12}>
          <View style={styles.nav}>
            <View style={styles.brand}>
              <Image source={require("../assets/wellnest-mark.png")} style={styles.mark} accessibilityIgnoresInvertColors />
              <Text style={styles.brandText}>Wellnest</Text>
            </View>
            {wide && (
              <Tap style={styles.navLink} onPress={() => onOpen("/demo")} accessibilityRole="link">
                <Text style={styles.navLinkText}>{s.landDemo}</Text>
              </Tap>
            )}
            <Tap style={styles.navSignIn} onPress={() => onAuth("signIn")} accessibilityRole="button">
              <Text style={styles.navSignInText}>{s.landSignIn}</Text>
            </Tap>
          </View>
        </Enter>

        <View style={[styles.hero, wide && styles.heroWide]}>
          <Enter style={[styles.heroText, wide && styles.heroTextWide]} from={28}>
            {invite && !invite.own && (
              <View style={styles.invite}>
                <Icon name="circle" size={20} color={tint.circle.fg} />
                <Text style={styles.inviteText}>{s.landInvite.replace("{name}", invite.name)}</Text>
              </View>
            )}
            <Eyebrow text={s.softEyebrow} />
            <Text style={[styles.headline, wide && styles.headlineWide, large && styles.headlineLarge]} accessibilityRole="header">
              {s.landHeadline}
            </Text>
            <Text style={[styles.sub, wide && styles.subWide]}>{s.landSub}</Text>
            <View style={styles.ctas}>
              <Pill label={s.landCreate} onPress={() => onAuth("signUp")} />
              <Pill label={s.landDemo} kind="quiet" icon="grid-outline" role="link" onPress={() => onOpen("/demo")} />
            </View>
          </Enter>
          <Rise style={wide ? styles.previewWide : undefined} delay={120} from={56}>
            <Preview s={s} />
          </Rise>
        </View>

        <View style={styles.section}>
          <Rise style={styles.heading}>
            <Eyebrow text={s.softFeaturesEyebrow} />
            <Text style={[styles.sectionTitle, wide && styles.sectionTitleWide]} accessibilityRole="header">
              {s.softFeaturesTitle}
            </Text>
          </Rise>
          {/* Two big cards, three small ones, then one across the width; a single column on a phone. */}
          <View style={styles.bento}>
            <View style={[styles.bentoRow, wide && styles.row]}>
              <Rise style={wide ? styles.span7 : undefined}>
                <Feature i={0} title={f[0].title} body={f[0].body} big />
              </Rise>
              <Rise style={wide ? styles.span5 : undefined} delay={wide ? 100 : 0}>
                <Feature i={1} title={f[1].title} body={f[1].body} big />
              </Rise>
            </View>
            <View style={[styles.bentoRow, wide && styles.row]}>
              {[2, 3, 4].map((i, k) => (
                <Rise key={i} style={wide ? styles.span4 : undefined} delay={wide ? k * 100 : 0}>
                  <Feature i={i} title={f[i].title} body={f[i].body} />
                </Rise>
              ))}
            </View>
            <Rise>
              <Bezel core={[styles.featureCore, wide && styles.featureWideCore]}>
                <View style={[styles.featureIcon, { backgroundColor: tint[FEATURES[5].tint].bg }]}>
                  <Icon name={FEATURES[5].icon} size={24} color={tint[FEATURES[5].tint].fg} />
                </View>
                <View style={[styles.featureWideText, wide && styles.flex]}>
                  <Text style={styles.featureTitle}>{f[5].title}</Text>
                  <Text style={styles.featureBody}>{f[5].body}</Text>
                </View>
              </Bezel>
            </Rise>
          </View>
        </View>

        <View style={[styles.section, wide && styles.split]}>
          <Rise style={[styles.heading, wide && styles.splitLeft]}>
            <Eyebrow text={s.softHowEyebrow} />
            <Text style={[styles.sectionTitle, wide && styles.sectionTitleWide]} accessibilityRole="header">
              {s.landHowTitle}
            </Text>
          </Rise>
          <Rise style={wide ? styles.flex : undefined} delay={wide ? 120 : 0}>
            <Bezel core={styles.stepsCore}>
              {s.landHow.map((step, i) => (
                <View key={step} style={[styles.step, i > 0 && styles.stepRule]}>
                  <Text style={styles.stepNumber}>{String(i + 1).padStart(2, "0")}</Text>
                  <Text style={[styles.stepText, styles.flex]}>{step}</Text>
                </View>
              ))}
            </Bezel>
          </Rise>
        </View>

        <View style={styles.section}>
          <Rise style={styles.heading}>
            <Eyebrow text={s.softToolsEyebrow} />
            <Text style={[styles.sectionTitle, wide && styles.sectionTitleWide]} accessibilityRole="header">
              {s.landToolsTitle}
            </Text>
            <Text style={styles.sectionSub}>{s.landToolsSub}</Text>
          </Rise>
          <View style={[styles.bentoRow, wide && styles.row]}>
            {s.landTools.map((t, i) => (
              <Rise key={t.title} style={wide ? styles.flex : undefined} delay={wide ? i * 100 : 0}>
                <Pressable onPress={() => onOpen(TOOLS[i].path)} accessibilityRole="link" style={styles.fill}>
                  {(state) => {
                    const hovered = (state as { hovered?: boolean }).hovered;
                    return (
                      <Bezel style={[styles.fill, styles.lift, hovered && styles.lifted, state.pressed && styles.pressed]} core={[styles.toolCore, !wide && styles.toolCoreNarrow]}>
                        <View style={[styles.featureIcon, { backgroundColor: tint[TOOLS[i].tint].bg }]}>
                          <Icon name={TOOLS[i].icon} size={24} color={tint[TOOLS[i].tint].fg} />
                        </View>
                        <View style={wide ? styles.flex : styles.toolTextNarrow}>
                          <Text style={styles.featureTitle}>{t.title}</Text>
                          <Text style={styles.featureBody}>{t.body}</Text>
                        </View>
                        <View style={[styles.arrow, hovered && styles.arrowHover]}>
                          <Ionicons name="arrow-forward" size={18} color={colors.primary} />
                        </View>
                      </Bezel>
                    );
                  }}
                </Pressable>
              </Rise>
            ))}
          </View>
        </View>

        <Rise style={styles.section}>
          <Bezel tone="primary" core={[styles.trustCore, wide && styles.trustCoreWide]}>
            <Eyebrow text={s.landPrivacy} onPrimary />
            <Text style={[styles.trustTitle, wide && styles.trustTitleWide]} accessibilityRole="header">
              {s.landTrustTitle}
            </Text>
            <Text style={styles.trustBody}>{s.landTrust}</Text>
            <Text style={styles.notDoctor}>{s.landNotDoctor}</Text>
            <Pill label={s.landCreate} kind="light" onPress={() => onAuth("signUp")} style={styles.trustCta} />
          </Bezel>
        </Rise>

        <View style={styles.footer}>
          <View style={styles.brand}>
            <Image source={require("../assets/wellnest-mark.png")} style={styles.mark} accessibilityIgnoresInvertColors />
            <Text style={styles.brandText}>Wellnest</Text>
          </View>
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
            <Tap onPress={() => onOpen("/demo")} accessibilityRole="link">
              <Text style={styles.footerLink}>{s.landDemo}</Text>
            </Tap>
            <Text style={styles.footerText}>© {new Date().getFullYear()} Wellnest</Text>
          </View>
        </View>
      </View>
    </ScrollView>
  );
}

const styles = themed(() => ({
  flex: { flex: 1, minWidth: 0 },
  fill: { flexGrow: 1 },
  row: { flexDirection: "row", alignItems: "stretch" },
  scroll: { flex: 1, backgroundColor: colors.bg },
  page: { paddingHorizontal: 16, paddingTop: 16, paddingBottom: 48 },
  pageWide: { paddingHorizontal: 32, paddingTop: 24, paddingBottom: 64 },
  inner: { width: "100%", maxWidth: 1160, alignSelf: "center", gap: 72 },
  innerWide: { gap: 112 },

  // The floating bar: a pill set off from the top edge, not glued to it.
  navWrap: { alignItems: "center", marginBottom: -32 },
  nav: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    width: "100%",
    maxWidth: 720,
    paddingLeft: 16,
    paddingRight: 6,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.hairline,
  },
  brand: { flexDirection: "row", alignItems: "center", gap: 8, flex: 1 },
  mark: { width: 30, height: 30 },
  brandText: { ...font.heavy, fontSize: 19, letterSpacing: -0.4, color: colors.text },
  navLink: { minHeight: TOUCH, justifyContent: "center", paddingHorizontal: 14 },
  navLinkText: { ...font.semibold, fontSize: 15, color: colors.muted },
  navSignIn: { minHeight: TOUCH, justifyContent: "center", paddingHorizontal: 20, borderRadius: 999, backgroundColor: colors.primarySoft },
  navSignInText: { ...font.bold, fontSize: 15, color: colors.primary },

  hero: { gap: 40 },
  heroWide: { flexDirection: "row", alignItems: "center", gap: 56, minHeight: 560 },
  heroText: { gap: 20 },
  heroTextWide: { flex: 1.15, minWidth: 0, gap: 24 },
  invite: { flexDirection: "row", alignItems: "center", gap: 10, padding: 14, borderRadius: 20, backgroundColor: tint.circle.bg },
  inviteText: { ...font.semibold, flex: 1, fontSize: 15, lineHeight: 21, color: colors.text },
  headline: { ...font.heavy, fontSize: 40, lineHeight: 46, letterSpacing: -1.2, color: colors.text },
  headlineWide: { fontSize: 54, lineHeight: 60, letterSpacing: -1.8 },
  headlineLarge: { fontSize: 66, lineHeight: 72, letterSpacing: -2.2 },
  sub: { ...font.regular, fontSize: 18, lineHeight: 28, color: colors.muted },
  subWide: { fontSize: 19, lineHeight: 30, maxWidth: 560 },
  ctas: { flexDirection: "row", flexWrap: "wrap", gap: 12, marginTop: 8 },
  previewWide: { flex: 1, minWidth: 0, maxWidth: 440 },
  previewCore: { padding: 26 },
  previewInner: { gap: 18 },
  previewTitle: { ...font.bold, fontSize: 16, color: colors.text },
  previewRow: { flexDirection: "row", alignItems: "flex-end", gap: 12 },
  previewLabel: { width: 76, flexDirection: "row", alignItems: "center", gap: 6, paddingBottom: 2 },
  previewLabelText: { ...font.semibold, fontSize: 13, color: colors.muted },
  previewBars: { flex: 1, flexDirection: "row", alignItems: "flex-end", gap: 6, height: 72 },
  previewSlot: { flex: 1, height: "100%", justifyContent: "flex-end" },
  previewBar: { width: "100%", borderRadius: 6 },
  previewPattern: { flexDirection: "row", gap: 12, alignItems: "flex-start", padding: 14, borderRadius: 20, backgroundColor: colors.primarySoft },
  previewPatternIcon: { width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center", backgroundColor: colors.surface },
  previewPatternText: { ...font.medium, flex: 1, fontSize: 14, lineHeight: 21, color: colors.text },

  section: { gap: 32 },
  heading: { gap: 16, maxWidth: 720 },
  sectionTitle: { ...font.heavy, fontSize: 32, lineHeight: 38, letterSpacing: -0.9, color: colors.text },
  sectionTitleWide: { fontSize: 44, lineHeight: 50, letterSpacing: -1.4 },
  sectionSub: { ...font.regular, fontSize: 17, lineHeight: 26, color: colors.muted },

  bento: { gap: 16 },
  bentoRow: { gap: 16 },
  span7: { flex: 7, minWidth: 0 },
  span5: { flex: 5, minWidth: 0 },
  span4: { flex: 1, minWidth: 0 },
  featureCore: { padding: 28, gap: 10 },
  featureWideCore: { flexDirection: "row", alignItems: "center", gap: 24 },
  featureWideText: { gap: 10 },
  featureIcon: { width: 52, height: 52, borderRadius: 18, alignItems: "center", justifyContent: "center", marginBottom: 8 },
  featureTitle: { ...font.bold, fontSize: 19, lineHeight: 25, letterSpacing: -0.3, color: colors.text },
  featureTitleBig: { fontSize: 24, lineHeight: 30, letterSpacing: -0.5 },
  featureBody: { ...font.regular, fontSize: 16, lineHeight: 25, color: colors.muted },

  split: { flexDirection: "row", alignItems: "flex-start", gap: 56 },
  splitLeft: { width: "34%" },
  stepsCore: { paddingVertical: 8, paddingHorizontal: 28 },
  step: { flexDirection: "row", alignItems: "baseline", gap: 20, paddingVertical: 22 },
  stepRule: { borderTopWidth: 1, borderTopColor: colors.hairline },
  stepNumber: { ...font.heavy, fontSize: 28, letterSpacing: -0.8, color: colors.primary, minWidth: 44 },
  stepText: { ...font.medium, fontSize: 18, lineHeight: 28, color: colors.text },

  lift: { ...settle("transform") },
  lifted: { transform: [{ translateY: -4 }] },
  pressed: { transform: [{ scale: 0.98 }] },
  toolCore: { flexDirection: "row", alignItems: "center", gap: 18, padding: 24 },
  // On a phone: icon, words and arrow stacked, so the words get the whole width.
  toolCoreNarrow: { flexDirection: "column", alignItems: "flex-start", gap: 12 },
  toolTextNarrow: { gap: 4, alignSelf: "stretch" },
  arrow: { width: TOUCH, height: TOUCH, borderRadius: TOUCH / 2, alignItems: "center", justifyContent: "center", backgroundColor: colors.primarySoft, ...settle("transform") },
  arrowHover: { transform: [{ translateX: 3 }, { translateY: -1 }, { scale: 1.05 }] },

  trustCore: { padding: 32, gap: 16 },
  trustCoreWide: { paddingVertical: 72, paddingHorizontal: 64 },
  trustTitle: { ...font.heavy, fontSize: 32, lineHeight: 38, letterSpacing: -0.9, color: colors.onPrimary },
  trustTitleWide: { fontSize: 48, lineHeight: 54, letterSpacing: -1.6 },
  trustBody: { ...font.regular, fontSize: 18, lineHeight: 28, color: colors.onPrimary, maxWidth: 640 },
  notDoctor: { ...font.regular, fontSize: 15, lineHeight: 22, color: colors.onPrimary, opacity: 0.85, maxWidth: 640 },
  trustCta: { marginTop: 12 },

  footer: { gap: 20, paddingTop: 32, borderTopWidth: 1, borderTopColor: colors.hairline },
  langs: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  langChip: { minHeight: 40, justifyContent: "center", paddingHorizontal: 16, borderRadius: 999, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.hairline },
  langChipOn: { backgroundColor: colors.primarySoft, borderColor: colors.primary },
  langText: { ...font.medium, fontSize: 14, color: colors.text },
  langTextOn: { ...font.bold, color: colors.primary },
  footerRow: { flexDirection: "row", alignItems: "center", columnGap: 20, flexWrap: "wrap" },
  footerLink: { ...font.semibold, fontSize: 15, color: colors.primary, minHeight: TOUCH, textAlignVertical: "center", paddingVertical: 12 },
  footerText: { ...font.regular, fontSize: 14, color: colors.muted },
}));

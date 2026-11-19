// Settings, opened from the chat header, in five groups: Account, Appearance, Notifications, Connected services,
// and Privacy. Everything is saved on the account the moment it changes.
import { ReactNode, useState } from "react";
import { Linking, Pressable, ScrollView, Switch, Text, TextInput, View } from "react-native";
import { useAction, useMutation } from "convex/react";
import { Ionicons } from "@expo/vector-icons";
import { useAuthActions } from "@convex-dev/auth/react";
import { api } from "../convex/_generated/api";
import { colors, radius, TEXT_SIZES, themed, ui } from "./theme";
import { errorText, showToast } from "./feedback";
import { Reveal, SwapIcon } from "./Motion";
import { HealthSync } from "./useHealthSync";
import { HealthSettings } from "./HealthSettings";
import { Lang, LANGUAGE_NAMES, Strings } from "./i18n";
import { pushSupported } from "./push";

export type SettingsMe = {
  email: string | null;
  telegramLinked: boolean;
  location: string;
  language: string;
  appearance: { theme: "system" | "light" | "dark"; textSize: number };
  notifications: { reminders: boolean; appointments: boolean };
  checkins: boolean;
  weeklySummary: boolean;
  flareForecast: boolean;
  airAlerts: boolean;
  units: { glucose: "mg/dL" | "mmol/L"; weight: "lb" | "kg" };
};

// One group: a small heading over a card of rows.
function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View style={styles.group}>
      <Text style={styles.groupTitle} accessibilityRole="header">
        {title}
      </Text>
      <View style={styles.card}>{children}</View>
    </View>
  );
}

function Toggle({ label, hint, value, onChange }: { label: string; hint?: string; value: boolean; onChange: (on: boolean) => void }) {
  return (
    <View style={styles.settingRow}>
      <View style={styles.settingLabelWrap}>
        <Text style={styles.settingLabel}>{label}</Text>
        {hint ? <Text style={styles.settingHint}>{hint}</Text> : null}
      </View>
      <Switch accessibilityLabel={label} value={value} onValueChange={onChange} />
    </View>
  );
}

function Button({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable style={styles.settingButton} onPress={onPress} accessibilityRole="button">
      <Text style={styles.settingButtonText}>{label}</Text>
    </Pressable>
  );
}

// Change password: the current one, then the new one. Other devices are signed out after.
function ChangePassword({ s }: { s: Strings }) {
  const change = useAction(api.account.changePassword);
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    setError(null);
    if (next.length < 8) return setError(s.authShortPassword);
    setBusy(true);
    try {
      await change({ current, next });
      setOpen(false);
      setCurrent("");
      setNext("");
      showToast(s.passwordChanged);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <Button label={s.changePassword} onPress={() => setOpen(!open)} />
      <Reveal open={open}>
        <View style={styles.form}>
          <TextInput
            style={styles.input}
            placeholder={s.currentPassword}
            placeholderTextColor={colors.muted}
            secureTextEntry
            autoCapitalize="none"
            autoComplete="current-password"
            value={current}
            onChangeText={setCurrent}
            accessibilityLabel={s.currentPassword}
          />
          <TextInput
            style={styles.input}
            placeholder={s.newPassword}
            placeholderTextColor={colors.muted}
            secureTextEntry
            autoCapitalize="none"
            autoComplete="new-password"
            value={next}
            onChangeText={setNext}
            onSubmitEditing={() => void save()}
            accessibilityLabel={s.newPassword}
          />
          <Text style={styles.settingHint}>{s.changePasswordHint}</Text>
          {error && <Text style={styles.error}>{error}</Text>}
          <Pressable style={styles.primaryButton} onPress={() => void save()} disabled={busy || !current || !next} accessibilityRole="button">
            <Text style={styles.primaryButtonText}>{busy ? s.visitsSaving : s.save}</Text>
          </Pressable>
        </View>
      </Reveal>
    </>
  );
}

export function SettingsPanel({
  me,
  s,
  pushToken,
  health,
  onOpenAbout,
  onRedoSetup,
  onTour,
}: {
  me: SettingsMe;
  s: Strings;
  pushToken: { current: string | null };
  health: HealthSync;
  onOpenAbout: () => void;
  onRedoSetup: () => void;
  onTour: () => void;
}) {
  const setLanguage = useMutation(api.chat.setLanguage);
  const setAppearance = useMutation(api.chat.setAppearance);
  const setPushPreference = useMutation(api.push.setPreference);
  const unregisterPush = useMutation(api.push.unregister);
  const setCheckins = useMutation(api.checkins.setEnabled);
  const setWeekly = useMutation(api.weekly.setEnabled);
  const setForecast = useMutation(api.forecast.setEnabled);
  const setUnits = useMutation(api.chat.setUnits);
  const setAirAlerts = useMutation(api.forecast.setAirAlerts);
  const setLocation = useMutation(api.chat.setLocation);
  const [location, setLocationText] = useState(me.location);
  const saveLocation = () => {
    if (location.trim() !== me.location) void setLocation({ location });
  };
  const createLinkUrl = useMutation(api.telegram.createLinkUrl);
  const { signOut } = useAuthActions();
  const [error, setError] = useState<string | null>(null);

  const openTelegram = async () => {
    try {
      await Linking.openURL(await createLinkUrl());
    } catch (e) {
      setError(errorText(e));
    }
  };

  // A row of choices, one of them on.
  const chips = <T extends string | number>(label: string, options: readonly { value: T; label: string; icon?: keyof typeof Ionicons.glyphMap; a11y?: string; sample?: number }[], current: T, pick: (v: T) => void) => (
    <View style={styles.settingRow}>
      <Text style={styles.settingLabel}>{label}</Text>
      <View style={styles.langChips} accessibilityRole="radiogroup" accessibilityLabel={label}>
        {options.map((o) => {
          const on = current === o.value;
          return (
            <Pressable
              key={String(o.value)}
              style={[styles.langChip, !!o.icon && styles.iconChip, !!o.sample && styles.sizeChip, on && styles.langChipOn]}
              onPress={() => pick(o.value)}
              accessibilityRole="radio"
              accessibilityLabel={o.a11y}
              accessibilityState={{ selected: on }}
            >
              {o.icon && (
                <SwapIcon id={on ? "on" : "off"}>
                  <Ionicons name={on ? (o.icon.replace("-outline", "") as typeof o.icon) : o.icon} size={14} color={on ? colors.primary : colors.muted} />
                </SwapIcon>
              )}
              {o.sample ? (
                // The sample letter is drawn at that size, unscaled, so the choices compare honestly.
                <Text style={[styles.sizeSample, { fontSize: Math.round(15 * o.sample) }, on && styles.langChipTextOn]} allowFontScaling={false}>
                  A
                </Text>
              ) : (
                <Text style={[styles.langChipText, on && styles.langChipTextOn]}>{o.label}</Text>
              )}
            </Pressable>
          );
        })}
      </View>
    </View>
  );

  return (
    <ScrollView style={styles.settingsScroll} contentContainerStyle={styles.settings}>
      <Group title={s.settingsAccount}>
        <Text style={styles.muted}>{me.email}</Text>
        <ChangePassword s={s} />
        <Button label={s.redoSetup} onPress={onRedoSetup} />
        <Button label={s.tourReplay} onPress={onTour} />
        <Pressable
          style={styles.signOut}
          accessibilityRole="button"
          onPress={async () => {
            // This phone stops getting the account's notifications.
            if (pushToken.current) await unregisterPush({ token: pushToken.current }).catch(() => {});
            await signOut();
          }}
        >
          <Text style={styles.link}>{s.signOut}</Text>
        </Pressable>
      </Group>

      <Group title={s.settingsAppearance}>
        {chips(
          s.languageLabel,
          (Object.keys(LANGUAGE_NAMES) as Lang[]).map((code) => ({ value: code, label: LANGUAGE_NAMES[code] })),
          me.language as Lang,
          (language) => void setLanguage({ language }),
        )}
        {chips(
          s.appearanceLabel,
          [
            { value: "system", icon: "phone-portrait-outline", label: s.themeSystem },
            { value: "light", icon: "sunny-outline", label: s.themeLight },
            { value: "dark", icon: "moon-outline", label: s.themeDark },
          ] as const,
          me.appearance.theme,
          (theme) => void setAppearance({ appearance: { ...me.appearance, theme } }),
        )}
        {chips(
          s.textSizeLabel,
          TEXT_SIZES.map((size, i) => ({ value: size, label: "A", a11y: s.textSizeNames[i], sample: size })),
          me.appearance.textSize,
          (textSize) => void setAppearance({ appearance: { ...me.appearance, textSize } }),
        )}
        {/* Units for weight and glucose: only what's shown changes; readings are stored the same way. */}
        {chips(s.unitsWeight, [{ value: "lb", label: "lb" }, { value: "kg", label: "kg" }] as const, me.units.weight, (weight) => void setUnits({ units: { ...me.units, weight } }))}
        {chips(
          s.unitsGlucose,
          [{ value: "mg/dL", label: "mg/dL" }, { value: "mmol/L", label: "mmol/L" }] as const,
          me.units.glucose,
          (glucose) => void setUnits({ units: { ...me.units, glucose } }),
        )}
      </Group>

      <Group title={s.settingsNotifications}>
        {pushSupported &&
          (["reminders", "appointments"] as const).map((kind) => (
            <Toggle
              key={kind}
              label={kind === "reminders" ? s.notifyReminders : s.notifyAppointments}
              value={me.notifications[kind]}
              onChange={(enabled) => void setPushPreference({ kind, enabled })}
            />
          ))}
        <Toggle label={s.dailyCheckins} value={me.checkins} onChange={(enabled) => void setCheckins({ enabled })} />
        <Toggle label={s.weeklySummary} value={me.weeklySummary} onChange={(enabled) => void setWeekly({ enabled })} />
        <Toggle label={s.flareForecast} hint={s.flareForecastHint} value={me.flareForecast} onChange={(enabled) => void setForecast({ enabled })} />
        <Toggle label={s.airAlerts} hint={s.airAlertsHint} value={me.airAlerts} onChange={(enabled) => void setAirAlerts({ enabled })} />
      </Group>

      <Group title={s.settingsConnected}>
        <View style={styles.settingRow}>
          <Text style={styles.settingLabel}>{s.locationLabel}</Text>
          <TextInput
            style={styles.locationInput}
            placeholder={s.locationPlaceholder}
            placeholderTextColor={colors.muted}
            accessibilityLabel={s.locationLabel}
            value={location}
            onChangeText={setLocationText}
            onBlur={saveLocation}
            onSubmitEditing={saveLocation}
            returnKeyType="done"
          />
        </View>
        <Button label={me.telegramLinked ? s.telegramLinked : s.telegramLink} onPress={() => void openTelegram()} />
        {error && <Text style={styles.error}>{error}</Text>}
        <HealthSettings health={health} s={s} />
      </Group>

      <Group title={s.settingsPrivacy}>
        <Text style={styles.settingHint}>{s.settingsPrivacyHint}</Text>
        <Button label={s.aboutMe} onPress={onOpenAbout} />
      </Group>
    </ScrollView>
  );
}

const styles = themed(() => ({
  settingsScroll: { flexGrow: 0, flexShrink: 1, backgroundColor: colors.bg, borderBottomWidth: 1, borderBottomColor: colors.border },
  settings: { padding: 16, gap: 18, maxWidth: 760, width: "100%", alignSelf: "center" },
  group: { gap: 8 },
  groupTitle: { ...ui.section },
  card: { ...ui.card, padding: 14, gap: 12 },
  settingRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  settingLabel: { fontSize: 16, color: colors.text },
  settingLabelWrap: { flex: 1, marginRight: 12 },
  settingHint: { fontSize: 13, lineHeight: 18, color: colors.muted, marginTop: 2 },
  locationInput: { color: colors.text, flex: 1, marginLeft: 16, borderWidth: 1, borderColor: colors.border, borderRadius: 12, paddingHorizontal: 10, paddingVertical: 8, fontSize: 15 },
  langChips: { flexDirection: "row", gap: 6, flexWrap: "wrap", justifyContent: "flex-end", flex: 1, marginLeft: 16 },
  langChip: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 5 },
  iconChip: { flexDirection: "row", alignItems: "center", gap: 4 },
  sizeChip: { minWidth: 40, minHeight: 36, alignItems: "center", justifyContent: "center", paddingHorizontal: 8 },
  sizeSample: { color: colors.text, fontWeight: "700", lineHeight: 24 },
  langChipOn: { backgroundColor: colors.primarySoft, borderColor: colors.primary },
  langChipText: { color: colors.text, fontSize: 14 },
  langChipTextOn: { color: colors.primary, fontWeight: "600" },
  settingButton: { borderWidth: 1, borderColor: colors.primary, borderRadius: radius.pill, padding: 12, alignItems: "center" },
  settingButtonText: { color: colors.primary, fontWeight: "600", fontSize: 14 },
  muted: { color: colors.muted, fontSize: 14 },
  link: { color: colors.primary, fontSize: 16 },
  signOut: { minHeight: 44, justifyContent: "center", alignSelf: "flex-start" },
  error: { color: colors.danger, fontSize: 14 },
  form: { gap: 8, paddingTop: 4 },
  input: { color: colors.text, borderWidth: 1, borderColor: colors.inputBorder, backgroundColor: colors.surface, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15 },
  primaryButton: { ...ui.button },
  primaryButtonText: { color: colors.onPrimary, fontWeight: "600", fontSize: 14 },
}));

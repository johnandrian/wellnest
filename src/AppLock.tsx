// App lock (./lockStore.ts, rules in ./lockRules.ts). LockGate covers the signed-in app with a lock screen when it
// opens and when it comes back after a minute away; AppLockSetting turns it on and off in Settings → Privacy.
import { ReactNode, useEffect, useRef, useState } from "react";
import { AppState, Image, Pressable, Switch, Text, TextInput, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useAuthActions } from "@convex-dev/auth/react";
import { colors, radius, themed, TOUCH, ui } from "./theme";
import type { Strings } from "./i18n";
import { Enter, Reveal } from "./Motion";
import { biometricsAvailable, checkBiometrics, clearLock, LockSettings, lockSupported, onLockChange, readLock, saveLock } from "./lockStore";
import { afterWrong, shouldLock, validPin } from "./lockRules";
import { useInsets } from "./safeArea";

export function LockGate({ s, children }: { s: Strings; children: ReactNode }) {
  const [lock, setLock] = useState<LockSettings | null>(null);
  const [state, setState] = useState<"checking" | "locked" | "open">(lockSupported ? "checking" : "open");
  const hiddenAt = useRef<number | null>(null);
  const lockRef = useRef<LockSettings | null>(null);
  lockRef.current = lock;

  useEffect(() => {
    if (!lockSupported) return;
    void readLock().then((l) => {
      setLock(l);
      setState(l ? "locked" : "open");
    });
    // Turning it on in Settings doesn't lock right away; turning it off opens it.
    const off = onLockChange((l) => setLock(l));
    const sub = AppState.addEventListener("change", (next) => {
      if (next === "background") hiddenAt.current = Date.now();
      if (next === "active") {
        if (lockRef.current && shouldLock(hiddenAt.current, Date.now())) setState("locked");
        hiddenAt.current = null;
      }
    });
    return () => {
      off();
      sub.remove();
    };
  }, []);

  return (
    <View style={styles.flex}>
      {children}
      {state !== "open" && <View style={styles.cover}>{state === "locked" && lock ? <LockScreen lock={lock} s={s} onOpen={() => setState("open")} /> : null}</View>}
    </View>
  );
}

function LockScreen({ lock, s, onOpen }: { lock: LockSettings; s: Strings; onOpen: () => void }) {
  const insets = useInsets();
  const { signOut } = useAuthActions();
  const [pin, setPin] = useState("");
  const [tries, setTries] = useState(0);
  const [waitUntil, setWaitUntil] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  const waiting = waitUntil !== null && now < waitUntil;

  useEffect(() => {
    if (!waitUntil) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [waitUntil]);

  const biometrics = async () => {
    if (await checkBiometrics(s.lockPrompt, s.cancel)) onOpen();
  };
  // Face ID or the fingerprint is asked for as soon as the lock shows.
  useEffect(() => {
    if (lock.biometrics) void biometrics();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const enter = (value: string) => {
    const digits = value.replace(/\D/g, "").slice(0, 6);
    setPin(digits);
    if (digits.length < lock.pin.length) return;
    if (digits === lock.pin) return onOpen();
    const next = afterWrong(tries, Date.now());
    setTries(next.tries);
    setWaitUntil(next.waitUntil);
    setNow(Date.now());
    setPin("");
    setError(s.lockWrong);
  };

  return (
    <Enter style={[styles.lock, { paddingTop: insets.top + 32, paddingBottom: insets.bottom + 24 }]}>
      <Image source={require("../assets/wellnest-mark.png")} style={styles.logo} accessibilityIgnoresInvertColors />
      <Text style={styles.title} accessibilityRole="header">
        {s.lockTitle}
      </Text>
      <TextInput
        style={styles.pin}
        value={pin}
        onChangeText={enter}
        editable={!waiting}
        keyboardType="number-pad"
        secureTextEntry
        maxLength={6}
        autoFocus={!lock.biometrics}
        placeholder={s.lockEnterPin}
        placeholderTextColor={colors.muted}
        accessibilityLabel={s.lockEnterPin}
        textContentType="oneTimeCode"
      />
      {waiting ? (
        <Text style={styles.error} accessibilityLiveRegion="polite">
          {s.lockWait.replace("{n}", String(Math.ceil((waitUntil! - now) / 1000)))}
        </Text>
      ) : error ? (
        <Text style={styles.error} accessibilityLiveRegion="polite">
          {error}
        </Text>
      ) : null}
      {lock.biometrics && (
        <Pressable style={styles.button} onPress={() => void biometrics()} accessibilityRole="button">
          <Ionicons name="finger-print" size={20} color={colors.onPrimary} />
          <Text style={styles.buttonText}>{s.lockUseBiometrics}</Text>
        </Pressable>
      )}
      <Pressable
        style={styles.forgot}
        onPress={async () => {
          await clearLock();
          await signOut();
        }}
        accessibilityRole="button"
      >
        <Text style={styles.link}>{s.lockForgot}</Text>
      </Pressable>
    </Enter>
  );
}

// Settings → Privacy: turn the lock on with a new PIN (and Face ID or a fingerprint if the phone has one), or off
// with the PIN.
export function AppLockSetting({ s }: { s: Strings }) {
  const [lock, setLock] = useState<LockSettings | null>(null);
  const [canBio, setCanBio] = useState(false);
  const [mode, setMode] = useState<"idle" | "on" | "off">("idle");
  const [pin, setPin] = useState("");
  const [again, setAgain] = useState("");
  const [bio, setBio] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void readLock().then(setLock);
    void biometricsAvailable().then(setCanBio);
    return onLockChange(setLock);
  }, []);
  if (!lockSupported) return null;

  const reset = () => {
    setMode("idle");
    setPin("");
    setAgain("");
    setError(null);
  };
  const turnOn = async () => {
    if (!validPin(pin)) return setError(s.lockPinFormat);
    if (pin !== again) return setError(s.lockPinMismatch);
    await saveLock({ pin, biometrics: canBio && bio });
    reset();
  };
  const turnOff = async (entered: string) => {
    if (entered !== lock?.pin) return setError(s.lockWrong);
    await clearLock();
    reset();
  };

  return (
    <View style={styles.setting}>
      <View style={styles.row}>
        <View style={styles.flex}>
          <Text style={styles.label}>{s.lockSetting}</Text>
          <Text style={styles.hint}>{s.lockSettingHint}</Text>
        </View>
        <Switch
          value={!!lock || mode === "on"}
          onValueChange={(on) => {
            setError(null);
            setMode(on ? (lock ? "idle" : "on") : lock ? "off" : "idle");
          }}
          accessibilityLabel={s.lockSetting}
        />
      </View>
      <Reveal open={mode === "on"}>
        <View style={styles.form}>
          <TextInput style={styles.input} value={pin} onChangeText={(v) => setPin(v.replace(/\D/g, ""))} keyboardType="number-pad" secureTextEntry maxLength={6} placeholder={s.lockNewPin} placeholderTextColor={colors.muted} accessibilityLabel={s.lockNewPin} />
          <TextInput style={styles.input} value={again} onChangeText={(v) => setAgain(v.replace(/\D/g, ""))} keyboardType="number-pad" secureTextEntry maxLength={6} placeholder={s.lockRepeatPin} placeholderTextColor={colors.muted} accessibilityLabel={s.lockRepeatPin} />
          {canBio && (
            <View style={styles.row}>
              <Text style={[styles.label, styles.flex]}>{s.lockBiometrics}</Text>
              <Switch value={bio} onValueChange={setBio} accessibilityLabel={s.lockBiometrics} />
            </View>
          )}
          <View style={styles.row}>
            <Pressable style={[styles.button, styles.flex]} onPress={() => void turnOn()} accessibilityRole="button">
              <Text style={styles.buttonText}>{s.lockTurnOn}</Text>
            </Pressable>
            <Pressable style={styles.textButton} onPress={reset} accessibilityRole="button">
              <Text style={styles.link}>{s.cancel}</Text>
            </Pressable>
          </View>
        </View>
      </Reveal>
      <Reveal open={mode === "off"}>
        <View style={styles.form}>
          <TextInput
            style={styles.input}
            value={pin}
            onChangeText={(v) => {
              const digits = v.replace(/\D/g, "");
              setPin(digits);
              if (lock && digits.length >= lock.pin.length) void turnOff(digits);
            }}
            keyboardType="number-pad"
            secureTextEntry
            maxLength={6}
            placeholder={s.lockConfirmOff}
            placeholderTextColor={colors.muted}
            accessibilityLabel={s.lockConfirmOff}
          />
          <View style={styles.row}>
            {lock?.biometrics && (
              <Pressable
                style={[styles.button, styles.flex]}
                onPress={async () => {
                  if (await checkBiometrics(s.lockPrompt, s.cancel)) await turnOff(lock.pin);
                }}
                accessibilityRole="button"
              >
                <Text style={styles.buttonText}>{s.lockUseBiometrics}</Text>
              </Pressable>
            )}
            <Pressable style={styles.textButton} onPress={reset} accessibilityRole="button">
              <Text style={styles.link}>{s.cancel}</Text>
            </Pressable>
          </View>
        </View>
      </Reveal>
      {error && <Text style={styles.error}>{error}</Text>}
    </View>
  );
}

const styles = themed(() => ({
  flex: { flex: 1 },
  cover: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: colors.bg, zIndex: 100 },
  lock: { flex: 1, alignItems: "center", gap: 16, paddingHorizontal: 24 },
  logo: { width: 88, height: 88 },
  title: { fontSize: 22, fontWeight: "700", color: colors.text },
  pin: { color: colors.text, borderWidth: 1, borderColor: colors.inputBorder, backgroundColor: colors.surface, borderRadius: radius.md, paddingHorizontal: 16, paddingVertical: 12, fontSize: 22, letterSpacing: 8, textAlign: "center", width: 220 },
  button: { ...ui.button, flexDirection: "row", gap: 8, minHeight: TOUCH },
  buttonText: { color: colors.onPrimary, fontWeight: "600", fontSize: 15 },
  forgot: { minHeight: TOUCH, justifyContent: "center", marginTop: "auto" as const },
  link: { color: colors.primary, fontWeight: "600", fontSize: 14 },
  error: { color: colors.danger, fontSize: 14, textAlign: "center" },
  setting: { gap: 8 },
  row: { flexDirection: "row", alignItems: "center", gap: 12 },
  label: { fontSize: 16, color: colors.text },
  hint: { fontSize: 13, lineHeight: 18, color: colors.muted, marginTop: 2 },
  form: { gap: 8, paddingTop: 4 },
  input: { color: colors.text, borderWidth: 1, borderColor: colors.inputBorder, backgroundColor: colors.surface, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15 },
  textButton: { minHeight: TOUCH, justifyContent: "center", paddingHorizontal: 8 },
}));

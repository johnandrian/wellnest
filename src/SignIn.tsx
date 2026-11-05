import { useState } from "react";
import { ActivityIndicator, Image, Pressable, Text, TextInput, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useAuthActions } from "@convex-dev/auth/react";
import { colors, isSoft, pillish, radius, round, themed, TOUCH, ui } from "./theme";
import type { Strings } from "./i18n";
import { Enter } from "./Motion";

export function SignIn({ s, initialFlow = "signIn", onBack }: { s: Strings; initialFlow?: "signIn" | "signUp"; onBack?: () => void }) {
  const { signIn } = useAuthActions();
  const [flow, setFlow] = useState<"signIn" | "signUp">(initialFlow);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setError(null);
    // Check the length here so a sign-up failure below can only mean the email is taken.
    if (flow === "signUp" && password.length < 8) {
      setError(s.authShortPassword);
      return;
    }
    setBusy(true);
    try {
      await signIn("password", { email: email.trim(), password, flow });
    } catch {
      setError(flow === "signIn" ? s.authWrong : s.authTaken);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Enter style={styles.container}>
      {onBack && (
        <Pressable style={styles.back} onPress={onBack} accessibilityRole="button" accessibilityLabel={s.landBack}>
          <Ionicons name="chevron-back" size={20} color={colors.primary} />
          <Text style={styles.backText}>{s.landBack}</Text>
        </Pressable>
      )}
      <Image
        source={require("../assets/wellnest-logo.png")}
        style={styles.logo}
        resizeMode="contain"
        accessibilityLabel="Wellnest"
      />
      <Text style={styles.tagline}>{s.authTagline}</Text>
      <Text style={styles.subtitle} accessibilityRole="header">
        {flow === "signIn" ? s.authSignInTitle : s.authSignUpTitle}
      </Text>
      <TextInput
        style={styles.input}
        placeholder={s.authEmail}
        placeholderTextColor={colors.muted}
        autoCapitalize="none"
        autoComplete="email"
        keyboardType="email-address"
        value={email}
        onChangeText={setEmail}
        accessibilityLabel={s.authEmail}
      />
      <TextInput
        style={styles.input}
        placeholder={s.authPassword}
        placeholderTextColor={colors.muted}
        secureTextEntry
        autoComplete={flow === "signIn" ? "current-password" : "new-password"}
        value={password}
        onChangeText={setPassword}
        onSubmitEditing={submit}
        accessibilityLabel={s.authPassword}
      />
      {error && <Text style={styles.error}>{error}</Text>}
      <Pressable style={styles.button} onPress={submit} disabled={busy} accessibilityRole="button">
        {busy ? (
          <ActivityIndicator color={colors.onPrimary} />
        ) : (
          <Text style={styles.buttonText}>{flow === "signIn" ? s.authSignIn : s.authSignUp}</Text>
        )}
      </Pressable>
      <Pressable onPress={() => (setFlow(flow === "signIn" ? "signUp" : "signIn"), setError(null))} accessibilityRole="button">
        <Text style={styles.link}>{flow === "signIn" ? s.authToSignUp : s.authToSignIn}</Text>
      </Pressable>
    </Enter>
  );
}

const styles = themed(() => ({
  container: {
    flex: 1,
    justifyContent: "center",
    padding: 24,
    gap: 12,
    maxWidth: 420,
    width: "100%",
    alignSelf: "center",
    // In the soft look the form sits on a floating card in the middle of the page.
    ...(isSoft() ? { ...ui.card, flex: undefined, flexGrow: 0, flexShrink: 0, marginVertical: "auto" as const, padding: 32, borderRadius: radius.lg + 8 } : {}),
  },
  back: { flexDirection: "row", alignItems: "center", gap: 2, minHeight: TOUCH, alignSelf: "flex-start" },
  backText: { color: colors.primary, fontSize: 15, fontWeight: "600" },
  logo: { width: 200, height: 151, alignSelf: "center" },
  tagline: { fontSize: 15, color: colors.muted, textAlign: "center", marginBottom: 12 },
  subtitle: { fontSize: 16, color: colors.muted, marginBottom: 8 },
  input: { borderWidth: 1, borderColor: colors.inputBorder, borderRadius: round(10), padding: 12, fontSize: 16, color: colors.text, backgroundColor: colors.surface },
  button: { backgroundColor: colors.primary, borderRadius: pillish(10), padding: 14, alignItems: "center", minHeight: TOUCH },
  buttonText: { color: colors.onPrimary, fontSize: 16, fontWeight: "600" },
  link: { color: colors.primary, textAlign: "center", marginTop: 8, fontSize: 14 },
  error: { color: colors.danger, fontSize: 14 },
}));

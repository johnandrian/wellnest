import { StatusBar } from "expo-status-bar";
import { useEffect, useState } from "react";
import { ActivityIndicator, Platform, useColorScheme, View } from "react-native";
import { ConvexReactClient, Authenticated, AuthLoading, Unauthenticated, useMutation, useQuery } from "convex/react";
import { ConvexAuthProvider } from "@convex-dev/auth/react";
import * as SecureStore from "expo-secure-store";
import { Chat } from "./src/Chat";
import { Welcome, deviceLang } from "./src/Welcome";
import { Privacy } from "./src/Privacy";
import { ChecklistPage, MedListTool } from "./src/PublicPages";
import { Onboarding } from "./src/Onboarding";
import { api } from "./convex/_generated/api";
import { applyTheme, colors, themed } from "./src/theme";
import { strings } from "./src/i18n";
import { takeInviteFromUrl } from "./src/invite";
import { usePath } from "./src/route";
import { DemoPage } from "./src/DemoPage";
import { useAppFonts } from "./src/soft";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { ToastHost } from "./src/feedback";
import { useInsets } from "./src/safeArea";
import { LockGate } from "./src/AppLock";
import { SetupContext, SetupMode } from "./src/setup";
import { OfflineProvider } from "./src/offline";

// A care circle invite in the address (?join=...) is kept before anything renders (./src/invite.ts).
takeInviteFromUrl();

const convex = new ConvexReactClient(process.env.EXPO_PUBLIC_CONVEX_URL!, {
  unsavedChangesWarning: false,
});

// Native keeps auth tokens in SecureStore; web falls back to localStorage.
const secureStorage = {
  getItem: SecureStore.getItemAsync,
  setItem: SecureStore.setItemAsync,
  removeItem: SecureStore.deleteItemAsync,
};

export default function App() {
  return (
    <SafeAreaProvider>
      <ConvexAuthProvider
        client={convex}
        storage={Platform.OS === "web" ? undefined : secureStorage}
      >
        <Themed />
      </ConvexAuthProvider>
    </SafeAreaProvider>
  );
}

// Applies the account's Appearance (or the phone's light/dark setting before sign-in) before anything below renders.
// Everything is built here, not passed in as children, so a theme change redraws every screen.
function Themed() {
  const system = useColorScheme();
  const me = useQuery(api.chat.me);
  const [path, go] = usePath();
  // "Create an account" on a free tool page goes straight to the sign-up form.
  const [signUp, setSignUp] = useState(false);
  const create = () => {
    setSignUp(true);
    go("/");
  };
  const pageLang = strings(me?.language ?? deviceLang());
  const pref = me?.appearance;
  const scheme = pref && pref.theme !== "system" ? pref.theme : system === "dark" ? "dark" : "light";
  applyTheme(scheme, pref?.textSize ?? 1);
  // The app's font is bundled with it; wait the moment it takes to load so text doesn't jump.
  const fontsReady = useAppFonts();
  // The public pages and sign-in keep clear of the status bar and home indicator; signed-in screens place their own bars.
  const insets = useInsets();
  const clear = { flex: 1, paddingTop: insets.top, paddingBottom: insets.bottom };
  useEffect(() => {
    // The page behind the app (overscroll on web) and the browser's own controls.
    if (Platform.OS === "web") {
      document.body.style.backgroundColor = colors.bg;
      document.documentElement.style.colorScheme = scheme;
      // Scroll bar colours (public/index.html).
      document.documentElement.style.setProperty("--scrollbar", colors.mint);
      document.documentElement.style.setProperty("--scrollbar-hover", colors.primary);
    }
  }, [scheme]);
  const publicPage =
    path === "/privacy" ? (
      <Privacy s={pageLang} onBack={() => go("/")} />
    ) : path === "/medication-list" ? (
      <MedListTool s={pageLang} onBack={() => go("/")} onCreate={create} />
    ) : path === "/appointment-checklist" ? (
      <ChecklistPage s={pageLang} onBack={() => go("/")} onCreate={create} />
    ) : path === "/demo" ? (
      <DemoPage s={pageLang} onBack={() => go("/")} onCreate={create} />
    ) : null;
  if (!fontsReady) return <View style={styles.root} />;
  return (
    <View style={styles.root}>
      {/* The privacy page, the free tools and the demo dashboard are open to everyone, signed in or not. */}
      {publicPage ? (
        <View style={clear}>{publicPage}</View>
      ) : (
        <>
          <AuthLoading>
            <ActivityIndicator style={{ flex: 1 }} color={colors.primary} />
          </AuthLoading>
          <Unauthenticated>
            <View style={clear}>
              <Welcome key={signUp ? "signUp" : "welcome"} onOpen={go} initialAuth={signUp ? "signUp" : null} />
            </View>
          </Unauthenticated>
          <Authenticated>
            <Home />
          </Authenticated>
        </>
      )}
      {/* "Copied", "Saved", and Undo for deletes, over every screen (src/feedback.tsx). */}
      <ToastHost s={pageLang} />
      <StatusBar style={scheme === "dark" ? "light" : "dark"} />
    </View>
  );
}

// A short account setup first (once), then the dashboard and chat. The rest of setup opens from the dashboard's
// "Finish your profile" card, and all of it again from Settings.
function Home() {
  const me = useQuery(api.chat.me);
  const [setup, setSetup] = useState<SetupMode | null>(null);
  const setTimeZone = useMutation(api.chat.setTimeZone);
  // Medication reminders fire at local times, so the backend needs this device's time zone, already during setup.
  useEffect(() => {
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    void setTimeZone({ timeZone, utcOffsetMin: -new Date().getTimezoneOffset() }).catch(() => {});
  }, [setTimeZone]);
  if (me === undefined) return <ActivityIndicator style={{ flex: 1 }} />;
  // On phones with app lock on, a lock screen covers the app until the PIN or Face ID / fingerprint (src/AppLock.tsx).
  return (
    <LockGate s={strings(me?.language)}>
      <OfflineProvider s={strings(me?.language)} user={me?.email ?? ""}>
        <SetupContext.Provider value={setSetup}>
          {me && (!me.onboarded || setup) ? (
            <Onboarding mode={setup ?? "short"} onDone={() => setSetup(null)} />
          ) : (
            <Chat onRedoSetup={() => setSetup("full")} />
          )}
        </SetupContext.Provider>
      </OfflineProvider>
    </LockGate>
  );
}

const styles = themed(() => ({
  root: { flex: 1, backgroundColor: colors.bg },
}));

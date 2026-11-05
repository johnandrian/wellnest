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
import { appDesign } from "./src/design";
import { useSoftFonts } from "./src/soft";

// The look (src/design.ts), fixed for this page load.
const design = appDesign();

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
    <ConvexAuthProvider
      client={convex}
      storage={Platform.OS === "web" ? undefined : secureStorage}
    >
      <Themed />
    </ConvexAuthProvider>
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
  applyTheme(scheme, pref?.textSize ?? 1, design);
  // The soft look's font is bundled with the app; wait the moment it takes to load so text doesn't jump.
  const fontsReady = useSoftFonts(design === "soft");
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
  if (!fontsReady) return <View style={styles.root} />;
  return (
    <View style={styles.root}>
      {/* The privacy page, the free tools and the demo dashboard are open to everyone, signed in or not. */}
      {path === "/privacy" ? (
        <Privacy s={pageLang} onBack={() => go("/")} />
      ) : path === "/medication-list" ? (
        <MedListTool s={pageLang} onBack={() => go("/")} onCreate={create} />
      ) : path === "/appointment-checklist" ? (
        <ChecklistPage s={pageLang} onBack={() => go("/")} onCreate={create} />
      ) : path === "/demo" ? (
        <DemoPage s={pageLang} onBack={() => go("/")} onCreate={create} />
      ) : (
        <>
          <AuthLoading>
            <ActivityIndicator style={{ flex: 1 }} color={colors.primary} />
          </AuthLoading>
          <Unauthenticated>
            <Welcome key={signUp ? "signUp" : "welcome"} onOpen={go} initialAuth={signUp ? "signUp" : null} />
          </Unauthenticated>
          <Authenticated>
            <Home />
          </Authenticated>
        </>
      )}
      <StatusBar style={scheme === "dark" ? "light" : "dark"} />
    </View>
  );
}

// Account setup first (once, or again from Settings), then the dashboard and chat.
function Home() {
  const me = useQuery(api.chat.me);
  const [redo, setRedo] = useState(false);
  const setTimeZone = useMutation(api.chat.setTimeZone);
  // Medication reminders fire at local times, so the backend needs this device's time zone, already during setup.
  useEffect(() => {
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    void setTimeZone({ timeZone, utcOffsetMin: -new Date().getTimezoneOffset() }).catch(() => {});
  }, [setTimeZone]);
  if (me === undefined) return <ActivityIndicator style={{ flex: 1 }} />;
  if (me && (!me.onboarded || redo)) return <Onboarding onDone={() => setRedo(false)} />;
  return <Chat onRedoSetup={() => setRedo(true)} />;
}

const styles = themed(() => ({
  root: { flex: 1, backgroundColor: colors.bg },
}));

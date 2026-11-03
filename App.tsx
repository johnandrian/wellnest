import { StatusBar } from "expo-status-bar";
import { useEffect, useState } from "react";
import { ActivityIndicator, Platform, useColorScheme, View } from "react-native";
import { ConvexReactClient, Authenticated, AuthLoading, Unauthenticated, useQuery } from "convex/react";
import { ConvexAuthProvider } from "@convex-dev/auth/react";
import * as SecureStore from "expo-secure-store";
import { Chat } from "./src/Chat";
import { SignIn } from "./src/SignIn";
import { Onboarding } from "./src/Onboarding";
import { api } from "./convex/_generated/api";
import { applyTheme, colors, themed } from "./src/theme";

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
  const pref = me?.appearance;
  const scheme = pref && pref.theme !== "system" ? pref.theme : system === "dark" ? "dark" : "light";
  applyTheme(scheme, pref?.textSize ?? 1);
  useEffect(() => {
    // The page behind the app (overscroll on web) and the browser's own controls.
    if (Platform.OS === "web") {
      document.body.style.backgroundColor = colors.bg;
      document.documentElement.style.colorScheme = scheme;
    }
  }, [scheme]);
  return (
    <View style={styles.root}>
      <AuthLoading>
        <ActivityIndicator style={{ flex: 1 }} color={colors.primary} />
      </AuthLoading>
      <Unauthenticated>
        <SignIn />
      </Unauthenticated>
      <Authenticated>
        <Home />
      </Authenticated>
      <StatusBar style={scheme === "dark" ? "light" : "dark"} />
    </View>
  );
}

// Account setup first (once, or again from Settings), then the chat.
function Home() {
  const me = useQuery(api.chat.me);
  const [redo, setRedo] = useState(false);
  if (me === undefined) return <ActivityIndicator style={{ flex: 1 }} />;
  if (me && (!me.onboarded || redo)) return <Onboarding onDone={() => setRedo(false)} />;
  return <Chat onRedoSetup={() => setRedo(true)} />;
}

const styles = themed(() => ({
  root: { flex: 1, backgroundColor: colors.bg },
}));

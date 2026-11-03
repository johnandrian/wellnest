import { StatusBar } from "expo-status-bar";
import { useState } from "react";
import { ActivityIndicator, Platform, StyleSheet, View } from "react-native";
import { ConvexReactClient, Authenticated, AuthLoading, Unauthenticated, useQuery } from "convex/react";
import { ConvexAuthProvider } from "@convex-dev/auth/react";
import * as SecureStore from "expo-secure-store";
import { Chat } from "./src/Chat";
import { SignIn } from "./src/SignIn";
import { Onboarding } from "./src/Onboarding";
import { api } from "./convex/_generated/api";
import { colors } from "./src/theme";

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
      <View style={styles.root}>
        <AuthLoading>
          <ActivityIndicator style={{ flex: 1 }} />
        </AuthLoading>
        <Unauthenticated>
          <SignIn />
        </Unauthenticated>
        <Authenticated>
          <Home />
        </Authenticated>
        <StatusBar style="dark" />
      </View>
    </ConvexAuthProvider>
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

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
});

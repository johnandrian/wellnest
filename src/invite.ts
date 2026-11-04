// A care circle invite link (https://talktothebeak.health/?join=<token>, convex/circle.ts). On the web the token is
// taken off the address bar when the app loads and kept until the person joins or says not now, so it survives
// creating an account and account setup. Phones don't open these links yet; there's nothing to keep there.
import { Platform } from "react-native";

const KEY = "wellnest.join";
// Also kept in memory, for browsers that block storage (then it lasts until the page is closed).
let memory: string | null = null;

function store(): Storage | null {
  try {
    return Platform.OS === "web" ? window.localStorage : null;
  } catch {
    return null;
  }
}

// Called once at startup: moves ?join= from the address into storage, so a reload doesn't ask again.
export function takeInviteFromUrl() {
  if (Platform.OS !== "web") return;
  try {
    const url = new URL(window.location.href);
    const token = url.searchParams.get("join");
    if (!token) return;
    memory = token;
    store()?.setItem(KEY, token);
    url.searchParams.delete("join");
    window.history.replaceState(null, "", url.pathname + url.search + url.hash);
  } catch {
    // An odd address or blocked storage: the invite just isn't remembered.
  }
}

export function pendingInvite(): string | null {
  try {
    return store()?.getItem(KEY) ?? memory;
  } catch {
    return memory;
  }
}

export function clearInvite() {
  memory = null;
  try {
    store()?.removeItem(KEY);
  } catch {
    // Nothing to clear.
  }
}

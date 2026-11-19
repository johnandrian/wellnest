// Web notifications: a Web Push subscription through the service worker in public/sw.js, sent by convex/webPush.ts.
// Needs EXPO_PUBLIC_WEB_PUSH_KEY (the VAPID public key) at build time and a browser with push. The browser only asks
// for permission from Settings' button (useBrowserPush), then this tab registers itself whenever the app opens.
// iOS/Android: ./push.ts.
import { useEffect, useRef, useState } from "react";
import { useMutation } from "convex/react";
import { api } from "../convex/_generated/api";
import type { Strings } from "./i18n";

const KEY = process.env.EXPO_PUBLIC_WEB_PUSH_KEY;

export const pushSupported =
  typeof window !== "undefined" && !!KEY && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;

const bytes = (base64url: string) => {
  const b64 = (base64url + "=".repeat((4 - (base64url.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
};

async function subscribe(): Promise<PushSubscription> {
  const reg = await navigator.serviceWorker.register("/sw.js");
  await navigator.serviceWorker.ready;
  return (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: bytes(KEY!) }));
}

// This browser's endpoint once registered, so signing out (SettingsPanel) can unregister it.
const endpointRef: { current: string | null } = { current: null };

function useRegister() {
  const register = useMutation(api.push.registerWeb);
  return async () => {
    const sub = await subscribe();
    const keys = sub.toJSON().keys ?? {};
    await register({ endpoint: sub.endpoint, p256dh: keys.p256dh ?? "", auth: keys.auth ?? "" });
    endpointRef.current = sub.endpoint;
  };
}

// Registers this browser if notifications are already allowed, and opens the panel a clicked notification is about.
export function usePush(_s: Strings, onOpen: (kind: string) => void) {
  const register = useRegister();
  const openRef = useRef(onOpen);
  openRef.current = onOpen;

  useEffect(() => {
    if (!pushSupported) return;
    if (Notification.permission === "granted") {
      void register().catch((e) => console.warn("web push registration failed", e));
    }
    // A click with no Wellnest tab open opens a new one at /?open=<kind>.
    const params = new URLSearchParams(window.location.search);
    const kind = params.get("open");
    if (kind) {
      openRef.current(kind);
      params.delete("open");
      window.history.replaceState(null, "", `${window.location.pathname}${params.size ? `?${params}` : ""}`);
    }
    const onMessage = (e: MessageEvent) => {
      if (e.data?.type !== "wellnest-open") return;
      if (typeof e.data.url === "string" && /^https:\/\//.test(e.data.url)) window.open(e.data.url, "_blank", "noopener");
      else if (e.data.kind) openRef.current(e.data.kind);
    };
    navigator.serviceWorker.addEventListener("message", onMessage);
    return () => navigator.serviceWorker.removeEventListener("message", onMessage);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return endpointRef;
}

// Settings' "Turn on browser notifications": the browser asks, then this tab subscribes.
export function useBrowserPush(): { state: "on" | "off" | "blocked"; enable: () => Promise<void> } | null {
  const register = useRegister();
  const [state, setState] = useState<"on" | "off" | "blocked">(() => {
    if (!pushSupported) return "off";
    const p = Notification.permission;
    return p === "granted" ? "on" : p === "denied" ? "blocked" : "off";
  });
  if (!pushSupported) return null;
  return {
    state,
    enable: async () => {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") return setState(permission === "denied" ? "blocked" : "off");
      await register();
      setState("on");
    },
  };
}

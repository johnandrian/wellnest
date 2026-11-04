// iOS/Android push notifications (convex/push.ts sends them): medication reminders with Taken / Skip buttons,
// appointment updates, the weekly summary, the flare forecast and care circle alerts. Needs a development or store build with an EAS project id; web uses ./push.web.ts.
import { useEffect, useRef } from "react";
import { Linking, Platform } from "react-native";
import * as Notifications from "expo-notifications";
import * as Device from "expo-device";
import Constants from "expo-constants";
import { useMutation } from "convex/react";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import type { Strings } from "./i18n";

export const pushSupported = true;

Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false }),
});

async function setUp(s: Strings) {
  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync("reminders", { name: s.channelReminders, importance: Notifications.AndroidImportance.HIGH });
    await Notifications.setNotificationChannelAsync("appointments", { name: s.channelAppointments, importance: Notifications.AndroidImportance.HIGH });
    await Notifications.setNotificationChannelAsync("weekly", { name: s.channelWeekly, importance: Notifications.AndroidImportance.DEFAULT });
    await Notifications.setNotificationChannelAsync("forecast", { name: s.channelForecast, importance: Notifications.AndroidImportance.DEFAULT });
    await Notifications.setNotificationChannelAsync("circle", { name: s.channelCircle, importance: Notifications.AndroidImportance.HIGH });
  }
  // Answering from the notification doesn't open the app.
  await Notifications.setNotificationCategoryAsync("reminder", [
    { identifier: "taken", buttonTitle: s.taken, options: { opensAppToForeground: false } },
    { identifier: "skipped", buttonTitle: s.skip, options: { opensAppToForeground: false } },
  ]);
}

async function getToken(): Promise<string | null> {
  if (!Device.isDevice) return null; // simulators can't get push tokens
  const perm = await Notifications.getPermissionsAsync();
  const granted = perm.granted || (await Notifications.requestPermissionsAsync()).granted;
  if (!granted) return null;
  const projectId = Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
  if (!projectId) {
    console.warn("No EAS project id (run `npx eas-cli init`), so push notifications are off.");
    return null;
  }
  return (await Notifications.getExpoPushTokenAsync({ projectId })).data;
}

// Registers this phone once signed in, and handles taps: Taken / Skip log the dose; anything else opens a panel.
export function usePush(s: Strings, onOpen: (kind: string) => void) {
  const register = useMutation(api.push.register);
  const logDose = useMutation(api.reminders.log);
  const tokenRef = useRef<string | null>(null);
  const openRef = useRef(onOpen);
  openRef.current = onOpen;

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        await setUp(s);
        const token = await getToken();
        if (token && !cancelled) {
          tokenRef.current = token;
          await register({ token, platform: Platform.OS });
        }
      } catch (e) {
        console.warn("push registration failed", e);
      }
    })();
    return () => {
      cancelled = true;
    };
    // Category button titles follow the language.
  }, [register, s.taken]);

  useEffect(() => {
    const handle = (r: Notifications.NotificationResponse) => {
      const data = (r.notification.request.content.data ?? {}) as Record<string, string>;
      if ((r.actionIdentifier === "taken" || r.actionIdentifier === "skipped") && data.messageId) {
        void logDose({ messageId: data.messageId as Id<"messages">, status: r.actionIdentifier }).catch(() => {});
        return;
      }
      if (data.url && /^https:\/\//.test(data.url)) {
        void Linking.openURL(data.url);
        return;
      }
      if (data.kind) openRef.current(data.kind);
    };
    const last = Notifications.getLastNotificationResponse();
    if (last) handle(last);
    const sub = Notifications.addNotificationResponseReceivedListener(handle);
    return () => sub.remove();
  }, [logDose]);

  return tokenRef;
}

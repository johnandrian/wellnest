// Web has no Expo push; reminders still appear in the chat. (iOS/Android: ./push.ts.)
import { useRef } from "react";
import type { Strings } from "./i18n";

export const pushSupported = false;

export function usePush(_s: Strings, _onOpen: (kind: string) => void) {
  return useRef<string | null>(null);
}

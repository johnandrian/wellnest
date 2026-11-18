// The phone's safe area: room for the status bar, notch or Dynamic Island at the top and the home indicator at the
// bottom, measured on the device instead of guessed. The browser draws its own controls, so it needs none.
import { Platform } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

const NONE = { top: 0, bottom: 0, left: 0, right: 0 };

export function useInsets() {
  const insets = useSafeAreaInsets();
  return Platform.OS === "web" ? NONE : insets;
}

// A floating top bar's room below the status bar, outside the bar (margin).
export function barTop(top: number) {
  return { marginTop: 10 + top, paddingTop: 8 };
}

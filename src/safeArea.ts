// The phone's safe area: room for the status bar, notch or Dynamic Island at the top and the home indicator at the
// bottom, measured on the device instead of guessed. The browser draws its own controls, so it needs none.
import { Platform } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { isSoft } from "./theme";

const NONE = { top: 0, bottom: 0, left: 0, right: 0 };

export function useInsets() {
  const insets = useSafeAreaInsets();
  return Platform.OS === "web" ? NONE : insets;
}

// A top bar's room below the status bar. In the soft look the bar floats, so the room goes outside it (margin);
// in the classic look its color runs up under the status bar, so the room goes inside it (padding). `pad` is the
// bar's own padding above its content.
export function barTop(top: number, pad: number) {
  return isSoft() ? { marginTop: 10 + top, paddingTop: 8 } : { paddingTop: pad + top };
}

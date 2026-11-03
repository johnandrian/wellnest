// Pressable with the feedback every tap target in the Health tools needs: a dimmed pressed state (a ripple on
// Android) and a larger touch area around small targets, so chips and links reach about 44-48pt.
import { Pressable, PressableProps, PressableStateCallbackType, StyleProp, ViewStyle } from "react-native";
import { colors } from "./theme";

const HIT = 6;

export function Tap({ style, hitSlop = HIT, android_ripple, disabled, ...rest }: PressableProps) {
  return (
    <Pressable
      hitSlop={hitSlop}
      disabled={disabled}
      android_ripple={android_ripple ?? { color: colors.primarySoft }}
      style={(state: PressableStateCallbackType) => [
        typeof style === "function" ? style(state) : (style as StyleProp<ViewStyle>),
        state.pressed && { opacity: 0.6 },
        disabled && { opacity: 0.5 },
      ]}
      {...rest}
    />
  );
}

// A row of day bars you can tap: the tap's position picks the day, and `onPick` gets its index. Used by the journal's
// charts so each day's value can be read without squinting at a bar.
import { ReactNode, useRef } from "react";
import { Pressable, StyleProp, ViewStyle } from "react-native";

export function TapBars({ count, onPick, style, label, children }: { count: number; onPick: (i: number) => void; style?: StyleProp<ViewStyle>; label: string; children: ReactNode }) {
  const width = useRef(0);
  return (
    <Pressable
      style={style}
      onLayout={(e) => (width.current = e.nativeEvent.layout.width)}
      onPress={(e) => {
        if (!width.current || !count) return;
        onPick(Math.min(count - 1, Math.max(0, Math.floor((e.nativeEvent.locationX / width.current) * count))));
      }}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      {children}
    </Pressable>
  );
}

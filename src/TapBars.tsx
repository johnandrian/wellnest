// A row of day bars you can tap: the tap's position picks the day, and `onPick` gets its index. Used by the journal's
// charts so each day's value can be read without squinting at a bar.
import { ComponentRef, ReactNode, useRef } from "react";
import { Platform, Pressable, StyleProp, ViewStyle } from "react-native";

type Box = { getBoundingClientRect?: () => { left: number } };

export function TapBars({ count, onPick, style, label, children }: { count: number; onPick: (i: number) => void; style?: StyleProp<ViewStyle>; label: string; children: ReactNode }) {
  const width = useRef(0);
  const ref = useRef<ComponentRef<typeof Pressable>>(null);
  return (
    <Pressable
      ref={ref}
      style={style}
      onLayout={(e) => (width.current = e.nativeEvent.layout.width)}
      onPress={(e) => {
        if (!width.current || !count) return;
        // Phones give the tap's x inside the row. A browser click gives clientX, measured here against the row's own
        // box (its locationX can be missing or relative to the bar that was clicked).
        const n = e.nativeEvent as { locationX?: number; clientX?: number };
        const box = Platform.OS === "web" ? (ref.current as unknown as Box | null)?.getBoundingClientRect?.() : undefined;
        const x = box && typeof n.clientX === "number" ? n.clientX - box.left : n.locationX;
        if (typeof x !== "number" || Number.isNaN(x)) return;
        onPick(Math.min(count - 1, Math.max(0, Math.floor((x / width.current) * count))));
      }}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      {children}
    </Pressable>
  );
}

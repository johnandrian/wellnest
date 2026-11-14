// The welcome page's dot grid on a phone: one still frame of the web version (src/BreathingGrid.web.tsx), filling the
// screen behind the page, drawn with plain views so it needs no canvas. Only the visible dots are drawn, and it stays
// put while the page scrolls.
import { useMemo, useState } from "react";
import { View } from "react-native";
import { colors, themed } from "./theme";
import { BREATH_MS, dotAlpha, GAP } from "./breathingWave";

export function BreathingGrid(_: { scroll: { current: number }; lane?: [number, number] }) {
  const [box, setBox] = useState({ width: 0, height: 0 });
  const dots = useMemo(() => {
    const out: { x: number; y: number; a: number }[] = [];
    const { width, height } = box;
    if (!width) return out;
    const cols = Math.ceil(width / GAP) + 1;
    const rows = Math.ceil(height / GAP) + 1;
    const ox = (width - (cols - 1) * GAP) / 2;
    for (let c = 0; c < cols; c++) {
      for (let r = 0; r < rows; r++) {
        const x = ox + c * GAP;
        const y = r * GAP;
        const a = dotAlpha(x, y, width, BREATH_MS * 0.3);
        if (a >= 0.04) out.push({ x, y, a });
      }
    }
    return out;
  }, [box]);

  return (
    <View pointerEvents="none" style={styles.layer} onLayout={(e) => setBox(e.nativeEvent.layout)}>
      {dots.map(({ x, y, a }) => {
        const size = 1.8 + a * 5.2;
        return (
          <View
            key={`${x},${y}`}
            style={[styles.dot, { left: x - size / 2, top: y - size / 2, width: size, height: size, borderRadius: size / 2, opacity: a }]}
          />
        );
      })}
    </View>
  );
}

const styles = themed(() => ({
  layer: { position: "absolute" as const, top: 0, left: 0, right: 0, bottom: 0, overflow: "hidden" as const },
  dot: { position: "absolute" as const, backgroundColor: colors.primary },
}));

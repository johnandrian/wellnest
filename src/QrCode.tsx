// A QR code for a link, drawn with plain views (qrcode-generator does the encoding), so a doctor can scan a share link
// off the screen. Always dark on white, in either theme, with the quiet border scanners need.
import { useMemo } from "react";
import { View } from "react-native";
import qrcode from "qrcode-generator";
import { colors, themed } from "./theme";

export function QrCode({ value, size = 200, label }: { value: string; size?: number; label: string }) {
  const rows = useMemo(() => {
    const qr = qrcode(0, "M");
    qr.addData(value);
    qr.make();
    const n = qr.getModuleCount();
    // Each row as runs of dark modules: [start, length].
    return Array.from({ length: n }, (_, r) => {
      const runs: [number, number][] = [];
      for (let c = 0; c < n; c++) {
        if (!qr.isDark(r, c)) continue;
        const last = runs[runs.length - 1];
        if (last && last[0] + last[1] === c) last[1]++;
        else runs.push([c, 1]);
      }
      return runs;
    });
  }, [value]);
  const n = rows.length;
  const quiet = 4;
  const cell = size / (n + quiet * 2);
  return (
    <View style={[styles.paper, { width: size, height: size, padding: cell * quiet }]} accessibilityRole="image" accessibilityLabel={label}>
      {rows.map((runs, r) => (
        <View key={r} style={{ height: cell, flexDirection: "row" }}>
          {runs.map(([start, len]) => (
            <View key={start} style={[styles.ink, { position: "absolute", left: start * cell, width: len * cell, height: cell }]} />
          ))}
        </View>
      ))}
    </View>
  );
}

const styles = themed(() => ({
  paper: { backgroundColor: colors.qrPaper, borderRadius: 8, alignSelf: "center" },
  ink: { backgroundColor: colors.qrInk },
}));

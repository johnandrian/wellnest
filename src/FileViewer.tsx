// A record's original file inside the app: a photo full size on a dark backdrop, a PDF in a frame on the web. On
// phones a PDF is downloaded and opened in the system's PDF preview (openPdf in ./saveFile.ts).
import { createElement } from "react";
import { Image, Modal, Platform, Pressable, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors, themed } from "./theme";
import type { Strings } from "./i18n";
import { useInsets } from "./safeArea";

export function FileViewer({ file, title, onClose, s }: { file: { url: string; type: "image" | "pdf" } | null; title: string; onClose: () => void; s: Strings }) {
  const insets = useInsets();
  return (
    <Modal visible={file !== null} transparent animationType="fade" onRequestClose={onClose}>
      <View style={[styles.viewer, { paddingTop: insets.top + 64, paddingBottom: insets.bottom + 12 }]}>
        <Text style={[styles.title, { top: insets.top + 22 }]} numberOfLines={1}>
          {title}
        </Text>
        {file?.type === "image" && <Image source={{ uri: file.url }} style={styles.image} resizeMode="contain" accessibilityLabel={title} />}
        {file?.type === "pdf" && Platform.OS === "web" && createElement("iframe", { src: file.url, title, style: { flex: 1, width: "100%", border: 0, background: "white" } })}
        <Pressable style={[styles.close, { top: 12 + insets.top }]} onPress={onClose} accessibilityRole="button" accessibilityLabel={s.close}>
          <Ionicons name="close" size={26} color={colors.onScrim} />
        </Pressable>
      </View>
    </Modal>
  );
}

const styles = themed(() => ({
  // Always on a dark backdrop, in light and dark mode alike, like the chat's photo viewer.
  viewer: { flex: 1, backgroundColor: colors.scrim, paddingHorizontal: 12 },
  image: { flex: 1, width: "100%" },
  title: { position: "absolute", left: 16, right: 72, color: colors.onScrim, fontSize: 16, fontWeight: "700" },
  close: { position: "absolute", right: 12, width: 48, height: 48, borderRadius: 24, alignItems: "center", justifyContent: "center", backgroundColor: colors.scrimButton },
}));

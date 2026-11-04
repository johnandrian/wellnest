// Chat history (convex/chats.ts): a drawer from the left with every chat, newest first. Tap one to continue it;
// the trash button deletes it after a yes. It slides in over a dimmed chat and slides back out when closed.
// The search box above "New chat" finds chats by their title or anything said in them.
import { useState } from "react";
import { Alert, Animated, Platform, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { useMutation, useQuery } from "convex/react";
import { Ionicons } from "@expo/vector-icons";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { Tap } from "./Tap";
import { Icon } from "./Icon";
import { colors, radius, TOUCH, ui, themed } from "./theme";
import type { Strings } from "./i18n";
import { Enter, SwapIcon, usePresence } from "./Motion";

function confirmDelete(s: Strings): Promise<boolean> {
  if (Platform.OS === "web") return Promise.resolve(window.confirm(s.deleteChatBody));
  return new Promise((resolve) =>
    Alert.alert(s.deleteChat, s.deleteChatBody, [
      { text: s.cancel, style: "cancel", onPress: () => resolve(false) },
      { text: s.delete, style: "destructive", onPress: () => resolve(true) },
    ]),
  );
}

function dayLabel(at: number, s: Strings) {
  const d = new Date(at);
  const today = new Date();
  const yesterday = new Date(Date.now() - 86_400_000);
  if (d.toDateString() === today.toDateString()) return s.chatToday;
  if (d.toDateString() === yesterday.toDateString()) return s.chatYesterday;
  return d.toLocaleDateString(s.locale, { month: "short", day: "numeric", ...(d.getFullYear() !== today.getFullYear() && { year: "numeric" }) });
}

const WIDTH = 340;

export function ChatHistory({ open, s, onClose }: { open: boolean; s: Strings; onClose: () => void }) {
  const { t, mounted } = usePresence(open);
  if (!mounted) return null;
  return (
    <View style={styles.overlay} pointerEvents={open ? "auto" : "none"}>
      <Animated.View style={[styles.backdrop, { opacity: t }]}>
        <Pressable style={styles.fill} onPress={onClose} accessibilityRole="button" accessibilityLabel={s.closeHistory} />
      </Animated.View>
      <Animated.View
        style={[styles.drawer, { transform: [{ translateX: t.interpolate({ inputRange: [0, 1], outputRange: [-WIDTH, 0] }) }] }]}
        accessibilityViewIsModal
      >
        <Drawer s={s} onClose={onClose} />
      </Animated.View>
    </View>
  );
}

function Drawer({ s, onClose }: { s: Strings; onClose: () => void }) {
  const all = useQuery(api.chats.list);
  const start = useMutation(api.chats.start);
  const open = useMutation(api.chats.open);
  const remove = useMutation(api.chats.remove);
  const [query, setQuery] = useState("");
  const q = query.trim();
  const found = useQuery(api.chats.search, q.length >= 2 ? { text: q } : "skip");
  // Titles match as you type; message text once the server answers. A chat found both ways shows once, with its line.
  const byTitle = q ? (all ?? []).filter((c) => (c.title || s.chatUntitled).toLowerCase().includes(q.toLowerCase())) : [];
  const chats: { _id: Id<"chats"> | null; title: string; lastAt: number; current: boolean; snippet?: string }[] | undefined = !q
    ? all
    : [...(found ?? []), ...byTitle.filter((c) => !(found ?? []).some((f) => f._id === c._id))];

  return (
    <>
      <View style={styles.head}>
        <Text style={styles.title} accessibilityRole="header">
          {s.chatsTitle}
        </Text>
        <Tap style={styles.close} onPress={onClose} accessibilityRole="button" accessibilityLabel={s.closeHistory}>
          <Ionicons name="close" size={22} color={colors.text} />
        </Tap>
      </View>
      <View style={styles.search}>
        <View style={styles.searchIcon} pointerEvents="none">
          <Ionicons name="search" size={18} color={colors.muted} />
        </View>
        <TextInput
          style={styles.searchInput}
          value={query}
          onChangeText={setQuery}
          placeholder={s.chatSearch}
          placeholderTextColor={colors.muted}
          accessibilityLabel={s.chatSearch}
          returnKeyType="search"
          autoCorrect={false}
        />
        {!!query && (
          <Tap style={styles.clear} onPress={() => setQuery("")} accessibilityRole="button" accessibilityLabel={s.cancel}>
            <SwapIcon id="clear">
              <Ionicons name="close-circle" size={18} color={colors.muted} />
            </SwapIcon>
          </Tap>
        )}
      </View>
      <Tap
        style={styles.newChat}
        onPress={async () => {
          await start();
          onClose();
        }}
        accessibilityRole="button"
        accessibilityLabel={s.newChat}
      >
        <Icon name="newChat" size={18} color={colors.onPrimary} />
        <Text style={styles.newChatText}>{s.newChat}</Text>
      </Tap>
      <ScrollView contentContainerStyle={styles.list}>
        {chats?.length === 0 && <Text style={styles.empty}>{q ? s.chatSearchNone.replace("{q}", q) : s.chatsEmpty}</Text>}
        {chats?.map((c) => (
          <Enter key={c._id ?? "first"} from={6} style={[styles.row, c.current && styles.rowOn]}>
            <Tap
              style={styles.rowMain}
              onPress={async () => {
                if (c._id && !c.current) await open({ chatId: c._id });
                onClose();
              }}
              accessibilityRole="button"
              accessibilityLabel={`${c.title || s.chatUntitled}, ${dayLabel(c.lastAt, s)}`}
              accessibilityState={{ selected: c.current }}
            >
              <Ionicons name={c.current ? "chatbubble" : "chatbubble-outline"} size={18} color={c.current ? colors.primary : colors.muted} />
              <View style={styles.rowText}>
                <Text style={[styles.rowTitle, c.current && styles.rowTitleOn]} numberOfLines={1}>
                  {c.title || s.chatUntitled}
                </Text>
                {!!c.snippet && (
                  <Text style={styles.snippet} numberOfLines={2}>
                    {c.snippet}
                  </Text>
                )}
                <Text style={styles.rowDate}>{c.current ? `${s.chatCurrent} · ${dayLabel(c.lastAt, s)}` : dayLabel(c.lastAt, s)}</Text>
              </View>
            </Tap>
            {c._id && (
              <Tap
                style={styles.trash}
                onPress={async () => {
                  if (await confirmDelete(s)) await remove({ chatId: c._id as Id<"chats"> });
                }}
                accessibilityRole="button"
                accessibilityLabel={`${s.deleteChat}: ${c.title || s.chatUntitled}`}
              >
                <Ionicons name="trash-outline" size={18} color={colors.muted} />
              </Tap>
            )}
          </Enter>
        ))}
      </ScrollView>
    </>
  );
}

const styles = themed(() => ({
  overlay: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, zIndex: 20, flexDirection: "row" },
  backdrop: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: colors.backdrop },
  fill: { flex: 1 },
  empty: { ...ui.empty },
  drawer: {
    width: "85%",
    maxWidth: WIDTH,
    height: "100%",
    backgroundColor: colors.surface,
    paddingTop: Platform.OS === "web" ? 12 : 56,
    borderTopRightRadius: radius.lg,
    borderBottomRightRadius: radius.lg,
  },
  head: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16 },
  title: { fontSize: 20, fontWeight: "700", color: colors.text },
  close: { width: TOUCH, height: TOUCH, alignItems: "center", justifyContent: "center", borderRadius: TOUCH / 2 },
  // The text box is the bordered field (so the focus ring wraps it); the icons sit on top of it.
  search: { marginHorizontal: 16, marginTop: 8, justifyContent: "center" },
  searchIcon: { position: "absolute", left: 12, zIndex: 1 },
  searchInput: { minHeight: TOUCH, paddingLeft: 38, paddingRight: TOUCH, fontSize: 15, color: colors.text, borderWidth: 1, borderColor: colors.inputBorder, borderRadius: radius.md, backgroundColor: colors.bg },
  clear: { position: "absolute", right: 0, width: TOUCH, height: TOUCH, alignItems: "center", justifyContent: "center" },
  snippet: { fontSize: 13, color: colors.text, marginTop: 2, lineHeight: 18 },
  newChat: { ...ui.button, flexDirection: "row", gap: 8, marginHorizontal: 16, marginTop: 8, marginBottom: 8 },
  newChatText: { color: colors.onPrimary, fontWeight: "700", fontSize: 15 },
  list: { paddingHorizontal: 8, paddingBottom: 24, gap: 2 },
  row: { flexDirection: "row", alignItems: "center", borderRadius: radius.md },
  rowOn: { backgroundColor: colors.primarySoft },
  rowMain: { flex: 1, flexDirection: "row", alignItems: "center", gap: 10, minHeight: 56, paddingHorizontal: 10 },
  rowText: { flex: 1, minWidth: 0 },
  rowTitle: { fontSize: 15, color: colors.text },
  rowTitleOn: { fontWeight: "700", color: colors.primary },
  rowDate: { fontSize: 12, color: colors.muted, marginTop: 2 },
  trash: { width: TOUCH, height: TOUCH, alignItems: "center", justifyContent: "center", borderRadius: TOUCH / 2 },
}));

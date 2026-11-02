import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  KeyboardAvoidingView,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import { useMutation, useQuery } from "convex/react";
import { Ionicons } from "@expo/vector-icons";
import { useAuthActions } from "@convex-dev/auth/react";
import { api } from "../convex/_generated/api";
import { colors } from "./theme";
import { useVoice } from "./useVoice";
import { Markdown } from "./Markdown";
import { PulseRing, ThinkingDots } from "./Motion";
import { HealthSync, useHealthSync } from "./useHealthSync";
import { HealthSettings } from "./HealthSettings";
import { HubPanel, HubTab } from "./HubPanel";
import { AboutPanel } from "./AboutPanel";
import { Picked, pickPhoto, uploadPhoto } from "./photo";
import type { Id } from "../convex/_generated/dataModel";
import { Lang, LANGUAGE_NAMES, Strings, strings } from "./i18n";
import { pushSupported, usePush } from "./push";
import { AppointmentCard } from "./TelehealthCard";

// The panels that open under the header.
type Panel = "settings" | "hub" | "about";


// Camera or library: native asks which; web (and desktop browsers) only have the library.
function chooseSource(): Promise<"library" | "camera" | null> {
  if (Platform.OS === "web") return Promise.resolve("library");
  return new Promise((resolve) =>
    Alert.alert("Add a photo", "A pill bottle, a label, lab results, a rash...", [
      { text: "Take photo", onPress: () => resolve("camera") },
      { text: "Choose from library", onPress: () => resolve("library") },
      { text: "Cancel", style: "cancel", onPress: () => resolve(null) },
    ]),
  );
}

// Yes/no before clearing: a browser dialog on web, a native alert on iOS/Android.
function confirmClear(): Promise<boolean> {
  const message = "Clear this chat and start fresh? Wellnest won't use these messages in new answers.";
  if (Platform.OS === "web") return Promise.resolve(window.confirm(message));
  return new Promise((resolve) =>
    Alert.alert("Clear chat?", message, [
      { text: "Cancel", style: "cancel", onPress: () => resolve(false) },
      { text: "Clear", style: "destructive", onPress: () => resolve(true) },
    ]),
  );
}

export function Chat() {
  const messages = useQuery(api.chat.list);
  const me = useQuery(api.chat.me);
  const send = useMutation(api.chat.send);
  const clearChat = useMutation(api.chat.clear);
  const setTimeZone = useMutation(api.chat.setTimeZone);
  const logDose = useMutation(api.reminders.log);
  const uploadUrl = useMutation(api.chat.generateUploadUrl);
  const claimUpload = useMutation(api.chat.claimUpload);
  const [photo, setPhoto] = useState<Picked | null>(null);
  const [sending, setSending] = useState(false);
  const [text, setText] = useState("");
  const [panel, setPanel] = useState<Panel | null>(null);
  const [hubTab, setHubTab] = useState<HubTab>("journal");
  const openHub = (tab: HubTab) => {
    setHubTab(tab);
    setPanel("hub");
  };
  // "about" opens from Settings, so the settings button closes it too.
  const toggle = (p: Panel) => setPanel((open) => (open === p || (p === "settings" && open === "about") ? null : p));
  const [notice, setNotice] = useState<string | null>(null);
  const listRef = useRef<FlatList>(null);

  const last = messages?.[messages.length - 1];
  const waiting = last?.role === "user";

  // `spoken`: it came from the mic, so the reply is read aloud.
  const submit = async (value = text, attached: Picked | null = photo, spoken = false) => {
    if (!value.trim() && !attached) return;
    setText("");
    setNotice(null);
    let imageId: Id<"_storage"> | undefined;
    if (attached) {
      setSending(true);
      try {
        imageId = (await uploadPhoto(attached, () => uploadUrl(), (storageId) =>
          claimUpload({ storageId: storageId as Id<"_storage"> }),
        )) as Id<"_storage">;
      } catch (e) {
        setText(value);
        setNotice((e as Error).message);
        return;
      } finally {
        setSending(false);
      }
      setPhoto(null);
    }
    try {
      const res = await send({ text: value, imageId, ...(spoken && { voice: true }) });
      if (res.limited) {
        setText(value);
        setNotice(`You've reached today's limit of ${res.limit} messages. Please try again tomorrow. In an emergency, call 911.`);
      }
    } catch (e) {
      setText(value);
      setNotice((e as Error).message.replace(/^.*Uncaught Error: /, "").split("\n")[0]);
    }
  };

  const addPhoto = async () => {
    setNotice(null);
    try {
      const source = await chooseSource();
      if (!source) return;
      const picked = await pickPhoto(source);
      if (picked) setPhoto(picked);
    } catch (e) {
      setNotice((e as Error).message);
    }
  };

  const s = strings(me?.language);
  const voice = useVoice(messages, (spokenText) => submit(spokenText, photo, true), me?.language, {
    recording: s.listening,
    transcribing: s.transcribing,
  });
  const health = useHealthSync();

  // Tapping a reminder notification opens the reminders; Taken / Skip on it are handled in usePush.
  const pushToken = usePush(s, (kind) => openHub(kind === "reminders" ? "reminders" : "care"));

  // Medication reminders fire at local times, so the backend needs this device's time zone.
  useEffect(() => {
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    void setTimeZone({ timeZone, utcOffsetMin: -new Date().getTimezoneOffset() }).catch(() => {});
  }, [setTimeZone]);

  const clear = async () => {
    if (!(await confirmClear())) return;
    voice.stopSpeaking();
    setNotice(null);
    await clearChat();
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <View style={styles.header}>
        <View style={styles.brand}>
          <Image source={require("../assets/wellnest-mark.png")} style={styles.logo} accessibilityIgnoresInvertColors />
          <View style={styles.brandText}>
            <Text style={styles.headerTitle}>Wellnest</Text>
            <Text style={styles.headerSubtitle} numberOfLines={1}>
              {s.subtitleVoice} · {s.notDoctor}
            </Text>
          </View>
        </View>
        <View style={styles.headerActions}>
          {!!messages?.length && (
            <Pressable
              style={({ pressed }) => [styles.headerButton, pressed && styles.pressed]}
              onPress={() => void clear()}
              accessibilityRole="button"
              accessibilityLabel="Clear chat"
            >
              <Ionicons name="trash-outline" size={21} color={colors.text} />
            </Pressable>
          )}
          <Pressable
            style={({ pressed }) => [styles.headerButton, pressed && styles.pressed]}
            onPress={() => toggle("hub")}
            accessibilityRole="button"
            accessibilityLabel={panel === "hub" ? `${s.close} ${s.hubTitle}` : s.hubTitle}
          >
            <Ionicons name={panel === "hub" ? "close" : "pulse"} size={22} color={colors.text} />
          </Pressable>
          <Pressable
            style={({ pressed }) => [styles.headerButton, pressed && styles.pressed]}
            onPress={() => toggle("settings")}
            accessibilityRole="button"
            accessibilityLabel={panel === "settings" || panel === "about" ? "Close settings" : "Settings"}
          >
            <Ionicons name={panel === "settings" || panel === "about" ? "close" : "settings-outline"} size={22} color={colors.text} />
          </Pressable>
        </View>
      </View>

      {panel === "hub" && <HubPanel tab={hubTab} onTab={setHubTab} s={s} />}
      {panel === "about" && <AboutPanel />}
      {panel === "settings" && me && <Settings me={me} s={s} pushToken={pushToken} health={health} onOpenAbout={() => setPanel("about")} />}

      {messages === undefined ? (
        <ActivityIndicator style={{ flex: 1 }} />
      ) : (
        <FlatList
          ref={listRef}
          data={messages}
          keyExtractor={(m) => m._id}
          contentContainerStyle={styles.list}
          onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: true })}
          ListEmptyComponent={
            <View style={styles.welcome}>
              <View style={styles.welcomeIcon}>
                <Ionicons name="mic" size={30} color={colors.primary} />
              </View>
              <Text style={styles.welcomeTitle}>{s.welcome}</Text>
              <Text style={styles.empty}>
                {s.introVoice} {s.disclaimer}
              </Text>
              <View style={styles.chips}>
                {s.starters.map((q) => (
                  <Pressable
                    key={q}
                    style={({ pressed }) => [styles.chip, pressed && styles.pressed]}
                    onPress={() => void submit(q)}
                    accessibilityRole="button"
                  >
                    <Text style={styles.chipText}>{q}</Text>
                  </Pressable>
                ))}
              </View>
            </View>
          }
          renderItem={({ item }) => (
            <View
              style={[
                styles.bubble,
                item.role === "user" ? styles.userBubble : styles.botBubble,
                item.urgent && styles.urgentBubble,
                (item.kind === "reminder" || item.kind === "checkin" || item.kind === "appointment") && styles.reminderBubble,
              ]}
            >
              {item.imageUrl && (
                <Image
                  source={{ uri: item.imageUrl }}
                  style={styles.photo}
                  resizeMode="cover"
                  accessibilityLabel="Photo you sent"
                />
              )}
              {item.role === "user" ? (
                !!item.text && <Text style={styles.userText}>{item.text}</Text>
              ) : (
                <Markdown text={item.text} style={styles.botText} />
              )}
              {item.appointmentId && <AppointmentCard id={item.appointmentId} s={s} />}
              {item.reminder && (
                <View style={styles.doseRow}>
                  {(["taken", "skipped"] as const).map((status) => {
                    const on = item.reminder!.status === status;
                    return (
                      <Pressable
                        key={status}
                        style={[styles.doseButton, on && styles.doseButtonOn]}
                        onPress={() => void logDose({ messageId: item._id, status })}
                        accessibilityRole="button"
                        accessibilityState={{ selected: on }}
                      >
                        <Ionicons
                          name={status === "taken" ? "checkmark" : "close"}
                          size={15}
                          color={on ? "#fff" : colors.primary}
                        />
                        <Text style={[styles.doseText, on && styles.doseTextOn]}>{status === "taken" ? s.taken : s.skip}</Text>
                      </Pressable>
                    );
                  })}
                </View>
              )}
              {item.channel === "telegram" && (
                <Text style={styles.channel}>{item.voice ? "Voice note via Telegram" : "via Telegram"}</Text>
              )}
              {item._id === voice.speakingId && (
                <Pressable
                  style={styles.speaking}
                  onPress={voice.stopSpeaking}
                  accessibilityRole="button"
                  accessibilityLabel="Speaking. Tap to stop."
                >
                  <Ionicons name="volume-high" size={14} color={colors.primary} />
                  <Text style={styles.speakingText}>{s.speaking}</Text>
                </Pressable>
              )}
            </View>
          )}
          ListFooterComponent={
            waiting ? (
              <View style={[styles.bubble, styles.botBubble, styles.thinking]}>
                <ThinkingDots />
              </View>
            ) : undefined
          }
        />
      )}

      {photo && (
        <View style={styles.attachment}>
          <Image source={{ uri: photo.uri }} style={styles.attachmentThumb} />
          <Text style={styles.attachmentText}>{sending ? "Uploading photo…" : "Photo attached"}</Text>
          {!sending && (
            <Pressable onPress={() => setPhoto(null)} accessibilityRole="button" accessibilityLabel="Remove photo">
              <Ionicons name="close-circle" size={22} color={colors.muted} />
            </Pressable>
          )}
        </View>
      )}
      <View style={styles.inputRow}>
        <Pressable
          style={({ pressed }) => [styles.iconButton, styles.photoButton, pressed && styles.pressed]}
          onPress={() => void addPhoto()}
          disabled={sending}
          accessibilityRole="button"
          accessibilityLabel="Add a photo"
        >
          <Ionicons name="camera-outline" size={22} color={colors.primary} />
        </Pressable>
        <View>
          {voice.mic === "recording" && <PulseRing color={colors.danger} style={styles.ring} />}
          <Pressable
            style={({ pressed }) => [
              styles.iconButton,
              styles.mic,
              voice.mic === "recording" && styles.micActive,
              pressed && styles.pressed,
            ]}
            onPress={voice.mic === "recording" ? voice.stop : voice.start}
            disabled={voice.mic === "asking" || voice.mic === "transcribing"}
            accessibilityRole="button"
            accessibilityLabel={voice.mic === "recording" ? "Stop recording and send" : "Record a voice message"}
            accessibilityState={{ busy: voice.mic === "asking" || voice.mic === "transcribing" }}
          >
            {voice.mic === "asking" || voice.mic === "transcribing" ? (
              <ActivityIndicator color={colors.primary} />
            ) : voice.mic === "recording" ? (
              <Ionicons name="stop" size={20} color="#fff" />
            ) : (
              <Ionicons name="mic" size={22} color={colors.primary} />
            )}
          </Pressable>
        </View>
        <TextInput
          style={styles.input}
          placeholder={photo ? s.placeholderPhoto : s.placeholderVoice}
          placeholderTextColor={colors.muted}
          value={text}
          onChangeText={setText}
          onSubmitEditing={() => submit()}
          returnKeyType="send"
        />
        <Pressable
          style={({ pressed }) => [styles.iconButton, styles.send, !text.trim() && !photo && styles.sendIdle, pressed && styles.pressed]}
          onPress={() => submit()}
          disabled={(!text.trim() && !photo) || sending}
          accessibilityRole="button"
          accessibilityLabel="Send message"
        >
          <Ionicons name="arrow-up" size={22} color="#fff" />
        </Pressable>
      </View>
      {notice && <Text style={styles.error}>{notice}</Text>}
      {voice.status && (
        <View style={styles.noteRow}>
          <Text style={[styles.voiceStatus, styles.noteText]} accessibilityLiveRegion="polite">
            {voice.status}
          </Text>
        </View>
      )}
      {voice.error && (
        <View style={styles.noteRow}>
          <Text style={[styles.error, styles.noteText]} accessibilityLiveRegion="assertive">
            {voice.error.text}
          </Text>
          {voice.error.openSettings && (
            <Pressable onPress={() => void Linking.openSettings()} accessibilityRole="link">
              <Text style={styles.errorAction}>Open Settings</Text>
            </Pressable>
          )}
          <Pressable onPress={voice.dismissError} accessibilityRole="button" accessibilityLabel="Dismiss">
            <Text style={styles.errorAction}>✕</Text>
          </Pressable>
        </View>
      )}
    </KeyboardAvoidingView>
  );
}

function Settings({
  me,
  s,
  pushToken,
  health,
  onOpenAbout,
}: {
  me: {
    email: string | null;
    telegramLinked: boolean;
    location: string;
    language: string;
    notifications: { reminders: boolean; appointments: boolean };
    checkins: boolean;
  };
  s: Strings;
  pushToken: { current: string | null };
  health: HealthSync;
  onOpenAbout: () => void;
}) {
  const setLanguage = useMutation(api.chat.setLanguage);
  const setPushPreference = useMutation(api.push.setPreference);
  const unregisterPush = useMutation(api.push.unregister);
  const setCheckins = useMutation(api.checkins.setEnabled);
  const setLocation = useMutation(api.chat.setLocation);
  const [location, setLocationText] = useState(me.location);
  const saveLocation = () => {
    if (location.trim() !== me.location) void setLocation({ location });
  };
  const createLinkUrl = useMutation(api.telegram.createLinkUrl);
  const { signOut } = useAuthActions();
  const [error, setError] = useState<string | null>(null);

  const openTelegram = async () => {
    try {
      await Linking.openURL(await createLinkUrl());
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <ScrollView style={styles.settingsScroll} contentContainerStyle={styles.settings}>
      <Text style={styles.muted}>{me.email}</Text>
      <View style={styles.settingRow}>
        <Text style={styles.settingLabel}>Language</Text>
        <View style={styles.langChips}>
          {(Object.keys(LANGUAGE_NAMES) as Lang[]).map((code) => (
            <Pressable
              key={code}
              style={[styles.langChip, me.language === code && styles.langChipOn]}
              onPress={() => void setLanguage({ language: code })}
              accessibilityRole="radio"
              accessibilityState={{ selected: me.language === code }}
            >
              <Text style={[styles.langChipText, me.language === code && styles.langChipTextOn]}>{LANGUAGE_NAMES[code]}</Text>
            </Pressable>
          ))}
        </View>
      </View>
      <View style={styles.settingRow}>
        <Text style={styles.settingLabel}>Location</Text>
        <TextInput
          style={styles.locationInput}
          placeholder="City or zip (for nearby care)"
          value={location}
          onChangeText={setLocationText}
          onBlur={saveLocation}
          onSubmitEditing={saveLocation}
          returnKeyType="done"
        />
      </View>
      <Pressable style={styles.settingButton} onPress={openTelegram}>
        <Text style={styles.settingButtonText}>
          {me.telegramLinked ? "Telegram linked ✓ (open bot)" : "Text me on Telegram"}
        </Text>
      </Pressable>
      {error && <Text style={styles.error}>{error}</Text>}
      <HealthSettings health={health} />
      <Pressable style={styles.settingButton} onPress={onOpenAbout} accessibilityRole="button">
        <Text style={styles.settingButtonText}>What Wellnest knows about me</Text>
      </Pressable>
      <View style={styles.settingRow}>
        <Text style={[styles.settingLabel, styles.settingLabelWrap]}>{s.dailyCheckins}</Text>
        <Switch value={me.checkins} onValueChange={(enabled) => void setCheckins({ enabled })} />
      </View>
      {pushSupported &&
        (["reminders", "appointments"] as const).map((kind) => (
          <View key={kind} style={styles.settingRow}>
            <Text style={styles.settingLabel}>{kind === "reminders" ? s.notifyReminders : s.notifyAppointments}</Text>
            <Switch value={me.notifications[kind]} onValueChange={(enabled) => void setPushPreference({ kind, enabled })} />
          </View>
        ))}
      <Pressable
        onPress={async () => {
          // This phone stops getting the account's notifications.
          if (pushToken.current) await unregisterPush({ token: pushToken.current }).catch(() => {});
          await signOut();
        }}
      >
        <Text style={styles.headerLink}>Sign out</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 16,
    // Room for the status bar / notch on phones; the browser needs none.
    paddingTop: Platform.OS === "web" ? 10 : 56,
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: "#fff",
  },
  headerTitle: { fontSize: 18, fontWeight: "700", color: colors.text },
  headerSubtitle: { fontSize: 12, color: colors.muted, marginTop: 1 },
  // The title side shrinks (subtitle truncates) so the four header buttons always fit on a phone.
  brand: { flexDirection: "row", alignItems: "center", gap: 10, flexShrink: 1, minWidth: 0 },
  brandText: { flexShrink: 1, minWidth: 0 },
  logo: { width: 38, height: 38, borderRadius: 10 },
  headerActions: { flexDirection: "row", alignItems: "center", gap: 0, flexShrink: 0 },
  headerButton: { width: 38, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  headerLink: { color: colors.primary, fontSize: 16 },
  settingsScroll: { maxHeight: "70%", flexGrow: 0, backgroundColor: "#fff", borderBottomWidth: 1, borderBottomColor: colors.border },
  settings: { padding: 16, gap: 12, maxWidth: 760, width: "100%", alignSelf: "center" },
  settingRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  settingLabel: { fontSize: 16, color: colors.text },
  settingLabelWrap: { flex: 1, marginRight: 12 },
  locationInput: { flex: 1, marginLeft: 16, borderWidth: 1, borderColor: colors.border, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8, fontSize: 15 },
  langChips: { flexDirection: "row", gap: 6, flexWrap: "wrap", justifyContent: "flex-end", flex: 1, marginLeft: 16 },
  langChip: { borderWidth: 1, borderColor: colors.border, borderRadius: 14, paddingHorizontal: 10, paddingVertical: 5 },
  langChipOn: { backgroundColor: colors.primarySoft, borderColor: colors.primary },
  langChipText: { color: colors.text, fontSize: 14 },
  langChipTextOn: { color: colors.primary, fontWeight: "600" },
  settingButton: { borderWidth: 1, borderColor: colors.primary, borderRadius: 10, padding: 12, alignItems: "center" },
  settingButtonText: { color: colors.primary, fontWeight: "600" },
  muted: { color: colors.muted },
  list: { padding: 16, gap: 8, maxWidth: 760, width: "100%", alignSelf: "center" },
  empty: { color: colors.muted, textAlign: "center", lineHeight: 20, maxWidth: 340 },
  welcome: { alignItems: "center", marginTop: 32, gap: 10, paddingHorizontal: 8 },
  welcomeIcon: { width: 64, height: 64, borderRadius: 32, backgroundColor: colors.primarySoft, alignItems: "center", justifyContent: "center" },
  welcomeTitle: { fontSize: 20, fontWeight: "700", color: colors.text },
  chips: { flexDirection: "row", flexWrap: "wrap", justifyContent: "center", gap: 8, marginTop: 8, maxWidth: 560 },
  chip: { borderWidth: 1, borderColor: colors.border, backgroundColor: "#fff", borderRadius: 18, paddingHorizontal: 14, paddingVertical: 9 },
  chipText: { color: colors.text, fontSize: 14 },
  speaking: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 6 },
  speakingText: { fontSize: 12, color: colors.primary, fontWeight: "600" },
  thinking: { paddingVertical: 10, marginTop: 8 },
  ring: { borderRadius: 22 },
  bubble: { padding: 12, borderRadius: 14, maxWidth: "85%" },
  userBubble: { backgroundColor: colors.bubbleUser, alignSelf: "flex-end", borderBottomRightRadius: 4 },
  botBubble: { backgroundColor: colors.bubbleBot, alignSelf: "flex-start", borderWidth: 1, borderColor: colors.border, borderBottomLeftRadius: 4 },
  urgentBubble: { backgroundColor: colors.urgentBg, borderColor: colors.danger },
  reminderBubble: { backgroundColor: colors.primarySoft, borderColor: colors.mint },
  doseRow: { flexDirection: "row", gap: 8, marginTop: 8 },
  doseButton: { flexDirection: "row", alignItems: "center", gap: 4, borderWidth: 1, borderColor: colors.primary, borderRadius: 14, paddingHorizontal: 10, paddingVertical: 5 },
  doseButtonOn: { backgroundColor: colors.primary },
  doseText: { color: colors.primary, fontWeight: "600", fontSize: 13 },
  doseTextOn: { color: "#fff" },
  userText: { color: "#fff", fontSize: 16 },
  photo: { width: 220, height: 220, borderRadius: 10, marginBottom: 6, backgroundColor: colors.border },
  attachment: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 16, paddingTop: 8, backgroundColor: "#fff", borderTopWidth: 1, borderTopColor: colors.border },
  attachmentThumb: { width: 44, height: 44, borderRadius: 8 },
  attachmentText: { flex: 1, color: colors.muted },
  photoButton: { backgroundColor: colors.primarySoft },
  botText: { color: colors.text, fontSize: 16, lineHeight: 22 },
  channel: { fontSize: 11, color: colors.muted, marginTop: 4 },
  inputRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    padding: 12,
    paddingBottom: 28,
    backgroundColor: "#fff",
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  input: {
    minWidth: 0, // web inputs otherwise keep their default width and push the send button off small screens
    flex: 1,
    minHeight: 44,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 22,
    paddingHorizontal: 16,
    paddingVertical: 10,
    fontSize: 16,
    backgroundColor: colors.bg,
  },
  iconButton: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center" },
  pressed: { opacity: 0.7, transform: [{ scale: 0.95 }] },
  send: { backgroundColor: colors.primary },
  sendIdle: { backgroundColor: colors.border },
  mic: { backgroundColor: colors.primarySoft },
  micActive: { backgroundColor: colors.danger },
  error: { color: colors.danger, paddingHorizontal: 16, paddingBottom: 8 },
  noteRow: { flexDirection: "row", alignItems: "flex-start", gap: 12, paddingRight: 16 },
  noteText: { flex: 1 },
  errorAction: { color: colors.primary, fontWeight: "600", paddingBottom: 8 },
  voiceStatus: { color: colors.muted, paddingHorizontal: 16, paddingBottom: 8 },
});

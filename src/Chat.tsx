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
import { Enter, PulseRing, Reveal, SwapIcon, ThinkingDots } from "./Motion";
import { HealthSync, useHealthSync } from "./useHealthSync";
import { HealthSettings } from "./HealthSettings";
import { HubPanel, HubTab } from "./HubPanel";
import { ChartCard, ChartData } from "./ChartCard";
import { AboutPanel } from "./AboutPanel";
import { Picked, pickPhoto, uploadPhoto } from "./photo";
import type { Id } from "../convex/_generated/dataModel";
import { Lang, LANGUAGE_NAMES, Strings, strings } from "./i18n";
import { pushSupported, usePush } from "./push";
import { AppointmentCard } from "./TelehealthCard";
import { DailyCard } from "./DailyCard";
import { ChatHistory } from "./ChatHistory";
import { Icon } from "./Icon";

// The panels that open under the header.
type Panel = "settings" | "hub" | "about";


// Camera or library: native asks which; web (and desktop browsers) only have the library.
function chooseSource(s: Strings): Promise<"library" | "camera" | null> {
  if (Platform.OS === "web") return Promise.resolve("library");
  return new Promise((resolve) =>
    Alert.alert(s.photoSourceTitle, s.photoSourceBody, [
      { text: s.takePhoto, onPress: () => resolve("camera") },
      { text: s.chooseLibrary, onPress: () => resolve("library") },
      { text: s.cancel, style: "cancel", onPress: () => resolve(null) },
    ]),
  );
}

// Suggestions on an empty chat: one per focus they picked in setup, then the general ones.
function startersFor(focus: string[], s: Strings) {
  const picked = focus.map((f) => s.startersByFocus[f as keyof Strings["startersByFocus"]]).filter(Boolean);
  return [...new Set([...picked, ...s.starters])].slice(0, 4);
}

export function Chat({ onRedoSetup }: { onRedoSetup: () => void }) {
  const messages = useQuery(api.chat.list);
  const me = useQuery(api.chat.me);
  const send = useMutation(api.chat.send);
  const newChat = useMutation(api.chats.start);
  const setTimeZone = useMutation(api.chat.setTimeZone);
  const logDose = useMutation(api.reminders.log);
  const uploadUrl = useMutation(api.chat.generateUploadUrl);
  const claimUpload = useMutation(api.chat.claimUpload);
  const [photo, setPhoto] = useState<Picked | null>(null);
  const [sending, setSending] = useState(false);
  const [text, setText] = useState("");
  const [panel, setPanel] = useState<Panel | null>(null);
  const [hubTab, setHubTab] = useState<HubTab>("home");
  const [history, setHistory] = useState(false);
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
        setNotice(s.limitNotice.replace("{n}", String(res.limit)));
      }
    } catch (e) {
      setText(value);
      setNotice((e as Error).message.replace(/^.*Uncaught Error: /, "").split("\n")[0]);
    }
  };

  const addPhoto = async () => {
    setNotice(null);
    try {
      const source = await chooseSource(s);
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
  // The weekly summary is a chat message, so its notification just opens the chat.
  const pushToken = usePush(s, (kind) =>
    kind === "weekly" ? setPanel(null) : openHub(kind === "reminders" ? "reminders" : kind === "appointments" ? "visits" : "care"),
  );

  // Medication reminders fire at local times, so the backend needs this device's time zone.
  useEffect(() => {
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    void setTimeZone({ timeZone, utcOffsetMin: -new Date().getTimezoneOffset() }).catch(() => {});
  }, [setTimeZone]);

  const startChat = async () => {
    voice.stopSpeaking();
    setNotice(null);
    setPanel(null);
    await newChat();
  };

  // Health tools take the whole screen; their Chat button comes back here.
  if (panel === "hub") {
    return (
      <Enter style={styles.container} from={24}>
        <HubPanel tab={hubTab} onTab={setHubTab} onClose={() => setPanel(null)} s={s} />
      </Enter>
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <View style={styles.header}>
        <View style={styles.brand}>
          <Pressable
            style={({ pressed }) => [styles.headerButton, pressed && styles.pressed]}
            onPress={() => setHistory(true)}
            accessibilityRole="button"
            accessibilityLabel={s.openHistory}
          >
            <Ionicons name="menu-outline" size={24} color={colors.text} />
          </Pressable>
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
              onPress={() => void startChat()}
              accessibilityRole="button"
              accessibilityLabel={s.newChat}
            >
              <Icon name="newChat" size={21} color={colors.text} />
            </Pressable>
          )}
          <Pressable
            style={({ pressed }) => [styles.dashButton, pressed && styles.pressed]}
            onPress={() => openHub("home")}
            accessibilityRole="button"
            accessibilityLabel={s.hubTitle}
          >
            <Icon name="dashboard" size={18} color={colors.onPrimary} />
          </Pressable>
          <Pressable
            style={({ pressed }) => [styles.headerButton, pressed && styles.pressed]}
            onPress={() => toggle("settings")}
            accessibilityRole="button"
            accessibilityLabel={panel === "settings" || panel === "about" ? s.closeSettings : s.settings}
          >
            <SwapIcon id={panel === "settings" || panel === "about" ? "close" : "settings"}>
              <Ionicons name={panel === "settings" || panel === "about" ? "close" : "settings-outline"} size={22} color={colors.text} />
            </SwapIcon>
          </Pressable>
        </View>
      </View>
      <ChatHistory open={history} s={s} onClose={() => setHistory(false)} />

      <Reveal open={panel === "about"} style={styles.aboutWrap}>
        <AboutPanel s={s} />
      </Reveal>
      <Reveal open={panel === "settings" && !!me} style={styles.settingsWrap}>
        {me && <Settings me={me} s={s} pushToken={pushToken} health={health} onOpenAbout={() => setPanel("about")} onRedoSetup={onRedoSetup} />}
      </Reveal>

      {panel === null && !!messages?.length && <DailyCard s={s} inChat />}
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
                {startersFor(me?.focus ?? [], s).map((q) => (
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
                (item.kind === "reminder" || item.kind === "checkin" || item.kind === "appointment" || item.kind === "summary") && styles.reminderBubble,
                !!item.charts?.length && styles.chartBubble,
              ]}
            >
              {item.imageUrl && (
                <Image
                  source={{ uri: item.imageUrl }}
                  style={styles.photo}
                  resizeMode="cover"
                  accessibilityLabel={s.photoYouSent}
                />
              )}
              {item.role === "user" ? (
                !!item.text && <Text style={styles.userText}>{item.text}</Text>
              ) : (
                <Markdown text={item.text} style={styles.botText} />
              )}
              {item.charts?.map((c: ChartData, i: number) => <ChartCard key={i} chart={c} s={s} />)}
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
                <Text style={styles.channel}>{item.voice ? s.voiceViaTelegram : s.viaTelegram}</Text>
              )}
              {item._id === voice.speakingId && (
                <Pressable
                  style={styles.speaking}
                  onPress={voice.stopSpeaking}
                  accessibilityRole="button"
                  accessibilityLabel={s.speaking}
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
          <Text style={styles.attachmentText}>{sending ? s.uploadingPhoto : s.photoAttached}</Text>
          {!sending && (
            <Pressable onPress={() => setPhoto(null)} accessibilityRole="button" accessibilityLabel={s.removePhoto}>
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
          accessibilityLabel={s.addPhoto}
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
            accessibilityLabel={voice.mic === "recording" ? s.stopAndSend : s.recordVoice}
            accessibilityState={{ busy: voice.mic === "asking" || voice.mic === "transcribing" }}
          >
            {voice.mic === "asking" || voice.mic === "transcribing" ? (
              <ActivityIndicator color={colors.primary} />
            ) : (
              <SwapIcon id={voice.mic === "recording" ? "stop" : "mic"}>
                {voice.mic === "recording" ? <Ionicons name="stop" size={20} color="#fff" /> : <Ionicons name="mic" size={22} color={colors.primary} />}
              </SwapIcon>
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
          accessibilityLabel={s.sendMessage}
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
              <Text style={styles.errorAction}>{s.openSettings}</Text>
            </Pressable>
          )}
          <Pressable onPress={voice.dismissError} accessibilityRole="button" accessibilityLabel={s.dismiss}>
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
  onRedoSetup,
}: {
  me: {
    email: string | null;
    telegramLinked: boolean;
    location: string;
    language: string;
    notifications: { reminders: boolean; appointments: boolean };
    checkins: boolean;
    weeklySummary: boolean;
  };
  s: Strings;
  pushToken: { current: string | null };
  health: HealthSync;
  onOpenAbout: () => void;
  onRedoSetup: () => void;
}) {
  const setLanguage = useMutation(api.chat.setLanguage);
  const setPushPreference = useMutation(api.push.setPreference);
  const unregisterPush = useMutation(api.push.unregister);
  const setCheckins = useMutation(api.checkins.setEnabled);
  const setWeekly = useMutation(api.weekly.setEnabled);
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
        <Text style={styles.settingLabel}>{s.languageLabel}</Text>
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
        <Text style={styles.settingLabel}>{s.locationLabel}</Text>
        <TextInput
          style={styles.locationInput}
          placeholder={s.locationPlaceholder}
          value={location}
          onChangeText={setLocationText}
          onBlur={saveLocation}
          onSubmitEditing={saveLocation}
          returnKeyType="done"
        />
      </View>
      <Pressable style={styles.settingButton} onPress={openTelegram}>
        <Text style={styles.settingButtonText}>
          {me.telegramLinked ? s.telegramLinked : s.telegramLink}
        </Text>
      </Pressable>
      {error && <Text style={styles.error}>{error}</Text>}
      <HealthSettings health={health} s={s} />
      <Pressable style={styles.settingButton} onPress={onOpenAbout} accessibilityRole="button">
        <Text style={styles.settingButtonText}>{s.aboutMe}</Text>
      </Pressable>
      <Pressable style={styles.settingButton} onPress={onRedoSetup} accessibilityRole="button">
        <Text style={styles.settingButtonText}>{s.redoSetup}</Text>
      </Pressable>
      <View style={styles.settingRow}>
        <Text style={[styles.settingLabel, styles.settingLabelWrap]}>{s.dailyCheckins}</Text>
        <Switch value={me.checkins} onValueChange={(enabled) => void setCheckins({ enabled })} />
      </View>
      <View style={styles.settingRow}>
        <Text style={[styles.settingLabel, styles.settingLabelWrap]}>{s.weeklySummary}</Text>
        <Switch value={me.weeklySummary} onValueChange={(enabled) => void setWeekly({ enabled })} />
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
        <Text style={styles.headerLink}>{s.signOut}</Text>
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
  brand: { flexDirection: "row", alignItems: "center", gap: 6, flexShrink: 1, minWidth: 0 },
  brandText: { flexShrink: 1, minWidth: 0 },
  logo: { width: 38, height: 38, borderRadius: 10 },
  headerActions: { flexDirection: "row", alignItems: "center", gap: 0, flexShrink: 0 },
  headerButton: { width: 38, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  // Health tools: the one filled button, so it stands out from the chat's own controls.
  dashButton: { width: 38, height: 38, borderRadius: 12, alignItems: "center", justifyContent: "center", backgroundColor: colors.primary, marginHorizontal: 4 },
  headerLink: { color: colors.primary, fontSize: 16 },
  // Above the chat while it drops open, so it slides over the messages rather than pushing them.
  settingsWrap: { zIndex: 5, maxHeight: "70%" },
  aboutWrap: { zIndex: 5, maxHeight: "80%" },
  settingsScroll: { flexGrow: 0, flexShrink: 1, backgroundColor: "#fff", borderBottomWidth: 1, borderBottomColor: colors.border },
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
  // A chart needs the width.
  chartBubble: { width: "85%" },
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

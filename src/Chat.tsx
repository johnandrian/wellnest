import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  KeyboardAvoidingView,
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from "react-native";
import { useMutation, useQuery } from "convex/react";
import { Ionicons } from "@expo/vector-icons";
import * as Clipboard from "expo-clipboard";
import { api } from "../convex/_generated/api";
import { colors, floatingBar, softShadow, radius, themed, themeVersion } from "./theme";
import { errorText, showToast } from "./feedback";
import { useVoice } from "./useVoice";
import { Markdown } from "./Markdown";
import { Enter, PulseRing, Reveal, SwapIcon, ThinkingDots } from "./Motion";
import { SingingBrand, SingingMark } from "./SingingMark";
import { HealthSync, useHealthSync } from "./useHealthSync";
import { HubPanel, HubTab } from "./HubPanel";
import { ChartCard, ChartData } from "./ChartCard";
import { AboutPanel } from "./AboutPanel";
import { SettingsPanel } from "./SettingsPanel";
import { Picked, pickPhoto, uploadPhoto } from "./photo";
import type { Id } from "../convex/_generated/dataModel";
import { Strings, strings } from "./i18n";
import { usePush } from "./push";
import { AppointmentCard } from "./TelehealthCard";
import { DailyCard } from "./DailyCard";
import { ChatHistory } from "./ChatHistory";
import { JoinPrompt } from "./JoinPrompt";
import { Icon } from "./Icon";
import { Tour, TourStop } from "./Tour";
import { SideSheet, SIDE_SHEET_MIN_WIDTH } from "./SideSheet";
import { barTop, useInsets } from "./safeArea";
import { formatDate, formatTime } from "./format";

// The two screens: the dashboard (Health tools, where the app opens) and the chat. Moving between them slides
// sideways, the dashboard from the left and the chat from the right.
type Screen = "hub" | "chat";
// The panels that drop open under either screen's header.
type Panel = "settings" | "about";


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

// The divider above the first message of each day: Today, Yesterday, or the date.
function dayLabel(at: number, s: Strings) {
  const d = new Date(at);
  const today = new Date();
  const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return s.chatToday;
  if (d.toDateString() === yesterday.toDateString()) return s.chatYesterday;
  return formatDate(at, s, { weekday: "long", month: "long", day: "numeric", ...(d.getFullYear() !== today.getFullYear() && { year: "numeric" }) });
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
  const stopReply = useMutation(api.chat.stop);
  const retryReply = useMutation(api.chat.retry);

  const logDose = useMutation(api.reminders.log);
  const snoozeDose = useMutation(api.reminders.snooze);
  const uploadUrl = useMutation(api.chat.generateUploadUrl);
  const claimUpload = useMutation(api.chat.claimUpload);
  const [photo, setPhoto] = useState<Picked | null>(null);
  // A sent photo opened full size.
  const [viewing, setViewing] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [text, setText] = useState("");
  const [screen, setScreen] = useState<Screen>("hub");
  const [panel, setPanel] = useState<Panel | null>(null);
  const [hubTab, setHubTab] = useState<HubTab>("home");
  const [history, setHistory] = useState(false);
  const { width } = useWindowDimensions();
  const narrow = width < 440;
  const insets = useInsets();
  // In a wide browser window Settings opens over the right half; on phones it drops down full width under the header.
  const side = Platform.OS === "web" && width >= SIDE_SHEET_MIN_WIDTH;
  const openHub = (tab: HubTab) => {
    setHubTab(tab);
    setScreen("hub");
    setPanel(null);
  };
  const openChat = () => {
    setScreen("chat");
    setPanel(null);
  };
  // The first-time tour (./Tour.tsx): once after setup, and again from Settings.
  const [touring, setTouring] = useState(false);
  const [tourStep, setTourStep] = useState(0);
  const tourDone = useMutation(api.onboarding.tourDone);
  const startTour = () => {
    setTourStep(0);
    setTouring(true);
  };
  useEffect(() => {
    if (me && !me.toured) startTour();
  }, [me?.toured === false]);
  const showStop = (stop: TourStop) => {
    if (stop.screen === "chat") openChat();
    else if (stop.screen === "settings") {
      setScreen("hub");
      setHubTab("home");
      setPanel("settings");
    } else openHub(stop.tab);
  };
  const endTour = () => {
    setTouring(false);
    openHub("home");
    if (me && !me.toured) void tourDone().catch(() => {});
  };
  // "about" opens from Settings, so the settings button closes it too.
  const toggle = (p: Panel) => setPanel((open) => (open === p || (p === "settings" && open === "about") ? null : p));
  const [notice, setNotice] = useState<string | null>(null);
  const listRef = useRef<FlatList>(null);
  // Follow new messages only while the list is already at the bottom; scrolled up reading, a "New messages"
  // button appears instead of the list jumping away.
  const atBottom = useRef(true);
  const [behind, setBehind] = useState(false);
  const toBottom = (animated = true) => {
    atBottom.current = true;
    setBehind(false);
    listRef.current?.scrollToEnd({ animated });
  };

  const last = messages?.[messages.length - 1];
  // A reply is being written: the last message is the user's and they haven't stopped it.
  const waiting = last?.role === "user" && !last.stopped;
  const copy = (text: string) =>
    void Clipboard.setStringAsync(text).then(
      () => showToast(s.copied),
      (e) => showToast(errorText(e)),
    );
  const retry = (id: Id<"messages">) => void retryReply({ id }).catch((e) => setNotice(errorText(e)));

  // `spoken`: it came from the mic, so the reply is read aloud.
  const submit = async (value = text, attached: Picked | null = photo, spoken = false) => {
    if (!value.trim() && !attached) return;
    setText("");
    setNotice(null);
    // Sending always brings the conversation back to the newest message.
    toBottom();
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
      setNotice(errorText(e));
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
  // The weekly summary and the flare forecast are chat messages, so their notifications just open the chat;
  // a Care Circle alert opens the Care Circle, and an agent proposal opens the Action Inbox.
  const pushToken = usePush(s, (kind) =>
    kind === "weekly" || kind === "forecast"
      ? openChat()
      : openHub(kind === "reminders" ? "reminders" : kind === "appointments" ? "visits" : kind === "circle" ? "circle" : kind === "agent" ? "agent" : "care"),
  );


  const startChat = async () => {
    voice.stopSpeaking();
    setNotice(null);
    setPanel(null);
    await newChat();
  };

  const settings = me && (
    <SettingsPanel
      me={me}
      s={s}
      pushToken={pushToken}
      health={health}
      onOpenAbout={() => setPanel("about")}
      onRedoSetup={onRedoSetup}
      onTour={() => {
        setPanel(null);
        startTour();
      }}
    />
  );
  // Settings and "What Wellnest knows about me": under whichever screen's header, or in the side sheet.
  const panels = side ? null : (
    <>
      <Reveal open={panel === "about"} style={styles.aboutWrap}>
        <AboutPanel s={s} />
      </Reveal>
      <Reveal open={panel === "settings" && !!me} style={styles.settingsWrap}>
        {settings}
      </Reveal>
    </>
  );

  const chat = (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <View style={[styles.header, barTop(insets.top)]}>
        <View style={styles.brand}>
          <Pressable
            style={({ pressed }) => [styles.headerButton, pressed && styles.pressed]}
            onPress={() => setHistory(true)}
            accessibilityRole="button"
            accessibilityLabel={s.openHistory}
          >
            <Ionicons name="menu-outline" size={24} color={colors.text} />
          </Pressable>
          {/* One line: the name with "not a doctor" beside it, so the note stays in view. */}
          <SingingBrand style={styles.singer}>
            <SingingMark size={30} />
            <Text style={styles.headerTitle} numberOfLines={1}>
              Wellnest <Text style={styles.headerNote}>· {s.notDoctor}</Text>
            </Text>
          </SingingBrand>
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
            style={({ pressed }) => [styles.dashButton, narrow && styles.dashButtonNarrow, pressed && styles.pressed]}
            onPress={() => openHub("home")}
            accessibilityRole="button"
            accessibilityLabel={s.dashboard}
          >
            <Icon name="dashboard" size={18} color={colors.onPrimary} />
            {/* Like the dashboard's Chat button: named, and just the icon on a phone so the header still fits. */}
            {!narrow && <Text style={styles.dashText}>{s.dashboard}</Text>}
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
      {panels}

      {panel === null && !!messages?.length && <DailyCard s={s} inChat />}
      {messages === undefined ? (
        <ActivityIndicator style={{ flex: 1 }} />
      ) : (
        <FlatList
          ref={listRef}
          data={messages}
          extraData={themeVersion()}
          keyExtractor={(m) => m._id}
          contentContainerStyle={styles.list}
          onContentSizeChange={() => (atBottom.current ? listRef.current?.scrollToEnd({ animated: true }) : setBehind(true))}
          onScroll={(e) => {
            const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
            const near = contentOffset.y + layoutMeasurement.height >= contentSize.height - 80;
            atBottom.current = near;
            if (near && behind) setBehind(false);
          }}
          scrollEventThrottle={100}
          ListEmptyComponent={
            <View style={styles.welcome}>
              {/* The big mic records, like the one by the message box. */}
              <View>
                {voice.mic === "recording" && <PulseRing color={colors.danger} style={styles.welcomeRing} />}
                <Pressable
                  style={({ pressed }) => [styles.welcomeIcon, voice.mic === "recording" && styles.micActive, pressed && styles.pressed]}
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
                      <Ionicons name={voice.mic === "recording" ? "stop" : "mic"} size={30} color={voice.mic === "recording" ? colors.onDanger : colors.primary} />
                    </SwapIcon>
                  )}
                </Pressable>
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
          renderItem={({ item, index }) => (
            <>
            {(index === 0 || new Date(messages[index - 1]._creationTime).toDateString() !== new Date(item._creationTime).toDateString()) && (
              <View style={styles.dayRow} accessibilityRole="header">
                <View style={styles.dayLine} />
                <Text style={styles.dayText}>{dayLabel(item._creationTime, s)}</Text>
                <View style={styles.dayLine} />
              </View>
            )}
            {/* Long press (or the screen reader's Copy action) copies the message's text. */}
            <Pressable
              onLongPress={item.text ? () => copy(item.text) : undefined}
              delayLongPress={350}
              accessibilityActions={item.text ? [{ name: "copy", label: s.copy }] : undefined}
              onAccessibilityAction={(e) => e.nativeEvent.actionName === "copy" && copy(item.text)}
              style={[
                styles.bubble,
                item.role === "user" ? styles.userBubble : styles.botBubble,
                item.urgent && styles.urgentBubble,
                (item.kind === "reminder" || item.kind === "checkin" || item.kind === "appointment" || item.kind === "summary" || item.kind === "forecast" || item.kind === "circle") && styles.reminderBubble,
                !!item.charts?.length && styles.chartBubble,
              ]}
            >
              {item.imageUrl && (
                <Pressable onPress={() => setViewing(item.imageUrl)} accessibilityRole="imagebutton" accessibilityLabel={`${s.photoYouSent}. ${s.photoOpen}`}>
                  <Image source={{ uri: item.imageUrl }} style={styles.photo} resizeMode="cover" />
                </Pressable>
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
                          color={on ? colors.onPrimary : colors.primary}
                        />
                        <Text style={[styles.doseText, on && styles.doseTextOn]}>{status === "taken" ? s.taken : s.skip}</Text>
                      </Pressable>
                    );
                  })}
                  {!item.reminder.status && (
                    <Pressable
                      style={styles.doseButton}
                      hitSlop={8}
                      onPress={() =>
                        void snoozeDose({ medicationId: item.reminder!.medicationId, dueAt: item.reminder!.dueAt }).then(
                          () => showToast(s.snoozed),
                          (e) => showToast(errorText(e)),
                        )
                      }
                      accessibilityRole="button"
                      accessibilityLabel={s.snooze}
                    >
                      <Ionicons name="alarm-outline" size={15} color={colors.primary} />
                      <Text style={styles.doseText}>{s.snoozeShort}</Text>
                    </Pressable>
                  )}
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
            </Pressable>
            {index === messages.length - 1 && (item.failed || (item.role === "user" && item.stopped)) && (
              <View style={[styles.retryRow, item.role === "user" && styles.retryRowUser]}>
                {item.stopped && <Text style={styles.retryNote}>{s.replyStopped}</Text>}
                <Pressable style={({ pressed }) => [styles.retry, pressed && styles.pressed]} onPress={() => retry(item._id)} accessibilityRole="button">
                  <Ionicons name="refresh" size={15} color={colors.primary} />
                  <Text style={styles.doseText}>{s.tryAgain}</Text>
                </Pressable>
              </View>
            )}
            {/* The time once per run: under the last message a side sends within a few minutes. */}
            {(index === messages.length - 1 ||
              messages[index + 1].role !== item.role ||
              messages[index + 1]._creationTime - item._creationTime > 5 * 60_000) && (
              <Text style={[styles.time, item.role === "user" && styles.timeUser]}>{formatTime(item._creationTime, s)}</Text>
            )}
            </>
          )}
          ListFooterComponent={
            waiting ? (
              <View style={styles.thinkingRow}>
                <View style={[styles.bubble, styles.botBubble, styles.thinking]}>
                  <ThinkingDots />
                </View>
                {last?.channel === "app" && (
                  <Pressable
                    style={({ pressed }) => [styles.retry, pressed && styles.pressed]}
                    onPress={() => {
                      voice.stopSpeaking();
                      void stopReply().catch((e) => setNotice(errorText(e)));
                    }}
                    accessibilityRole="button"
                    accessibilityLabel={s.stopReply}
                  >
                    <Ionicons name="stop-circle-outline" size={16} color={colors.primary} />
                    <Text style={styles.doseText}>{s.stop}</Text>
                  </Pressable>
                )}
              </View>
            ) : undefined
          }
        />
      )}

      {behind && (
        <Enter style={styles.jumpWrap} from={8}>
          <Pressable style={({ pressed }) => [styles.jump, pressed && styles.pressed]} onPress={() => toBottom()} accessibilityRole="button">
            <Ionicons name="arrow-down" size={16} color={colors.onPrimary} />
            <Text style={styles.jumpText}>{s.newMessages}</Text>
          </Pressable>
        </Enter>
      )}
      {photo && (
        <View style={styles.attachment}>
          <Image source={{ uri: photo.uri }} style={styles.attachmentThumb} />
          <Text style={styles.attachmentText}>{sending ? s.uploadingPhoto : s.photoAttached}</Text>
          {!sending && (
            <Pressable hitSlop={12} onPress={() => setPhoto(null)} accessibilityRole="button" accessibilityLabel={s.removePhoto}>
              <Ionicons name="close-circle" size={22} color={colors.muted} />
            </Pressable>
          )}
        </View>
      )}
      <View style={[styles.inputRow, { marginBottom: 10 + insets.bottom }]}>
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
                {voice.mic === "recording" ? <Ionicons name="stop" size={20} color={colors.onDanger} /> : <Ionicons name="mic" size={22} color={colors.primary} />}
              </SwapIcon>
            )}
          </Pressable>
        </View>
        {/* Grows with the message up to about five lines, then scrolls. On a computer Enter sends and Shift+Enter
            starts a new line; on a phone the return key adds a line and the arrow sends. */}
        <TextInput
          style={styles.input}
          placeholder={photo ? s.placeholderPhoto : s.placeholderVoice}
          placeholderTextColor={colors.muted}
          accessibilityLabel={s.messageLabel}
          value={text}
          onChangeText={setText}
          multiline
          onKeyPress={
            Platform.OS === "web"
              ? (e) => {
                  const k = e.nativeEvent as unknown as { key: string; shiftKey?: boolean; isComposing?: boolean };
                  if (k.key === "Enter" && !k.shiftKey && !k.isComposing) {
                    e.preventDefault();
                    void submit();
                  }
                }
              : undefined
          }
        />
        <Pressable
          style={({ pressed }) => [styles.iconButton, styles.send, !text.trim() && !photo && styles.sendIdle, pressed && styles.pressed]}
          onPress={() => submit()}
          disabled={(!text.trim() && !photo) || sending}
          accessibilityRole="button"
          accessibilityLabel={s.sendMessage}
        >
          <Ionicons name="arrow-up" size={22} color={!text.trim() && !photo ? colors.muted : colors.onPrimary} />
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
      <Modal visible={viewing !== null} transparent animationType="fade" onRequestClose={() => setViewing(null)}>
        <View style={styles.viewer}>
          {viewing && <Image source={{ uri: viewing }} style={styles.viewerImage} resizeMode="contain" accessibilityLabel={s.photoYouSent} />}
          <Pressable style={[styles.viewerClose, { top: 12 + insets.top }]} onPress={() => setViewing(null)} accessibilityRole="button" accessibilityLabel={s.close}>
            <Ionicons name="close" size={26} color={colors.onScrim} />
          </Pressable>
        </View>
      </Modal>
      {voice.error && (
        <View style={styles.noteRow}>
          <Text style={[styles.error, styles.noteText]} accessibilityLiveRegion="assertive">
            {voice.error.text}
          </Text>
          {voice.error.openSettings && (
            <Pressable hitSlop={12} onPress={() => void Linking.openSettings()} accessibilityRole="link">
              <Text style={styles.errorAction}>{s.openSettings}</Text>
            </Pressable>
          )}
          <Pressable hitSlop={12} onPress={voice.dismissError} accessibilityRole="button" accessibilityLabel={s.dismiss}>
            <Text style={styles.errorAction}>✕</Text>
          </Pressable>
        </View>
      )}
    </KeyboardAvoidingView>
  );

  return (
    <View style={styles.container}>
      {screen === "hub" ? (
        <Enter key="hub" style={styles.container} fromX={-28}>
          <HubPanel tab={hubTab} onTab={setHubTab} onClose={openChat} s={s} settingsOpen={panel !== null} onSettings={() => toggle("settings")}>
            {panels}
          </HubPanel>
        </Enter>
      ) : (
        <Enter key="chat" style={styles.container} fromX={28}>
          {chat}
        </Enter>
      )}
      {side && (
        <SideSheet open={panel !== null && !!me} title={panel === "about" ? s.aboutMe : s.settings} closeLabel={s.closeSettings} onClose={() => setPanel(null)}>
          {panel === "about" ? <AboutPanel s={s} /> : settings}
        </SideSheet>
      )}
      <JoinPrompt s={s} onOpenCircle={() => openHub("circle")} />
      <Tour open={touring} step={tourStep} s={s} onStep={setTourStep} onShow={showStop} onEnd={endTour} />
    </View>
  );
}

const styles = themed(() => ({
  container: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 16,
    backgroundColor: colors.surface,
    // Floats below the status bar / notch on a phone (barTop in ./safeArea.ts).
    ...floatingBar(),
  },
  headerTitle: { fontSize: 18, fontWeight: "700", color: colors.text, flexShrink: 1 },
  headerNote: { fontSize: 13, fontWeight: "400", color: colors.muted },
  // The title side shrinks (subtitle truncates) so the four header buttons always fit on a phone.
  brand: { flexDirection: "row", alignItems: "center", gap: 6, flexShrink: 1, minWidth: 0 },
  // The mark and its words: hovering anywhere on them makes the bird sing (src/SingingMark.tsx).
  singer: { flexDirection: "row", alignItems: "center", gap: 6, flexShrink: 1, minWidth: 0 },
  logo: { width: 38, height: 38 },
  headerActions: { flexDirection: "row", alignItems: "center", gap: 0, flexShrink: 0 },
  headerButton: { width: 38, height: 40, borderRadius: radius.pill, alignItems: "center", justifyContent: "center" },
  // Health tools: the one filled button, so it stands out from the chat's own controls.
  dashButton: { flexDirection: "row", alignItems: "center", gap: 6, minHeight: 40, borderRadius: radius.pill, paddingHorizontal: 14, backgroundColor: colors.primary, marginHorizontal: 4 },
  dashButtonNarrow: { width: 40, paddingHorizontal: 0, justifyContent: "center" },
  dashText: { color: colors.onPrimary, fontWeight: "700", fontSize: 14 },
  // Above the chat while it drops open, so it slides over the messages rather than pushing them.
  settingsWrap: { zIndex: 5, maxHeight: "70%" },
  aboutWrap: { zIndex: 5, maxHeight: "80%" },
  list: { padding: 16, gap: 8, maxWidth: 760, width: "100%", alignSelf: "center" },
  empty: { color: colors.muted, textAlign: "center", lineHeight: 20, maxWidth: 340, fontSize: 14 },
  welcome: { alignItems: "center", marginTop: 32, gap: 10, paddingHorizontal: 8 },
  welcomeIcon: { width: 72, height: 72, borderRadius: 36, backgroundColor: colors.primarySoft, alignItems: "center", justifyContent: "center" },
  welcomeRing: { borderRadius: 36 },
  welcomeTitle: { fontSize: 20, fontWeight: "700", color: colors.text },
  chips: { flexDirection: "row", flexWrap: "wrap", justifyContent: "center", gap: 8, marginTop: 8, maxWidth: 560 },
  chip: { borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, borderRadius: radius.pill, paddingHorizontal: 14, paddingVertical: 9 },
  chipText: { color: colors.text, fontSize: 14 },
  speaking: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 6 },
  dayRow: { flexDirection: "row", alignItems: "center", gap: 10, marginVertical: 8 },
  dayLine: { flex: 1, height: 1, backgroundColor: colors.hairline },
  dayText: { color: colors.muted, fontSize: 12, fontWeight: "600" },
  time: { color: colors.muted, fontSize: 11, marginTop: -4, marginLeft: 6 },
  timeUser: { alignSelf: "flex-end", marginLeft: 0, marginRight: 6 },
  // The full-size photo: always on a dark backdrop, in light and dark mode alike.
  viewer: { flex: 1, backgroundColor: colors.scrim, alignItems: "center", justifyContent: "center" },
  viewerImage: { width: "100%", height: "100%" },
  viewerClose: { position: "absolute", right: 12, width: 48, height: 48, borderRadius: 24, alignItems: "center", justifyContent: "center", backgroundColor: colors.scrimButton },
  speakingText: { fontSize: 12, color: colors.primary, fontWeight: "600" },
  thinking: { paddingVertical: 10 },
  thinkingRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 8 },
  retryRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  retryRowUser: { alignSelf: "flex-end" },
  retryNote: { color: colors.muted, fontSize: 13 },
  retry: { flexDirection: "row", alignItems: "center", gap: 4, minHeight: 36, borderWidth: 1, borderColor: colors.primary, borderRadius: radius.pill, paddingHorizontal: 12 },
  ring: { borderRadius: 33 },
  bubble: { padding: 12, borderRadius: 21, maxWidth: "85%" },
  userBubble: { backgroundColor: colors.bubbleUser, alignSelf: "flex-end", borderBottomRightRadius: 4 },
  botBubble: { backgroundColor: colors.bubbleBot, alignSelf: "flex-start", borderWidth: 1, borderColor: colors.border, borderBottomLeftRadius: 4 },
  urgentBubble: { backgroundColor: colors.urgentBg, borderColor: colors.danger },
  reminderBubble: { backgroundColor: colors.primarySoft, borderColor: colors.mint },
  // A chart needs the width.
  chartBubble: { width: "85%" },
  doseRow: { flexDirection: "row", gap: 8, marginTop: 8 },
  doseButton: { flexDirection: "row", alignItems: "center", gap: 4, minHeight: 36, borderWidth: 1, borderColor: colors.primary, borderRadius: radius.pill, paddingHorizontal: 12, paddingVertical: 5 },
  doseButtonOn: { backgroundColor: colors.primary },
  doseText: { color: colors.primary, fontWeight: "600", fontSize: 13 },
  doseTextOn: { color: colors.onPrimary },
  userText: { color: colors.onPrimary, fontSize: 16 },
  photo: { width: 220, height: 220, borderRadius: 15, marginBottom: 6, backgroundColor: colors.border },
  attachment: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 16, paddingTop: 8, backgroundColor: colors.surface, borderTopWidth: 1, borderTopColor: colors.border },
  attachmentThumb: { width: 44, height: 44, borderRadius: 12 },
  attachmentText: { flex: 1, color: colors.muted, fontSize: 14 },
  photoButton: { backgroundColor: colors.primarySoft },
  botText: { color: colors.text, fontSize: 16, lineHeight: 22 },
  channel: { fontSize: 11, color: colors.muted, marginTop: 4 },
  jumpWrap: { alignItems: "center", marginTop: -48, marginBottom: 8, zIndex: 2 },
  jump: { flexDirection: "row", alignItems: "center", gap: 6, minHeight: 40, paddingHorizontal: 16, borderRadius: radius.pill, backgroundColor: colors.primary, ...softShadow() },
  jumpText: { color: colors.onPrimary, fontWeight: "700", fontSize: 14 },
  inputRow: {
    flexDirection: "row",
    // The buttons stay at the bottom as the message box grows.
    alignItems: "flex-end",
    gap: 8,
    padding: 12,
    backgroundColor: colors.surface,
    // The message box floats like the top bar, with room below it (plus the home indicator, added where it is drawn).
    marginHorizontal: 10,
    marginTop: 4,
    marginBottom: 10,
    borderRadius: 32,
    borderWidth: 1,
    borderColor: colors.hairline,
    ...softShadow(),
  },
  input: {
    color: colors.text,
    minWidth: 0, // web inputs otherwise keep their default width and push the send button off small screens
    flex: 1,
    minHeight: 44,
    maxHeight: 132,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 22,
    paddingHorizontal: 16,
    paddingTop: 11,
    paddingBottom: 11,
    fontSize: 16,
    lineHeight: 21,
    textAlignVertical: "top",
    backgroundColor: colors.bg,
  },
  iconButton: { width: 44, height: 44, borderRadius: radius.pill, alignItems: "center", justifyContent: "center" },
  pressed: { opacity: 0.7, transform: [{ scale: 0.95 }] },
  send: { backgroundColor: colors.primary },
  sendIdle: { backgroundColor: colors.border },
  mic: { backgroundColor: colors.primarySoft },
  micActive: { backgroundColor: colors.danger },
  error: { color: colors.danger, paddingHorizontal: 16, paddingBottom: 8, fontSize: 14 },
  noteRow: { flexDirection: "row", alignItems: "flex-start", gap: 12, paddingRight: 16 },
  noteText: { flex: 1 },
  errorAction: { color: colors.primary, fontWeight: "600", paddingBottom: 8, fontSize: 14 },
  voiceStatus: { color: colors.muted, paddingHorizontal: 16, paddingBottom: 8, fontSize: 14 },
}));

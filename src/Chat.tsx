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
  Switch,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from "react-native";
import { useMutation, useQuery } from "convex/react";
import { Ionicons } from "@expo/vector-icons";
import { useAuthActions } from "@convex-dev/auth/react";
import { api } from "../convex/_generated/api";
import { colors, floatingBar, isSoft, softShadow, pillish, radius, round, TEXT_SIZES, themed, themeVersion } from "./theme";
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
import { JoinPrompt } from "./JoinPrompt";
import { Icon } from "./Icon";
import { Tour, TourStop } from "./Tour";
import { SideSheet, SIDE_SHEET_MIN_WIDTH } from "./SideSheet";

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

  const logDose = useMutation(api.reminders.log);
  const uploadUrl = useMutation(api.chat.generateUploadUrl);
  const claimUpload = useMutation(api.chat.claimUpload);
  const [photo, setPhoto] = useState<Picked | null>(null);
  const [sending, setSending] = useState(false);
  const [text, setText] = useState("");
  const [screen, setScreen] = useState<Screen>("hub");
  const [panel, setPanel] = useState<Panel | null>(null);
  const [hubTab, setHubTab] = useState<HubTab>("home");
  const [history, setHistory] = useState(false);
  const { width } = useWindowDimensions();
  const narrow = width < 440;
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
  // The weekly summary and the flare forecast are chat messages, so their notifications just open the chat;
  // a Care Circle alert opens the Care Circle.
  const pushToken = usePush(s, (kind) =>
    kind === "weekly" || kind === "forecast"
      ? openChat()
      : openHub(kind === "reminders" ? "reminders" : kind === "appointments" ? "visits" : kind === "circle" ? "circle" : "care"),
  );


  const startChat = async () => {
    voice.stopSpeaking();
    setNotice(null);
    setPanel(null);
    await newChat();
  };

  const settings = me && (
    <Settings
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
                (item.kind === "reminder" || item.kind === "checkin" || item.kind === "appointment" || item.kind === "summary" || item.kind === "forecast" || item.kind === "circle") && styles.reminderBubble,
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
                          color={on ? colors.onPrimary : colors.primary}
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
                {voice.mic === "recording" ? <Ionicons name="stop" size={20} color={colors.onDanger} /> : <Ionicons name="mic" size={22} color={colors.primary} />}
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

function Settings({
  me,
  s,
  pushToken,
  health,
  onOpenAbout,
  onRedoSetup,
  onTour,
}: {
  me: {
    email: string | null;
    telegramLinked: boolean;
    location: string;
    language: string;
    appearance: { theme: "system" | "light" | "dark"; textSize: number };
    notifications: { reminders: boolean; appointments: boolean };
    checkins: boolean;
    weeklySummary: boolean;
    flareForecast: boolean;
    airAlerts: boolean;
    units: { glucose: "mg/dL" | "mmol/L"; weight: "lb" | "kg" };
  };
  s: Strings;
  pushToken: { current: string | null };
  health: HealthSync;
  onOpenAbout: () => void;
  onRedoSetup: () => void;
  onTour: () => void;
}) {
  const setLanguage = useMutation(api.chat.setLanguage);
  const setAppearance = useMutation(api.chat.setAppearance);
  const setPushPreference = useMutation(api.push.setPreference);
  const unregisterPush = useMutation(api.push.unregister);
  const setCheckins = useMutation(api.checkins.setEnabled);
  const setWeekly = useMutation(api.weekly.setEnabled);
  const setForecast = useMutation(api.forecast.setEnabled);
  const setUnits = useMutation(api.chat.setUnits);
  const setAirAlerts = useMutation(api.forecast.setAirAlerts);
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
        <Text style={styles.settingLabel}>{s.appearanceLabel}</Text>
        <View style={styles.langChips} accessibilityRole="radiogroup">
          {(
            [
              ["system", "phone-portrait-outline", s.themeSystem],
              ["light", "sunny-outline", s.themeLight],
              ["dark", "moon-outline", s.themeDark],
            ] as const
          ).map(([theme, icon, label]) => {
            const on = me.appearance.theme === theme;
            return (
              <Pressable
                key={theme}
                style={[styles.langChip, styles.iconChip, on && styles.langChipOn]}
                onPress={() => void setAppearance({ appearance: { ...me.appearance, theme } })}
                accessibilityRole="radio"
                accessibilityState={{ selected: on }}
              >
                <SwapIcon id={on ? "on" : "off"}>
                  <Ionicons name={on ? (icon.replace("-outline", "") as typeof icon) : icon} size={14} color={on ? colors.primary : colors.muted} />
                </SwapIcon>
                <Text style={[styles.langChipText, on && styles.langChipTextOn]}>{label}</Text>
              </Pressable>
            );
          })}
        </View>
      </View>
      <View style={styles.settingRow}>
        <Text style={styles.settingLabel}>{s.textSizeLabel}</Text>
        <View style={styles.langChips} accessibilityRole="radiogroup">
          {TEXT_SIZES.map((size, i) => {
            const on = me.appearance.textSize === size;
            return (
              <Pressable
                key={size}
                style={[styles.langChip, styles.sizeChip, on && styles.langChipOn]}
                onPress={() => void setAppearance({ appearance: { ...me.appearance, textSize: size } })}
                accessibilityRole="radio"
                accessibilityLabel={s.textSizeNames[i]}
                accessibilityState={{ selected: on }}
              >
                {/* The sample letter is drawn at that size, unscaled, so the choices compare honestly. */}
                <Text style={[styles.sizeSample, { fontSize: Math.round(15 * size) }, on && styles.langChipTextOn]} allowFontScaling={false}>
                  A
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>
      {/* Units for weight and glucose: only what's shown changes; readings are stored the same way. */}
      {(
        [
          ["weight", s.unitsWeight, ["lb", "kg"]],
          ["glucose", s.unitsGlucose, ["mg/dL", "mmol/L"]],
        ] as const
      ).map(([kind, label, options]) => (
        <View key={kind} style={styles.settingRow}>
          <Text style={styles.settingLabel}>{label}</Text>
          <View style={styles.langChips} accessibilityRole="radiogroup" accessibilityLabel={label}>
            {options.map((unit) => {
              const on = me.units[kind] === unit;
              return (
                <Pressable
                  key={unit}
                  style={[styles.langChip, on && styles.langChipOn]}
                  onPress={() => void setUnits({ units: { ...me.units, [kind]: unit } })}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: on }}
                >
                  <Text style={[styles.langChipText, on && styles.langChipTextOn]}>{unit}</Text>
                </Pressable>
              );
            })}
          </View>
        </View>
      ))}
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
      <Pressable style={styles.settingButton} onPress={onTour} accessibilityRole="button">
        <Text style={styles.settingButtonText}>{s.tourReplay}</Text>
      </Pressable>
      <View style={styles.settingRow}>
        <Text style={[styles.settingLabel, styles.settingLabelWrap]}>{s.dailyCheckins}</Text>
        <Switch value={me.checkins} onValueChange={(enabled) => void setCheckins({ enabled })} />
      </View>
      <View style={styles.settingRow}>
        <Text style={[styles.settingLabel, styles.settingLabelWrap]}>{s.weeklySummary}</Text>
        <Switch value={me.weeklySummary} onValueChange={(enabled) => void setWeekly({ enabled })} />
      </View>
      <View style={styles.settingRow}>
        <View style={styles.settingLabelWrap}>
          <Text style={styles.settingLabel}>{s.flareForecast}</Text>
          <Text style={styles.settingHint}>{s.flareForecastHint}</Text>
        </View>
        <Switch value={me.flareForecast} onValueChange={(enabled) => void setForecast({ enabled })} />
      </View>
      <View style={styles.settingRow}>
        <View style={styles.settingLabelWrap}>
          <Text style={styles.settingLabel}>{s.airAlerts}</Text>
          <Text style={styles.settingHint}>{s.airAlertsHint}</Text>
        </View>
        <Switch value={me.airAlerts} onValueChange={(enabled) => void setAirAlerts({ enabled })} />
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

const styles = themed(() => ({
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
    backgroundColor: colors.surface,
    ...floatingBar(),
  },
  headerTitle: { fontSize: 18, fontWeight: "700", color: colors.text },
  headerSubtitle: { fontSize: 12, color: colors.muted, marginTop: 1 },
  // The title side shrinks (subtitle truncates) so the four header buttons always fit on a phone.
  brand: { flexDirection: "row", alignItems: "center", gap: 6, flexShrink: 1, minWidth: 0 },
  brandText: { flexShrink: 1, minWidth: 0 },
  logo: { width: 38, height: 38 },
  headerActions: { flexDirection: "row", alignItems: "center", gap: 0, flexShrink: 0 },
  headerButton: { width: 38, height: 40, borderRadius: pillish(20), alignItems: "center", justifyContent: "center" },
  // Health tools: the one filled button, so it stands out from the chat's own controls.
  dashButton: { flexDirection: "row", alignItems: "center", gap: 6, minHeight: 40, borderRadius: radius.pill, paddingHorizontal: 14, backgroundColor: colors.primary, marginHorizontal: 4 },
  dashButtonNarrow: { width: 40, paddingHorizontal: 0, justifyContent: "center" },
  dashText: { color: colors.onPrimary, fontWeight: "700", fontSize: 14 },
  headerLink: { color: colors.primary, fontSize: 16 },
  // Above the chat while it drops open, so it slides over the messages rather than pushing them.
  settingsWrap: { zIndex: 5, maxHeight: "70%" },
  aboutWrap: { zIndex: 5, maxHeight: "80%" },
  settingsScroll: { flexGrow: 0, flexShrink: 1, backgroundColor: colors.surface, borderBottomWidth: 1, borderBottomColor: colors.border },
  settings: { padding: 16, gap: 12, maxWidth: 760, width: "100%", alignSelf: "center" },
  settingRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  settingLabel: { fontSize: 16, color: colors.text },
  settingLabelWrap: { flex: 1, marginRight: 12 },
  settingHint: { fontSize: 13, lineHeight: 18, color: colors.muted, marginTop: 2 },
  locationInput: { color: colors.text, flex: 1, marginLeft: 16, borderWidth: 1, borderColor: colors.border, borderRadius: round(8), paddingHorizontal: 10, paddingVertical: 8, fontSize: 15 },
  langChips: { flexDirection: "row", gap: 6, flexWrap: "wrap", justifyContent: "flex-end", flex: 1, marginLeft: 16 },
  langChip: { borderWidth: 1, borderColor: colors.border, borderRadius: pillish(14), paddingHorizontal: 10, paddingVertical: 5 },
  iconChip: { flexDirection: "row", alignItems: "center", gap: 4 },
  sizeChip: { minWidth: 40, minHeight: 36, alignItems: "center", justifyContent: "center", paddingHorizontal: 8 },
  sizeSample: { color: colors.text, fontWeight: "700", lineHeight: 24 },
  langChipOn: { backgroundColor: colors.primarySoft, borderColor: colors.primary },
  langChipText: { color: colors.text, fontSize: 14 },
  langChipTextOn: { color: colors.primary, fontWeight: "600" },
  settingButton: { borderWidth: 1, borderColor: colors.primary, borderRadius: pillish(10), padding: 12, alignItems: "center" },
  settingButtonText: { color: colors.primary, fontWeight: "600", fontSize: 14 },
  muted: { color: colors.muted, fontSize: 14 },
  list: { padding: 16, gap: 8, maxWidth: 760, width: "100%", alignSelf: "center" },
  empty: { color: colors.muted, textAlign: "center", lineHeight: 20, maxWidth: 340, fontSize: 14 },
  welcome: { alignItems: "center", marginTop: 32, gap: 10, paddingHorizontal: 8 },
  welcomeIcon: { width: 64, height: 64, borderRadius: 32, backgroundColor: colors.primarySoft, alignItems: "center", justifyContent: "center" },
  welcomeTitle: { fontSize: 20, fontWeight: "700", color: colors.text },
  chips: { flexDirection: "row", flexWrap: "wrap", justifyContent: "center", gap: 8, marginTop: 8, maxWidth: 560 },
  chip: { borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, borderRadius: pillish(18), paddingHorizontal: 14, paddingVertical: 9 },
  chipText: { color: colors.text, fontSize: 14 },
  speaking: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 6 },
  speakingText: { fontSize: 12, color: colors.primary, fontWeight: "600" },
  thinking: { paddingVertical: 10, marginTop: 8 },
  ring: { borderRadius: round(22) },
  bubble: { padding: 12, borderRadius: round(14), maxWidth: "85%" },
  userBubble: { backgroundColor: colors.bubbleUser, alignSelf: "flex-end", borderBottomRightRadius: 4 },
  botBubble: { backgroundColor: colors.bubbleBot, alignSelf: "flex-start", borderWidth: 1, borderColor: colors.border, borderBottomLeftRadius: 4 },
  urgentBubble: { backgroundColor: colors.urgentBg, borderColor: colors.danger },
  reminderBubble: { backgroundColor: colors.primarySoft, borderColor: colors.mint },
  // A chart needs the width.
  chartBubble: { width: "85%" },
  doseRow: { flexDirection: "row", gap: 8, marginTop: 8 },
  doseButton: { flexDirection: "row", alignItems: "center", gap: 4, borderWidth: 1, borderColor: colors.primary, borderRadius: pillish(14), paddingHorizontal: 10, paddingVertical: 5 },
  doseButtonOn: { backgroundColor: colors.primary },
  doseText: { color: colors.primary, fontWeight: "600", fontSize: 13 },
  doseTextOn: { color: colors.onPrimary },
  userText: { color: colors.onPrimary, fontSize: 16 },
  photo: { width: 220, height: 220, borderRadius: round(10), marginBottom: 6, backgroundColor: colors.border },
  attachment: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 16, paddingTop: 8, backgroundColor: colors.surface, borderTopWidth: 1, borderTopColor: colors.border },
  attachmentThumb: { width: 44, height: 44, borderRadius: round(8) },
  attachmentText: { flex: 1, color: colors.muted, fontSize: 14 },
  photoButton: { backgroundColor: colors.primarySoft },
  botText: { color: colors.text, fontSize: 16, lineHeight: 22 },
  channel: { fontSize: 11, color: colors.muted, marginTop: 4 },
  inputRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    padding: 12,
    paddingBottom: 28,
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    // In the soft look the message box floats like the top bar, with room below it.
    ...(isSoft() ? { marginHorizontal: 10, marginTop: 4, marginBottom: Platform.OS === "web" ? 10 : 28, paddingBottom: 12, borderRadius: 32, borderWidth: 1, borderColor: colors.hairline, ...softShadow() } : {}),
  },
  input: {
    color: colors.text,
    minWidth: 0, // web inputs otherwise keep their default width and push the send button off small screens
    flex: 1,
    minHeight: 44,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: round(22),
    paddingHorizontal: 16,
    paddingVertical: 10,
    fontSize: 16,
    backgroundColor: colors.bg,
  },
  iconButton: { width: 44, height: 44, borderRadius: pillish(22), alignItems: "center", justifyContent: "center" },
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

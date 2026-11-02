// Voice mode: mic -> Cartesia STT -> send; new assistant replies -> Cartesia TTS, streamed as they're spoken.
import { useEffect, useMemo, useRef, useState } from "react";
import { Platform } from "react-native";
import { useAction } from "convex/react";
import { useAuthToken } from "@convex-dev/auth/react";
import {
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioRecorder,
} from "expo-audio";
import { api } from "../convex/_generated/api";
import { createSpeaker } from "./speaker";
import { CartesiaToken, transcribe } from "./voice";

// Voice input steps: waiting on the permission prompt, recording, then transcribing.
export type MicState = "idle" | "asking" | "recording" | "transcribing";

const MAX_RECORDING_MS = 2 * 60_000;
const TOKEN_REFRESH_MS = 4 * 60_000; // tokens last 5 minutes
const MIC_STATUS: Record<MicState, string | null> = {
  idle: null,
  asking: "Waiting for microphone permission…",
  recording: "Listening… tap the red button when you're done.",
  transcribing: "Transcribing…",
};

export type VoiceError = { text: string; openSettings?: boolean };

type ChatMessage = { _id: string; role: string; text: string; channel: string; kind?: string; voice?: boolean };

// Turn recorder and permission failures into something the user can act on.
function micError(e: unknown): VoiceError {
  const name = (e as { name?: string })?.name;
  if (name === "NotAllowedError" || name === "SecurityError") return micBlocked();
  if (name === "NotFoundError" || name === "OverconstrainedError") return { text: "No microphone found." };
  if (name === "NotReadableError") return { text: "Your microphone is being used by another app." };
  return { text: `Couldn't start recording: ${(e as Error)?.message ?? String(e)}` };
}

function micBlocked(): VoiceError {
  return Platform.OS === "web"
    ? { text: "Microphone access is blocked. Allow it in your browser's site settings, then tap Mic again." }
    : { text: "Microphone access is off for Wellnest.", openSettings: true };
}

// The mic is always there. A reply is read aloud when the question it answers was asked with the mic; typed
// questions get text only.
export function useVoice(
  messages: ChatMessage[] | undefined,
  submit: (text: string) => Promise<void>,
  language = "en",
  statusText: Partial<Record<MicState, string>> = {},
) {
  const getToken = useAction(api.voice.token);
  const authToken = useAuthToken();
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const [mic, setMicState] = useState<MicState>("idle");
  const [speakingId, setSpeakingId] = useState<string | null>(null);
  const [error, setError] = useState<VoiceError | null>(null);
  const tokenRef = useRef<{ value: Promise<CartesiaToken>; at: number } | null>(null);
  const authRef = useRef(authToken);
  authRef.current = authToken;
  const spoken = useRef<Set<string> | null>(null);
  // The state is mirrored in a ref so double taps and timers see the latest step, not a stale render's.
  const micRef = useRef<MicState>("idle");
  const autoStop = useRef<ReturnType<typeof setTimeout> | null>(null);
  const setMic = (next: MicState) => {
    micRef.current = next;
    setMicState(next);
  };

  // Shared by STT and the web speaker; concurrent callers share one request, and a failed one isn't cached.
  const token = () => {
    if (!tokenRef.current || Date.now() - tokenRef.current.at > TOKEN_REFRESH_MS) {
      const value = getToken();
      tokenRef.current = { value, at: Date.now() };
      value.catch(() => {
        if (tokenRef.current?.value === value) tokenRef.current = null;
      });
    }
    return tokenRef.current.value;
  };

  useEffect(() => {
    tokenRef.current = null;
  }, [language]);

  const speaker = useMemo(
    () =>
      createSpeaker({
        cartesiaToken: token,
        authToken: () => authRef.current,
        onSpeaking: setSpeakingId,
        onError: (e) => {
          console.error("speaking a reply failed", e);
          setError({ text: e.name === "AudioBlocked" ? e.message : "Couldn't read the reply aloud. It's still here as text." });
        },
      }),
    [],
  );
  useEffect(() => () => speaker.dispose(), [speaker]);

  useEffect(() => {
    if (!messages) return;
    // Don't read out history on first load, only replies that arrive later.
    if (!spoken.current) {
      spoken.current = new Set(messages.map((m) => m._id));
      return;
    }
    let askedByVoice = false; // the latest question in the app was spoken
    for (const m of messages) {
      if (m.role === "user" && m.channel === "app") askedByVoice = !!m.voice;
      if (spoken.current.has(m._id)) continue;
      spoken.current.add(m._id);
      // Only replies to a spoken question asked here (not Telegram), never the shopper's list of store links, and
      // not while the mic is open (a late reply, like a CREAO report, would end up in the recording).
      const micOpen = micRef.current === "asking" || micRef.current === "recording";
      if (askedByVoice && m.role === "assistant" && m.channel === "app" && !m.kind && !micOpen) {
        speaker.speak({ id: m._id, text: m.text });
      }
    }
  }, [messages]);

  // Call from the mic tap: unlocks audio on web and opens the TTS connection before the reply arrives.
  const prepare = () => {
    speaker.prime();
    speaker.warm();
  };

  const clearAutoStop = () => {
    if (autoStop.current) clearTimeout(autoStop.current);
    autoStop.current = null;
  };

  // Stop the recorder and hand recording back to playback; never throws.
  const release = async () => {
    clearAutoStop();
    try {
      if (recorder.isRecording) await recorder.stop();
    } catch (e) {
      console.warn("recorder.stop failed", e);
    }
    await setAudioModeAsync({ allowsRecording: false }).catch(() => {});
  };

  const start = async () => {
    if (micRef.current !== "idle") return;
    setError(null);
    // Don't record the assistant's own voice.
    speaker.stop();
    prepare();
    // Browsers only expose the microphone on https (or localhost) pages.
    if (Platform.OS === "web" && typeof window !== "undefined" && !window.isSecureContext) {
      setError({ text: "Voice input needs a secure (https) page." });
      return;
    }
    setMic("asking");
    try {
      const perm = await requestRecordingPermissionsAsync();
      if (!perm.granted) {
        setMic("idle");
        setError(
          perm.canAskAgain && Platform.OS !== "web"
            ? { text: "Voice input needs microphone access. Tap Mic to try again." }
            : micBlocked(),
        );
        return;
      }
      // The screen may have closed while the prompt was open.
      if ((micRef.current as MicState) !== "asking") return;
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      await recorder.prepareToRecordAsync();
      recorder.record();
      setMic("recording");
      autoStop.current = setTimeout(() => void stop(), MAX_RECORDING_MS);
    } catch (e) {
      console.error("starting a recording failed", e);
      await release();
      setMic("idle");
      setError(micError(e));
    }
  };

  const stop = async () => {
    if (micRef.current !== "recording") return;
    clearAutoStop();
    setMic("transcribing");
    try {
      await recorder.stop();
      await setAudioModeAsync({ allowsRecording: false });
      if (!recorder.uri) throw new Error("No recording");
      const text = (await transcribe(await token(), recorder.uri)).trim();
      if (text) await submit(text);
      else setError({ text: "I didn't catch anything. Tap Mic and try again." });
    } catch (e) {
      console.error("voice input failed", e);
      setError({ text: "Couldn't transcribe that. Please try again, or type your message instead." });
    } finally {
      setMic("idle");
    }
  };

  // Leaving the screen discards a recording in progress.
  useEffect(() => () => void release(), []);

  return {
    mic,
    speaking: speakingId !== null,
    speakingId,
    status: (mic !== "idle" && statusText[mic]) || MIC_STATUS[mic],
    error,
    start: () => void start(),
    stop: () => void stop(),
    stopSpeaking: () => speaker.stop(),
    dismissError: () => setError(null),
  };
}

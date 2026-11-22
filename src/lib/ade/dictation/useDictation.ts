import { useCallback, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { getVoiceSettings } from "@/lib/ade/workspaceApi";
import {
  MIC_FALLBACK_NOTICE,
  dictationSupport,
  errorMessage,
  listMics,
  micRoutingSupported,
  resolveMic,
  type DictationSupport,
  type MicOption,
} from "./dictation.mjs";

/** The subset of the Web Speech API that dictation uses. */
type RecognitionResultList = ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }>;
type Recognition = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onstart: (() => void) | null;
  onaudiostart: (() => void) | null;
  onresult: ((event: { results: RecognitionResultList }) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start: (track?: MediaStreamTrack) => void;
  stop: () => void;
  abort: () => void;
};
type RecognitionConstructor = new () => Recognition;

export type DictationPhase = "idle" | "starting" | "listening" | "stopping";
export type DictationStatus = { kind: "info" | "error"; message: string };

const MIC_STORAGE_KEY = "ade:dictation-mic";
const STOP_GRACE_MS = 2000;
const QUICK_END_MS = 1000;
const MAX_QUICK_ENDS = 3;

function recognitionConstructor(): RecognitionConstructor | undefined {
  if (typeof window === "undefined") return undefined;
  const scope = window as unknown as {
    SpeechRecognition?: RecognitionConstructor;
    webkitSpeechRecognition?: RecognitionConstructor;
  };
  return scope.SpeechRecognition ?? scope.webkitSpeechRecognition;
}

function detectSupport(): DictationSupport {
  return dictationSupport({
    hasRecognition: !!recognitionConstructor(),
    isSecureContext: window.isSecureContext,
    hasMediaDevices: typeof navigator.mediaDevices?.getUserMedia === "function",
  });
}

function detectRouting() {
  const data = (
    navigator as Navigator & {
      userAgentData?: { brands?: { brand: string; version: string }[]; mobile?: boolean };
    }
  ).userAgentData;
  return micRoutingSupported(data?.brands, data?.mobile === true);
}

function readSavedMic() {
  try {
    return window.localStorage.getItem(MIC_STORAGE_KEY) ?? "";
  } catch {
    return "";
  }
}

function writeSavedMic(id: string) {
  try {
    if (id) window.localStorage.setItem(MIC_STORAGE_KEY, id);
    else window.localStorage.removeItem(MIC_STORAGE_KEY);
  } catch {
    // Storage is a convenience; the choice still applies for this page.
  }
}

function stopStream(stream: MediaStream | null) {
  for (const track of stream?.getTracks() ?? []) track.stop();
}

function playChime() {
  const Context =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Context) return;
  try {
    const context = new Context();
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    const now = context.currentTime;
    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(660, now);
    oscillator.frequency.exponentialRampToValueAtTime(990, now + 0.12);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.06, now + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.18);
    oscillator.connect(gain).connect(context.destination);
    oscillator.start(now);
    oscillator.stop(now + 0.2);
    oscillator.onended = () => void context.close().catch(() => {});
  } catch {
    // A missing chime never blocks dictation.
  }
}

/**
 * Browser dictation through the built-in Web Speech API, recording from a chosen mic.
 * `finals` and `interim` cover everything heard since the last `start()`.
 */
export function useDictation() {
  const queryClient = useQueryClient();
  const [support, setSupport] = useState<DictationSupport | null>(null);
  const [routing, setRouting] = useState(false);
  const [phase, setPhase] = useState<DictationPhase>("idle");
  const [finals, setFinals] = useState<string[]>([]);
  const [interim, setInterim] = useState("");
  const [status, setStatus] = useState<DictationStatus | null>(null);
  const [mics, setMics] = useState<MicOption[]>([]);
  const [labelsHidden, setLabelsHidden] = useState(true);
  const [savedMic, setSavedMic] = useState("");
  const [activeMicLabel, setActiveMicLabel] = useState("");

  const recognitionRef = useRef<Recognition | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const tokenRef = useRef(0);
  const userStoppedRef = useRef(false);
  const fatalRef = useRef(false);
  const priorFinalsRef = useRef<string[]>([]);
  const sessionFinalsRef = useRef<string[]>([]);
  const interimRef = useRef("");
  const quickEndsRef = useRef(0);
  const stopTimerRef = useRef<number | null>(null);
  const micsRef = useRef({ mics, labelsHidden });
  micsRef.current = { mics, labelsHidden };

  const refreshMics = useCallback(async () => {
    if (typeof navigator.mediaDevices?.enumerateDevices !== "function") return;
    try {
      const listed = listMics(await navigator.mediaDevices.enumerateDevices());
      setMics(listed.mics);
      setLabelsHidden(listed.labelsHidden);
    } catch {
      setMics([]);
      setLabelsHidden(true);
    }
  }, []);

  useEffect(() => {
    setSupport(detectSupport());
    setRouting(detectRouting());
    setSavedMic(readSavedMic());
    const devices = navigator.mediaDevices;
    if (typeof devices?.addEventListener !== "function") return;
    void refreshMics();
    const onChange = () => void refreshMics();
    devices.addEventListener("devicechange", onChange);
    return () => devices.removeEventListener("devicechange", onChange);
  }, [refreshMics]);

  const finish = useCallback(() => {
    if (stopTimerRef.current !== null) window.clearTimeout(stopTimerRef.current);
    stopTimerRef.current = null;
    const recognition = recognitionRef.current;
    recognitionRef.current = null;
    if (recognition) {
      recognition.onstart = null;
      recognition.onaudiostart = null;
      recognition.onresult = null;
      recognition.onerror = null;
      recognition.onend = null;
    }
    stopStream(streamRef.current);
    streamRef.current = null;
    interimRef.current = "";
    setInterim("");
    setActiveMicLabel("");
    setPhase("idle");
  }, []);

  const fail = useCallback(
    (code: string) => {
      fatalRef.current = true;
      const message = errorMessage(code);
      if (message) setStatus({ kind: "error", message });
      const recognition = recognitionRef.current;
      try {
        recognition?.abort();
      } catch {
        // Already stopped.
      }
      finish();
    },
    [finish],
  );

  /** Fold the ended session into the committed finals (interim included, so nothing shown is lost). */
  const settleSession = () => {
    priorFinalsRef.current = [
      ...priorFinalsRef.current,
      ...sessionFinalsRef.current,
      ...(interimRef.current.trim() ? [interimRef.current] : []),
    ];
    sessionFinalsRef.current = [];
    interimRef.current = "";
    setFinals(priorFinalsRef.current);
    setInterim("");
  };

  const beginSession = (
    Constructor: RecognitionConstructor,
    track: MediaStreamTrack | undefined,
    token: number,
    chime: Promise<boolean>,
    firstSession: boolean,
  ) => {
    const recognition = new Constructor();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = navigator.language || "en-US";
    const startedAt = Date.now();
    let heard = false;
    recognition.onstart = () => {
      if (tokenRef.current === token && !userStoppedRef.current) setPhase("listening");
    };
    recognition.onaudiostart = () => {
      if (!firstSession) return;
      void chime.then((on) => {
        if (on && tokenRef.current === token) playChime();
      });
    };
    recognition.onresult = (event) => {
      const done: string[] = [];
      const pending: string[] = [];
      for (let index = 0; index < event.results.length; index++) {
        const result = event.results[index];
        const transcript = result?.[0]?.transcript ?? "";
        if (result?.isFinal) done.push(transcript);
        else pending.push(transcript);
      }
      heard = true;
      sessionFinalsRef.current = done;
      interimRef.current = pending.join(" ");
      setFinals([...priorFinalsRef.current, ...done]);
      setInterim(interimRef.current);
    };
    recognition.onerror = (event) => {
      if (errorMessage(event.error) === null) return;
      settleSession();
      fail(event.error);
    };
    recognition.onend = () => {
      if (recognitionRef.current !== recognition) return;
      settleSession();
      if (userStoppedRef.current || fatalRef.current || tokenRef.current !== token) {
        finish();
        return;
      }
      if (track && track.readyState === "ended") {
        fail("track-ended");
        return;
      }
      quickEndsRef.current =
        !heard && Date.now() - startedAt < QUICK_END_MS ? quickEndsRef.current + 1 : 0;
      if (quickEndsRef.current >= MAX_QUICK_ENDS) {
        setStatus({
          kind: "error",
          message:
            "The browser's speech service keeps stopping right away. Try again, or pick another microphone.",
        });
        fatalRef.current = true;
        finish();
        return;
      }
      // Browsers end continuous sessions after silence or a time limit; keep listening.
      beginSession(Constructor, track, token, chime, false);
    };
    recognitionRef.current = recognition;
    try {
      if (track) recognition.start(track);
      else recognition.start();
    } catch (cause) {
      const name = cause instanceof Error ? cause.name : "";
      fail(name || "start-failed");
    }
  };

  const start = useCallback(async () => {
    if (recognitionRef.current || streamRef.current || phase !== "idle") return;
    const current = detectSupport();
    setSupport(current);
    if (!current.ok) {
      setStatus({ kind: "error", message: current.reason });
      return;
    }
    const Constructor = recognitionConstructor();
    if (!Constructor) return;
    const token = ++tokenRef.current;
    setStatus(null);
    setPhase("starting");
    setFinals([]);
    setInterim("");
    priorFinalsRef.current = [];
    sessionFinalsRef.current = [];
    interimRef.current = "";
    userStoppedRef.current = false;
    fatalRef.current = false;
    quickEndsRef.current = 0;
    const chime = queryClient
      .fetchQuery({ queryKey: ["workspace-voice"], queryFn: getVoiceSettings, staleTime: 30_000 })
      .then((data) => data?.voice?.chimeDuringDictation !== false)
      .catch(() => true);

    let track: MediaStreamTrack | undefined;
    if (current.canPickMic && detectRouting()) {
      const { mics: known, labelsHidden: hidden } = micsRef.current;
      const saved = readSavedMic();
      const choice = resolveMic(known, saved, !hidden);
      let fellBack = choice.missing;
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: choice.deviceId ? { deviceId: { exact: choice.deviceId } } : true,
        });
      } catch (cause) {
        const name = cause instanceof Error ? cause.name : "";
        if (tokenRef.current !== token) return;
        if (!choice.deviceId || (name !== "OverconstrainedError" && name !== "NotFoundError")) {
          fail(name || "NotReadableError");
          return;
        }
        try {
          stream = await navigator.mediaDevices.getUserMedia({ audio: true });
          fellBack = true;
        } catch (retry) {
          if (tokenRef.current !== token) return;
          fail(retry instanceof Error ? retry.name : "NotReadableError");
          return;
        }
      }
      if (tokenRef.current !== token) {
        stopStream(stream);
        return;
      }
      streamRef.current = stream;
      if (fellBack) setStatus({ kind: "info", message: MIC_FALLBACK_NOTICE });
      void refreshMics();
      track = stream.getAudioTracks()[0];
      if (track) {
        setActiveMicLabel(track.label);
        track.addEventListener("ended", () => {
          if (streamRef.current === stream) fail("track-ended");
        });
      }
    }
    beginSession(Constructor, track, token, chime, true);
    // beginSession and the callbacks it installs are stable for a session's lifetime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, queryClient, refreshMics, fail, finish]);

  /** Stop listening and keep what was heard; the browser may deliver a last final result first. */
  const stop = useCallback(() => {
    const recognition = recognitionRef.current;
    userStoppedRef.current = true;
    if (!recognition) {
      tokenRef.current++;
      finish();
      return;
    }
    setPhase("stopping");
    try {
      recognition.stop();
    } catch {
      // Not started yet.
    }
    stopTimerRef.current = window.setTimeout(() => {
      if (recognitionRef.current !== recognition) return;
      try {
        recognition.abort();
      } catch {
        // Already gone.
      }
      settleSession();
      finish();
    }, STOP_GRACE_MS);
  }, [finish]);

  /** Drop the session immediately (send, unmount). Results already delivered stay in `finals`. */
  const cancel = useCallback(() => {
    userStoppedRef.current = true;
    tokenRef.current++;
    try {
      recognitionRef.current?.abort();
    } catch {
      // Already gone.
    }
    finish();
  }, [finish]);

  useEffect(() => cancel, [cancel]);

  const selectMic = useCallback((id: string) => {
    setSavedMic(id);
    writeSavedMic(id);
  }, []);

  /** Ask for mic permission once so the browser reveals mic names. */
  const requestMicAccess = useCallback(async () => {
    if (typeof navigator.mediaDevices?.getUserMedia !== "function") return;
    try {
      stopStream(await navigator.mediaDevices.getUserMedia({ audio: true }));
      setStatus(null);
    } catch (cause) {
      const message = errorMessage(cause instanceof Error ? cause.name : "");
      if (message) setStatus({ kind: "error", message });
    }
    await refreshMics();
  }, [refreshMics]);

  const clearStatus = useCallback(() => setStatus(null), []);

  const choice = resolveMic(mics, savedMic, !labelsHidden);
  return {
    support,
    /** Whether the chosen mic is honored (Chrome/Edge 135+); other browsers use their default. */
    canPickMic: !!support?.ok && support.canPickMic && routing,
    phase,
    active: phase !== "idle",
    finals,
    interim,
    status,
    clearStatus,
    mics,
    labelsHidden,
    selectedMic: choice.missing ? "" : savedMic,
    savedMicMissing: choice.missing,
    activeMicLabel,
    selectMic,
    requestMicAccess,
    start,
    stop,
    cancel,
  };
}

export type Dictation = ReturnType<typeof useDictation>;

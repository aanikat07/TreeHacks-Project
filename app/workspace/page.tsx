"use client";

import { Send } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import Whiteboard, { type WhiteboardHandle } from "@/components/Whiteboard";

type AppMode = "graph" | "animation";

type InputMode = "audio" | "text";

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  code?: string;
}

interface AnimationPayload {
  jobId: string;
  status: "queued" | "rendering" | "completed" | "failed";
}

interface AnimationJobResponse {
  id: string;
  status: "queued" | "rendering" | "completed" | "failed";
  videoUrl?: string;
  error?: string;
}

interface RealtimeEvent {
  type?: string;
  delta?: string;
  transcript?: string;
  error?: unknown;
}

interface SubmitOptions {
  providedMessage?: string;
  skipUserMessageAppend?: boolean;
}

interface DesmosExpression {
  id: string;
  latex?: string;
}

interface DesmosCalculatorLike {
  getExpressions: () => DesmosExpression[];
  setExpression: (expression: { id: string; latex: string }) => void;
  removeExpression: (expression: { id: string }) => void;
  destroy: () => void;
}

interface DesmosLibrary {
  GraphingCalculator: (
    element: HTMLElement,
    options: Record<string, boolean>,
  ) => DesmosCalculatorLike;
  Calculator3D: (
    element: HTMLElement,
    options: Record<string, boolean>,
  ) => DesmosCalculatorLike;
}

declare global {
  interface Window {
    Desmos?: DesmosLibrary;
  }
}

function createChatMessage(
  role: ChatMessage["role"],
  text: string,
  code?: string,
): ChatMessage {
  return {
    id:
      typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random()}`,
    role,
    text,
    code,
  };
}

export default function WorkspacePage() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const calculatorRef = useRef<DesmosCalculatorLike | null>(null);

  const [animationQuery, setAnimationQuery] = useState("");
  const [graphQuery, setGraphQuery] = useState("");
  const [animationLoading, setAnimationLoading] = useState(false);
  const [graphLoading, setGraphLoading] = useState(false);
  const [animationChatHistory, setAnimationChatHistory] = useState<
    ChatMessage[]
  >([]);
  const [graphChatHistory, setGraphChatHistory] = useState<ChatMessage[]>([]);
  const animationChatEndRef = useRef<HTMLDivElement | null>(null);
  const graphChatEndRef = useRef<HTMLDivElement | null>(null);
  const animationVideoRef = useRef<HTMLVideoElement | null>(null);
  const lastSpokenAssistantMessageRef = useRef("");
  const ttsAudioRef = useRef<HTMLAudioElement | null>(null);
  const ttsAudioUrlRef = useRef<string | null>(null);
  const ttsRequestIdRef = useRef(0);
  const suppressNextAssistantTtsRef = useRef(false);
  const pendingAnimationNarrationTextRef = useRef<string | null>(null);
  const pendingAnimationNarrationUrlRef = useRef<string | null>(null);
  const pendingNarrationPreloadPromiseRef = useRef<Promise<void> | null>(null);
  const pendingNarrationRequestIdRef = useRef(0);
  const playbackSyncRequestIdRef = useRef(0);
  const syncedVideoUrlRef = useRef<string | null>(null);
  const whiteboardRef = useRef<WhiteboardHandle | null>(null);
  const [graphWindowOpen, setGraphWindowOpen] = useState(false);
  const [dimension, setDimension] = useState<"2d" | "3d">("2d");
  const expressionIdRef = useRef(0);
  const [activeAnimationJobId, setActiveAnimationJobId] = useState<
    string | null
  >(null);
  const [animationVideoUrl, setAnimationVideoUrl] = useState<string | null>(
    null,
  );
  const [animationStatus, setAnimationStatus] = useState<
    "idle" | "queued" | "rendering" | "completed" | "failed"
  >("idle");

  const [inputMode, setInputMode] = useState<InputMode>("audio");
  const [lessonId, setLessonId] = useState("default");
  const [isTalking, setIsTalking] = useState(false);
  const [voiceTranscript, setVoiceTranscript] = useState("");

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const dataChannelRef = useRef<RTCDataChannel | null>(null);
  const dataChannelOpenRef = useRef(false);

  const mediaStreamRef = useRef<MediaStream | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const ensureRealtimePromiseRef = useRef<Promise<boolean> | null>(null);
  const prewarmRealtimeRef = useRef<() => Promise<boolean>>(async () => false);
  const recordedChunksRef = useRef<BlobPart[]>([]);
  const latestVoiceBlobRef = useRef<Blob | null>(null);

  const interimTranscriptRef = useRef("");
  const isTalkingRef = useRef(false);

  const sendRealtimeEvent = (event: Record<string, unknown>) => {
    const dataChannel = dataChannelRef.current;
    if (!dataChannel || dataChannel.readyState !== "open") return;
    dataChannel.send(JSON.stringify(event));
  };

  const stopRecording = () => {
    const recorder = mediaRecorderRef.current;
    if (recorder && recorder.state !== "inactive") recorder.stop();
    mediaRecorderRef.current = null;
  };

  const teardownRealtime = () => {
    stopRecording();

    dataChannelRef.current?.close();
    dataChannelRef.current = null;
    dataChannelOpenRef.current = false;

    pcRef.current?.close();
    pcRef.current = null;

    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((track) => {
        track.stop();
      });
      mediaStreamRef.current = null;
    }
  };

  const stopTtsPlayback = useCallback(() => {
    if (ttsAudioRef.current) {
      ttsAudioRef.current.pause();
      ttsAudioRef.current.src = "";
      ttsAudioRef.current = null;
    }
    if (ttsAudioUrlRef.current) {
      URL.revokeObjectURL(ttsAudioUrlRef.current);
      ttsAudioUrlRef.current = null;
    }
  }, []);

  const clearPendingNarrationAudio = useCallback(() => {
    pendingNarrationPreloadPromiseRef.current = null;
    if (pendingAnimationNarrationUrlRef.current) {
      URL.revokeObjectURL(pendingAnimationNarrationUrlRef.current);
      pendingAnimationNarrationUrlRef.current = null;
    }
  }, []);

  const preloadNarrationAudio = async (text: string) => {
    const requestId = ++pendingNarrationRequestIdRef.current;
    clearPendingNarrationAudio();

    const task = (async () => {
      const response = await fetch("/api/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      if (!response.ok || requestId !== pendingNarrationRequestIdRef.current) {
        return;
      }

      const audioBlob = await response.blob();
      if (requestId !== pendingNarrationRequestIdRef.current) return;
      pendingAnimationNarrationUrlRef.current = URL.createObjectURL(audioBlob);
    })();
    pendingNarrationPreloadPromiseRef.current = task;
    await task;
  };

  const speakAssistantMessage = useCallback(
    async (text: string) => {
      const requestId = ++ttsRequestIdRef.current;
      stopTtsPlayback();

      const response = await fetch("/api/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      if (!response.ok || requestId !== ttsRequestIdRef.current) return;

      const audioBlob = await response.blob();
      if (requestId !== ttsRequestIdRef.current) return;

      const audioUrl = URL.createObjectURL(audioBlob);
      const audio = new Audio(audioUrl);
      ttsAudioUrlRef.current = audioUrl;
      ttsAudioRef.current = audio;
      await audio.play().catch(() => {
        // Ignore autoplay policy failures.
      });
    },
    [stopTtsPlayback],
  );

  const handleAnimationVideoLoaded = () => {
    const video = animationVideoRef.current;
    if (!video) return;
    const currentVideoUrl = animationVideoUrl;
    if (!currentVideoUrl) return;
    if (syncedVideoUrlRef.current === currentVideoUrl) return;
    syncedVideoUrlRef.current = currentVideoUrl;
    const syncRequestId = ++playbackSyncRequestIdRef.current;

    const narrationText =
      pendingAnimationNarrationTextRef.current?.trim() || "";
    video.pause();
    video.currentTime = 0;

    void (async () => {
      let narrationUrl = pendingAnimationNarrationUrlRef.current;

      if (narrationText && !narrationUrl) {
        const preloadTask = pendingNarrationPreloadPromiseRef.current;
        if (preloadTask) {
          await preloadTask.catch(() => {
            // Fall through to on-demand TTS synthesis below.
          });
          narrationUrl = pendingAnimationNarrationUrlRef.current;
        }
      }

      if (narrationText && !narrationUrl) {
        const requestId = ++pendingNarrationRequestIdRef.current;
        const response = await fetch("/api/tts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: narrationText }),
        }).catch(() => null);

        if (
          response?.ok &&
          requestId === pendingNarrationRequestIdRef.current &&
          syncRequestId === playbackSyncRequestIdRef.current
        ) {
          const audioBlob = await response.blob();
          if (
            requestId === pendingNarrationRequestIdRef.current &&
            syncRequestId === playbackSyncRequestIdRef.current
          ) {
            narrationUrl = URL.createObjectURL(audioBlob);
          }
        }
      }

      if (syncRequestId !== playbackSyncRequestIdRef.current) return;

      if (narrationText && narrationUrl) {
        stopTtsPlayback();
        const audio = new Audio(narrationUrl);
        ttsAudioUrlRef.current = narrationUrl;
        ttsAudioRef.current = audio;
        pendingAnimationNarrationTextRef.current = null;
        pendingAnimationNarrationUrlRef.current = null;
        pendingNarrationPreloadPromiseRef.current = null;
        await Promise.allSettled([video.play(), audio.play()]);
        return;
      }

      await video.play().catch(() => {
        // Ignore autoplay policy failures.
      });
    })();
  };

  const waitForIceGatheringComplete = (pc: RTCPeerConnection) =>
    new Promise<void>((resolve) => {
      if (pc.iceGatheringState === "complete") {
        resolve();
        return;
      }

      const onStateChange = () => {
        if (pc.iceGatheringState !== "complete") return;
        pc.removeEventListener("icegatheringstatechange", onStateChange);
        resolve();
      };

      pc.addEventListener("icegatheringstatechange", onStateChange);
    });

  const ensureRealtimeConnection = async (options?: { silent?: boolean }) => {
    if (dataChannelOpenRef.current && pcRef.current && dataChannelRef.current) {
      return true;
    }
    if (ensureRealtimePromiseRef.current) {
      return ensureRealtimePromiseRef.current;
    }

    const task = (async () => {
      try {
        let stream = mediaStreamRef.current;
        if (!stream) {
          stream = await navigator.mediaDevices.getUserMedia({
            audio: {
              echoCancellation: true,
              noiseSuppression: true,
              autoGainControl: true,
            },
          });
          mediaStreamRef.current = stream;
        }

        const pc = new RTCPeerConnection();
        pcRef.current = pc;

        for (const track of stream.getAudioTracks()) {
          track.enabled = true;
          pc.addTrack(track, stream);
        }

        const dataChannel = pc.createDataChannel("oai-events");
        dataChannelRef.current = dataChannel;

        dataChannel.onopen = () => {
          dataChannelOpenRef.current = true;
          sendRealtimeEvent({
            type: "session.update",
            session: {
              input_audio_transcription: {
                model: "gpt-4o-transcribe",
                language: "en",
              },
              turn_detection: null,
            },
          });
        };

        dataChannel.onclose = () => {
          dataChannelOpenRef.current = false;
        };

        dataChannel.onmessage = (messageEvent) => {
          let event: RealtimeEvent;
          try {
            event = JSON.parse(messageEvent.data) as RealtimeEvent;
          } catch {
            return;
          }

          if (
            event.type === "conversation.item.input_audio_transcription.delta"
          ) {
            interimTranscriptRef.current += event.delta || "";
            setVoiceTranscript(interimTranscriptRef.current.trim());
            return;
          }

          if (
            event.type ===
            "conversation.item.input_audio_transcription.completed"
          ) {
            const finalText = (
              event.transcript || interimTranscriptRef.current
            ).trim();
            interimTranscriptRef.current = "";
            setVoiceTranscript("");
            if (!finalText) return;
            setAnimationChatHistory((prev) => [
              ...prev,
              createChatMessage("user", finalText),
            ]);
            void handleSubmit("animation", {
              providedMessage: finalText,
              skipUserMessageAppend: true,
            });
            return;
          }

          if (
            event.type === "conversation.item.input_audio_transcription.failed"
          ) {
            setAnimationChatHistory((prev) => [
              ...prev,
              createChatMessage(
                "assistant",
                "Realtime transcription failed. Please try again.",
              ),
            ]);
            interimTranscriptRef.current = "";
            setVoiceTranscript("");
            return;
          }

          if (event.type === "error") {
            setAnimationChatHistory((prev) => [
              ...prev,
              createChatMessage(
                "assistant",
                "Realtime audio connection error occurred.",
              ),
            ]);
          }
        };

        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        await waitForIceGatheringComplete(pc);

        const offerSdp = pc.localDescription?.sdp;
        if (!offerSdp) {
          throw new Error("Failed to produce SDP offer.");
        }

        const response = await fetch("/api/realtime/session", {
          method: "POST",
          headers: { "Content-Type": "application/sdp" },
          body: offerSdp,
        });

        if (!response.ok) {
          throw new Error(await response.text());
        }

        const answerSdp = await response.text();
        await pc.setRemoteDescription({ type: "answer", sdp: answerSdp });

        await new Promise<void>((resolve, reject) => {
          if (dataChannel.readyState === "open") {
            resolve();
            return;
          }
          const timeout = setTimeout(() => {
            reject(new Error("Realtime data channel did not open in time."));
          }, 8000);
          dataChannel.addEventListener(
            "open",
            () => {
              clearTimeout(timeout);
              resolve();
            },
            { once: true },
          );
        });

        return true;
      } catch (error) {
        console.error("Realtime setup failed:", error);
        if (!options?.silent) {
          setAnimationChatHistory((prev) => [
            ...prev,
            createChatMessage(
              "assistant",
              "Unable to start realtime audio. Check microphone permissions and API configuration.",
            ),
          ]);
        }
        setIsTalking(false);
        isTalkingRef.current = false;
        teardownRealtime();
        return false;
      } finally {
        ensureRealtimePromiseRef.current = null;
      }
    })();

    ensureRealtimePromiseRef.current = task;
    return task;
  };

  const startVoiceTurn = async () => {
    const connected = await ensureRealtimeConnection();
    if (!connected) return false;

    const stream = mediaStreamRef.current;
    if (!stream) {
      setAnimationChatHistory((prev) => [
        ...prev,
        createChatMessage("assistant", "Microphone stream is unavailable."),
      ]);
      return false;
    }

    recordedChunksRef.current = [];
    interimTranscriptRef.current = "";
    setVoiceTranscript("");

    try {
      const recorder = new MediaRecorder(stream);
      recorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          recordedChunksRef.current.push(event.data);
        }
      };
      recorder.onstop = () => {
        if (recordedChunksRef.current.length === 0) return;
        latestVoiceBlobRef.current = new Blob(recordedChunksRef.current, {
          type: "audio/webm",
        });
      };
      recorder.start();
      mediaRecorderRef.current = recorder;
    } catch (error) {
      console.error("Recording setup failed:", error);
      return false;
    }

    sendRealtimeEvent({ type: "input_audio_buffer.clear" });
    return true;
  };

  const stopVoiceTurn = () => {
    stopRecording();
    sendRealtimeEvent({ type: "input_audio_buffer.commit" });
    setVoiceTranscript("");
  };

  const handleTalkToggle = async () => {
    if (!isTalkingRef.current) {
      const started = await startVoiceTurn();
      isTalkingRef.current = started;
      setIsTalking(started);
      return;
    }

    isTalkingRef.current = false;
    setIsTalking(false);
    stopVoiceTurn();
  };

  prewarmRealtimeRef.current = () => ensureRealtimeConnection({ silent: true });

  useEffect(() => {
    if (inputMode !== "audio") return;
    void prewarmRealtimeRef.current();
  }, [inputMode]);

  const getCurrentExpressions = () => {
    const calculator = calculatorRef.current;
    if (!calculator) return [];
    const exprs = calculator.getExpressions();
    return exprs
      .filter((expression): expression is Required<DesmosExpression> =>
        Boolean(expression.latex),
      )
      .map((expression) => ({ id: expression.id, latex: expression.latex }));
  };

  const handleSubmit = async (targetMode: AppMode, options?: SubmitOptions) => {
    const query = options?.providedMessage
      ? options.providedMessage
      : targetMode === "graph"
        ? graphQuery
        : animationQuery;
    const loading = targetMode === "graph" ? graphLoading : animationLoading;
    if (!query.trim() || loading) return;

    const userMessage = query.trim();
    if (targetMode === "graph") {
      setGraphChatHistory((prev) => [
        ...prev,
        createChatMessage("user", userMessage),
      ]);
      setGraphLoading(true);
    } else {
      if (!options?.skipUserMessageAppend) {
        setAnimationChatHistory((prev) => [
          ...prev,
          createChatMessage("user", userMessage),
        ]);
      }
      setAnimationLoading(true);
    }

    try {
      if (targetMode === "animation") {
        syncedVideoUrlRef.current = null;
        playbackSyncRequestIdRef.current += 1;
        setAnimationVideoUrl(null);
        setAnimationStatus("queued");
        pendingAnimationNarrationTextRef.current = null;
        pendingNarrationRequestIdRef.current += 1;
        clearPendingNarrationAudio();
        stopTtsPlayback();
      }

      const currentExpressions =
        targetMode === "graph" ? getCurrentExpressions() : [];
      const whiteboardImageBase64 =
        targetMode === "animation"
          ? whiteboardRef.current?.getSnapshotDataUrl() || undefined
          : undefined;

      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query: userMessage,
          currentExpressions,
          dimension,
          mode: targetMode,
          lessonId: targetMode === "animation" ? lessonId : undefined,
          whiteboardImageBase64,
        }),
      });
      const data = (await res.json().catch(() => null)) as {
        error?: string;
        actions?: Array<{
          type: "add" | "remove" | "set";
          id?: string;
          latex?: string;
        }>;
        message?: string;
        animation?: AnimationPayload;
      } | null;
      if (!res.ok) {
        throw new Error(data?.error || "Request failed.");
      }
      if (!data) {
        throw new Error("Invalid server response.");
      }

      const calculator = calculatorRef.current;
      if (targetMode === "graph" && calculator && Array.isArray(data.actions)) {
        const tempIdMap = new Map<string, string>();

        for (const action of data.actions) {
          switch (action.type) {
            case "add": {
              if (!action.latex) break;
              expressionIdRef.current += 1;
              const realId = `expr-${expressionIdRef.current}`;
              calculator.setExpression({ id: realId, latex: action.latex });
              if (action.id) tempIdMap.set(action.id, realId);
              break;
            }
            case "remove": {
              if (!action.id) break;
              const resolvedId = tempIdMap.get(action.id) || action.id;
              calculator.removeExpression({ id: resolvedId });
              break;
            }
            case "set": {
              if (!action.id || !action.latex) break;
              const resolvedId = tempIdMap.get(action.id) || action.id;
              calculator.setExpression({ id: resolvedId, latex: action.latex });
              break;
            }
          }
        }
      }

      const reply = data.message || "Done.";
      if (targetMode === "animation" && data.animation) {
        const animation = data.animation as AnimationPayload;
        setActiveAnimationJobId(animation.jobId);
        setAnimationStatus(animation.status);
        pendingAnimationNarrationTextRef.current = reply;
        suppressNextAssistantTtsRef.current = true;
        void preloadNarrationAudio(reply);
        setAnimationChatHistory((prev) => [
          ...prev,
          createChatMessage("assistant", reply),
        ]);
      } else {
        const setTargetChatHistory =
          targetMode === "graph"
            ? setGraphChatHistory
            : setAnimationChatHistory;
        setTargetChatHistory((prev) => [
          ...prev,
          createChatMessage("assistant", reply),
        ]);
      }
    } catch (err) {
      console.error("Failed to process query:", err);
      const setTargetChatHistory =
        targetMode === "graph" ? setGraphChatHistory : setAnimationChatHistory;
      setTargetChatHistory((prev) => [
        ...prev,
        createChatMessage("assistant", "Something went wrong."),
      ]);
      if (targetMode === "animation") {
        setAnimationStatus("failed");
      }
    } finally {
      if (targetMode === "graph") {
        setGraphLoading(false);
        setGraphQuery("");
      } else {
        setAnimationLoading(false);
        setAnimationQuery("");
      }
    }
  };

  useEffect(() => {
    if (typeof window === "undefined") return;
    const savedLessonId = window.localStorage.getItem("lovelace:lessonId");
    if (savedLessonId?.trim()) {
      setLessonId(savedLessonId);
    }
  }, []);

  const animationChatCount = animationChatHistory.length;
  useEffect(() => {
    if (animationChatCount === 0) return;
    animationChatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [animationChatCount]);

  useEffect(() => {
    if (animationChatHistory.length === 0) return;

    const latest = animationChatHistory[animationChatHistory.length - 1];
    if (!latest || latest.role !== "assistant") return;
    if (suppressNextAssistantTtsRef.current) {
      suppressNextAssistantTtsRef.current = false;
      return;
    }

    const text = latest.text.trim();
    if (!text || text === lastSpokenAssistantMessageRef.current) return;

    lastSpokenAssistantMessageRef.current = text;
    void speakAssistantMessage(text);
  }, [animationChatHistory, speakAssistantMessage]);

  const graphChatCount = graphChatHistory.length;
  useEffect(() => {
    if (graphChatCount === 0) return;
    graphChatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [graphChatCount]);

  useEffect(() => {
    return () => {
      const recorder = mediaRecorderRef.current;
      if (recorder && recorder.state !== "inactive") recorder.stop();
      mediaRecorderRef.current = null;

      dataChannelRef.current?.close();
      dataChannelRef.current = null;
      dataChannelOpenRef.current = false;

      pcRef.current?.close();
      pcRef.current = null;

      if (mediaStreamRef.current) {
        mediaStreamRef.current.getTracks().forEach((track) => {
          track.stop();
        });
        mediaStreamRef.current = null;
      }
      if (ttsAudioRef.current) {
        ttsAudioRef.current.pause();
        ttsAudioRef.current.src = "";
        ttsAudioRef.current = null;
      }
      if (ttsAudioUrlRef.current) {
        URL.revokeObjectURL(ttsAudioUrlRef.current);
        ttsAudioUrlRef.current = null;
      }
      pendingNarrationRequestIdRef.current += 1;
      if (pendingAnimationNarrationUrlRef.current) {
        URL.revokeObjectURL(pendingAnimationNarrationUrlRef.current);
        pendingAnimationNarrationUrlRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!activeAnimationJobId) return;

    let cancelled = false;
    const poll = async () => {
      try {
        const response = await fetch(
          `/api/animation/jobs/${activeAnimationJobId}`,
          {
            cache: "no-store",
          },
        );
        if (!response.ok) return;
        const job = (await response.json()) as AnimationJobResponse;
        if (cancelled) return;

        setAnimationStatus(job.status);

        if (job.status === "completed" && job.videoUrl) {
          setAnimationVideoUrl(job.videoUrl);
          setActiveAnimationJobId(null);
          return;
        }

        if (job.status === "failed") {
          setActiveAnimationJobId(null);
          setAnimationChatHistory((prev) => [
            ...prev,
            createChatMessage(
              "assistant",
              `Animation render failed${job.error ? `: ${job.error}` : "."}`,
            ),
          ]);
        }
      } catch {
        // keep polling on transient failures
      }
    };

    poll();
    const timer = setInterval(poll, 3000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [activeAnimationJobId]);

  const desmosLoadedRef = useRef(false);

  useEffect(() => {
    const script = document.createElement("script");
    script.src =
      "https://www.desmos.com/api/v1.11/calculator.js?apiKey=52850a351a4541ac8df9b31fff086df9";
    script.async = true;
    script.onload = () => {
      desmosLoadedRef.current = true;
    };
    document.head.appendChild(script);
    return () => {
      if (script.parentNode) script.parentNode.removeChild(script);
    };
  }, []);

  useEffect(() => {
    if (calculatorRef.current) {
      calculatorRef.current.destroy();
      calculatorRef.current = null;
    }

    if (!graphWindowOpen) return;

    const Desmos = window.Desmos;
    const container = containerRef.current;
    if (!container || !Desmos) return;

    expressionIdRef.current = 0;

    const options = {
      expressions: true,
      settingsMenu: false,
      zoomButtons: true,
      lockViewport: false,
      expressionsCollapsed: true,
    };

    calculatorRef.current =
      dimension === "3d"
        ? Desmos.Calculator3D(container, options)
        : Desmos.GraphingCalculator(container, options);
  }, [dimension, graphWindowOpen]);

  useEffect(() => {
    if (!graphWindowOpen) return;

    const check = setInterval(() => {
      if (desmosLoadedRef.current) {
        clearInterval(check);
        const Desmos = window.Desmos;
        const container = containerRef.current;
        if (!container || !Desmos || calculatorRef.current) return;

        const options = {
          expressions: true,
          settingsMenu: false,
          zoomButtons: true,
          lockViewport: false,
          expressionsCollapsed: true,
        };

        calculatorRef.current =
          dimension === "3d"
            ? Desmos.Calculator3D(container, options)
            : Desmos.GraphingCalculator(container, options);
      }
    }, 50);
    return () => clearInterval(check);
  }, [dimension, graphWindowOpen]);

  const activeTabClass =
    "border-2 border-[hsl(var(--primary-strong))] bg-[hsl(var(--primary))] text-white";
  const isAnimationRendering =
    animationLoading ||
    animationStatus === "queued" ||
    animationStatus === "rendering";

  return (
    <div className="h-screen bg-[hsl(var(--background))]">
      <div className="flex h-full min-h-0 flex-col">
        <div className="flex items-center justify-between border-b border-[hsl(var(--border))] bg-[hsl(var(--card))] px-4 py-2">
          <p className="font-display text-lg font-medium tracking-tight text-[hsl(var(--primary))]">
            LoveLace
          </p>
          <Link
            href="/session"
            className="rounded-bl-[8px] rounded-br-[4px] rounded-tl-[4px] rounded-tr-[8px] border-2 border-[hsl(var(--primary-strong))] bg-[hsl(var(--card))] px-3 py-1.5 font-display text-xs font-medium tracking-wide text-[hsl(var(--primary))] hover:bg-[hsl(var(--card-strong))]"
          >
            Back
          </Link>
        </div>

        <div className="flex min-h-0 flex-1 gap-3 p-3">
          <section className="w-1/2 min-h-0">
            <div className="flex h-full flex-col gap-3">
              <div className="flex-1 min-h-0 overflow-hidden  border border-[hsl(var(--border))] bg-black p-4">
                <div className="flex h-full items-center justify-center  bg-black">
                  {animationVideoUrl ? (
                    <video
                      ref={animationVideoRef}
                      src={animationVideoUrl}
                      controls
                      playsInline
                      onLoadedData={handleAnimationVideoLoaded}
                      className="max-h-full max-w-full  bg-black"
                    >
                      <track
                        kind="captions"
                        src="data:text/vtt,WEBVTT"
                        srcLang="en"
                        label="English"
                      />
                    </video>
                  ) : (
                    <span className="text-sm text-[hsl(var(--muted-foreground))]">
                      {isAnimationRendering
                        ? "Rendering animation..."
                        : animationStatus === "failed"
                          ? "Render failed."
                          : "Animation output will appear here."}
                    </span>
                  )}
                </div>
              </div>

              <div className="h-[34%] min-h-[240px] overflow-hidden  border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-4 py-3">
                <p className="font-display mb-2 text-sm font-medium tracking-tight text-[hsl(var(--muted-foreground))]">
                  Conversation Transcript
                </p>
                <div className="h-[calc(100%-24px)] overflow-y-auto pr-1">
                  <div className="space-y-1 text-sm leading-6 text-[hsl(var(--foreground))]">
                    {animationChatHistory.map((msg) => (
                      <p
                        key={msg.id}
                        className="whitespace-pre-wrap break-words"
                      >
                        <span className="mr-2 text-[11px] font-medium tracking-tight text-[hsl(var(--muted-foreground))]">
                          {msg.role === "user" ? "You" : "Ada"}
                        </span>
                        {msg.text}
                      </p>
                    ))}
                    {animationLoading && (
                      <p className="text-[hsl(var(--muted-foreground))]">...</p>
                    )}
                  </div>
                  <div ref={animationChatEndRef} />
                </div>
              </div>
            </div>
          </section>

          <section className="w-1/2 min-h-0">
            <div className="flex h-full flex-col gap-3">
              <div className="overflow-hidden  border border-[hsl(var(--border))] bg-[hsl(var(--card))]">
                <div className="flex items-center justify-between border-b border-[hsl(var(--border))] px-4 py-2">
                  <p className="font-display text-sm font-medium tracking-tight text-[hsl(var(--muted-foreground))]">
                    User Input
                  </p>
                  <div className="flex items-center gap-2">
                    <span
                      className={`text-xs font-medium tracking-tight ${
                        inputMode === "audio"
                          ? "font-semibold text-[hsl(var(--primary))]"
                          : "text-[hsl(var(--muted-foreground))]"
                      }`}
                    >
                      Audio
                    </span>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={inputMode === "text"}
                      aria-label="Toggle between audio and text input"
                      onClick={() =>
                        setInputMode((prev) =>
                          prev === "audio" ? "text" : "audio",
                        )
                      }
                      className="relative inline-flex h-6 w-11 items-center  bg-[hsl(var(--card-strong))] transition-colors focus:outline-none focus:ring-2 focus:ring-[hsl(var(--primary))]/40"
                    >
                      <span
                        className={`inline-block h-5 w-5 transform  bg-[hsl(var(--primary))] transition-transform ${
                          inputMode === "text"
                            ? "translate-x-5"
                            : "translate-x-1"
                        }`}
                      />
                    </button>
                    <span
                      className={`text-xs font-medium tracking-tight ${
                        inputMode === "text"
                          ? "font-semibold text-[hsl(var(--primary))]"
                          : "text-[hsl(var(--muted-foreground))]"
                      }`}
                    >
                      Text
                    </span>
                  </div>
                </div>

                <div className="bg-[hsl(var(--card-strong))] px-4 py-3">
                  {inputMode === "text" ? (
                    <div className="flex gap-2">
                      <textarea
                        value={animationQuery}
                        onChange={(event) =>
                          setAnimationQuery(event.target.value)
                        }
                        placeholder="Describe the animation you want..."
                        className="min-h-[52px] flex-1 resize-none  border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-3 py-2 text-sm text-[hsl(var(--foreground))] outline-none focus:border-[hsl(var(--primary))]"
                        onKeyDown={(event) => {
                          if (event.key === "Enter" && !event.shiftKey) {
                            event.preventDefault();
                            void handleSubmit("animation");
                          }
                        }}
                      />
                      <button
                        type="button"
                        onClick={() => handleSubmit("animation")}
                        disabled={animationLoading}
                        aria-label="Send animation prompt"
                        className="flex min-h-[52px] items-center justify-center self-stretch rounded-bl-[10px] rounded-br-[5px] rounded-tl-[5px] rounded-tr-[10px] border-2 border-[hsl(var(--primary-strong))] bg-[hsl(var(--card))] px-4 text-[hsl(var(--primary))] hover:bg-[hsl(var(--card-strong))] disabled:cursor-not-allowed disabled:border-[hsl(var(--border))] disabled:bg-[hsl(var(--card-strong))] disabled:text-[hsl(var(--muted-foreground))] disabled:opacity-70"
                      >
                        {animationLoading ? (
                          "..."
                        ) : (
                          <Send className="h-4 w-4" />
                        )}
                      </button>
                    </div>
                  ) : (
                    <div className="flex min-h-[52px] items-center justify-center gap-3">
                      <span className="text-xs text-[hsl(var(--foreground))]/75">
                        {voiceTranscript
                          ? `Listening: ${voiceTranscript}`
                          : "Press Talk to record and transcribe voice."}
                      </span>
                      <button
                        type="button"
                        onClick={() => void handleTalkToggle()}
                        className={`rounded-bl-[10px] rounded-br-[5px] rounded-tl-[5px] rounded-tr-[10px] border-2 px-3 py-1.5 font-display text-xs font-medium tracking-wide text-white ${
                          isTalking
                            ? "border-red-800/70 bg-red-700 hover:bg-red-800"
                            : "border-[hsl(var(--primary-strong))] bg-[hsl(var(--primary))] hover:bg-[hsl(var(--primary-strong))]"
                        }`}
                      >
                        {isTalking ? "Stop" : "Talk"}
                      </button>
                    </div>
                  )}
                </div>
              </div>

              <div className="relative min-h-0 flex-1 overflow-hidden  border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-4 py-3">
                <p className="font-display mb-2 text-sm font-medium tracking-tight text-[hsl(var(--muted-foreground))]">
                  Whiteboard
                </p>
                <div className="relative h-[calc(100%-24px)] overflow-hidden  border border-[hsl(var(--border))]">
                  <Whiteboard ref={whiteboardRef} className="h-full" />
                  {!graphWindowOpen && (
                    <button
                      type="button"
                      onClick={() => setGraphWindowOpen(true)}
                      aria-label="Open graph workspace"
                      className="font-display absolute bottom-4 right-4 z-40 flex h-14 w-14 items-center justify-center rounded-bl-[14px] rounded-br-[7px] rounded-tl-[7px] rounded-tr-[14px] border-2 border-[hsl(var(--primary-strong))] bg-[hsl(var(--primary))] text-lg font-medium text-white shadow-lg transition hover:bg-[hsl(var(--primary-strong))]"
                    >
                      f(x)
                    </button>
                  )}
                </div>
              </div>
            </div>
          </section>
        </div>
      </div>

      {graphWindowOpen && (
        <div className="fixed inset-0 z-50 bg-[hsl(var(--overlay))]/25">
          <div className="absolute left-1/2 top-1/2 h-[86vh] w-[min(96vw,1320px)] -translate-x-1/2 -translate-y-1/2 overflow-hidden  border-2 border-[hsl(var(--primary))] bg-[hsl(var(--card))] shadow-2xl">
            <div className="h-12 flex items-center justify-between border-b border-[hsl(var(--border))] px-4">
              <p className="text-sm font-medium text-[hsl(var(--muted-foreground))]">
                Graph Workspace
              </p>
              <div className="flex items-center gap-2">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setDimension("2d")}
                    className={`rounded-bl-[8px] rounded-br-[4px] rounded-tl-[4px] rounded-tr-[8px] px-3 py-1 font-display text-sm font-medium tracking-wide ${dimension === "2d" ? activeTabClass : "border-2 border-[hsl(var(--border))] text-[hsl(var(--foreground))] hover:bg-[hsl(var(--card-strong))]"}`}
                  >
                    2D
                  </button>
                  <button
                    type="button"
                    onClick={() => setDimension("3d")}
                    className={`rounded-bl-[8px] rounded-br-[4px] rounded-tl-[4px] rounded-tr-[8px] px-3 py-1 font-display text-sm font-medium tracking-wide ${dimension === "3d" ? activeTabClass : "border-2 border-[hsl(var(--border))] text-[hsl(var(--foreground))] hover:bg-[hsl(var(--card-strong))]"}`}
                  >
                    3D
                  </button>
                </div>
                <button
                  type="button"
                  onClick={() => setGraphWindowOpen(false)}
                  aria-label="Close graph workspace"
                  className="h-8 w-8 rounded-bl-[8px] rounded-br-[4px] rounded-tl-[4px] rounded-tr-[8px] border-2 border-[hsl(var(--primary-strong))] font-display text-[hsl(var(--primary))] hover:bg-[hsl(var(--card-strong))]"
                >
                  X
                </button>
              </div>
            </div>
            <div className="flex h-[calc(100%-48px)] min-h-0">
              <div className="h-full w-[68%] border-r border-[hsl(var(--border))]">
                <div
                  id="calculator"
                  ref={containerRef}
                  className="h-full w-full"
                />
              </div>

              <div className="flex h-full w-[32%] flex-col p-4">
                <p className="text-sm font-semibold text-[hsl(var(--foreground))]">
                  Graph Assistant
                </p>
                <div className="mt-3 min-h-0 flex-1 overflow-y-auto pr-1">
                  <div className="space-y-1 text-sm leading-6 text-[hsl(var(--foreground))]">
                    {graphChatHistory.map((msg) => (
                      <p
                        key={msg.id}
                        className="whitespace-pre-wrap break-words"
                      >
                        <span className="mr-2 text-[11px] font-medium tracking-tight text-[hsl(var(--muted-foreground))]">
                          {msg.role === "user" ? "You" : "Ada"}
                        </span>
                        {msg.text}
                      </p>
                    ))}
                    {graphLoading && (
                      <p className="text-[hsl(var(--muted-foreground))]">...</p>
                    )}
                  </div>
                  <div ref={graphChatEndRef} />
                </div>

                <div className="mt-3 flex gap-2">
                  <input
                    type="text"
                    value={graphQuery}
                    onChange={(e) => setGraphQuery(e.target.value)}
                    onKeyDown={(e) =>
                      e.key === "Enter" && handleSubmit("graph")
                    }
                    placeholder="Describe the graph changes you want..."
                    className="flex-1  border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-3 py-2 text-sm text-[hsl(var(--foreground))] outline-none focus:border-[hsl(var(--primary))]"
                  />
                  <button
                    type="button"
                    onClick={() => handleSubmit("graph")}
                    aria-label="Send graph prompt"
                    className="flex h-[42px] w-[42px] items-center justify-center rounded-bl-[8px] rounded-br-[4px] rounded-tl-[4px] rounded-tr-[8px] border-2 border-[hsl(var(--primary-strong))] bg-[hsl(var(--card))] text-[hsl(var(--primary))] hover:bg-[hsl(var(--card-strong))] disabled:cursor-not-allowed disabled:border-[hsl(var(--muted))] disabled:bg-[hsl(var(--muted))] disabled:text-[hsl(var(--muted-foreground))] disabled:opacity-60"
                    disabled={graphLoading}
                  >
                    {graphLoading ? "..." : <Send className="h-4 w-4" />}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

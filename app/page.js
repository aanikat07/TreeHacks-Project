"use client";

import { useRef, useState } from "react";

export default function Page() {
  const [status, setStatus] = useState("Idle.");
  const [subtitles, setSubtitles] = useState("");
  const [log, setLog] = useState("");
  const [started, setStarted] = useState(false);
  const [muted, setMuted] = useState(false);

  const pcRef = useRef(null);
  const dcRef = useRef(null);
  const micStreamRef = useRef(null);

  function appendLog(s) {
    setLog((prev) => prev + s + "\n");
  }

  function sendEvent(evt) {
    const dc = dcRef.current;
    if (dc && dc.readyState === "open") dc.send(JSON.stringify(evt));
  }

  // Dummy drawing hook (swap later with your friend's canvas snapshot)
  function getLatestDrawingDataUrl() {
    return null; // later: return canvas.toDataURL("image/png")
  }

  async function start() {
    setStatus("Requesting microphone…");

    const micStream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    micStreamRef.current = micStream;

    const pc = new RTCPeerConnection();
    pcRef.current = pc;

    // Play assistant audio
    const audioEl = new Audio();
    audioEl.autoplay = true;
    audioEl.playsInline = true;

    pc.ontrack = (e) => {
      audioEl.srcObject = e.streams[0];
    };

    // Send mic audio
    const [track] = micStream.getAudioTracks();
    pc.addTrack(track, micStream);

    // Data channel (events)
    const dc = pc.createDataChannel("oai-events");
    dcRef.current = dc;

    // Turn buffers
    let turnActive = false;
    let turnTranscript = "";
    let transcriptItemId = null;

    function finalizeAndSendTurn() {
      const text = (turnTranscript || "").trim();
      const img = getLatestDrawingDataUrl();

      if (!text && !img) return;

      const content = [];
      if (text) content.push({ type: "input_text", text });
      if (img) content.push({ type: "input_image", image_url: img });

      // Send user message (text + optional sketch)
      sendEvent({
        type: "conversation.item.create",
        item: { type: "message", role: "user", content },
      });

      // Ask model to respond now
      sendEvent({ type: "response.create" });

      turnTranscript = "";
      transcriptItemId = null;
    }

    dc.onopen = () => {
      setStarted(true);
      setStatus("Connected. Always listening.");

      sendEvent({
        type: "session.update",
        session: {
            type: "realtime",                 // ✅ required
            model: "gpt-realtime",

            output_modalities: ["audio"],  // ✅ use this (NOT session.modalities)

            audio: {
            input: {
                turn_detection: {
                type: "server_vad",
                threshold: 0.55,
                prefix_padding_ms: 250,
                silence_duration_ms: 2000,
                create_response: false,     // manual response so you can attach image
                interrupt_response: true
                }
            },
            output: { voice: "marin" }
            },

            instructions: [
            "You are a cordial, helpful real-time TA.",
            "If the user message includes a sketch image, use it to guide the explanation.",
            "If not math-related, respond normally.",
            "Keep responses clear and not too long."
            ].join("\n")
        }
        });


    };

    dc.onmessage = (e) => {
      let evt;
      try { evt = JSON.parse(e.data); } catch { return; }

      if (evt.type === "input_audio_buffer.speech_started") {
        turnActive = true;
        turnTranscript = "";
        transcriptItemId = null;
        appendLog("speech_started");
        return;
      }

      // User transcription (whisper-1)
      if (evt.type === "conversation.item.input_audio_transcription.delta") {
        if (!transcriptItemId) transcriptItemId = evt.item_id;
        if (turnActive && evt.item_id === transcriptItemId) {
          // Often transcript-so-far
          turnTranscript = evt.delta || "";
        }
        return;
      }

      if (evt.type === "conversation.item.input_audio_transcription.completed") {
        if (!transcriptItemId) transcriptItemId = evt.item_id;
        if (evt.item_id === transcriptItemId) {
          turnTranscript = evt.transcript || turnTranscript || "";
        }
        return;
      }

      if (evt.type === "input_audio_buffer.speech_stopped") {
        turnActive = false;
        appendLog("speech_stopped → sending text(+image)");
        setTimeout(finalizeAndSendTurn, 250); // small buffer for last transcript event
        return;
      }

      // Assistant captions
      if (evt.type === "response.output_text.delta" && evt.delta) {
        setSubtitles((prev) => prev + evt.delta);
        return;
      }
      if (evt.type === "response.output_text.done") {
        setTimeout(() => setSubtitles(""), 1200);
        return;
      }

      if (evt.type === "error") {
        appendLog("ERROR: " + (evt.error?.message || JSON.stringify(evt)));
      }
    };

    // WebRTC offer/answer through your Vercel API route
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    setStatus("Creating session…");
    const r = await fetch("/api/session", {
      method: "POST",
      headers: { "Content-Type": "application/sdp" },
      body: offer.sdp,
    });
    if (!r.ok) throw new Error(await r.text());

    const answerSdp = await r.text();
    await pc.setRemoteDescription({ type: "answer", sdp: answerSdp });

    setStatus("Live. Speak normally.");
  }

  function toggleMute() {
    const stream = micStreamRef.current;
    if (!stream) return;
    const next = !muted;
    setMuted(next);
    stream.getAudioTracks().forEach((t) => (t.enabled = !next));
    setStatus(next ? "Muted." : "Live. Speak normally.");
  }

  function stop() {
    setStatus("Stopping…");
    try {
      sendEvent({ type: "response.cancel" });
      sendEvent({ type: "output_audio_buffer.clear" });
    } catch {}

    dcRef.current?.close();
    pcRef.current?.close();
    micStreamRef.current?.getTracks().forEach((t) => t.stop());

    dcRef.current = null;
    pcRef.current = null;
    micStreamRef.current = null;

    setStarted(false);
    setMuted(false);
    setSubtitles("");
    setStatus("Stopped.");
  }

  return (
    <main style={{ fontFamily: "system-ui", padding: 16 }}>
      <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
        <button onClick={start} disabled={started}>Start</button>
        <button onClick={toggleMute} disabled={!started}>
          {muted ? "Unmute mic" : "Mute mic"}
        </button>
        <button onClick={stop} disabled={!started}>Stop</button>
      </div>

      <div style={{ marginTop: 12, width: 360, height: 220, border: "2px dashed #bbb", borderRadius: 10, display: "flex", alignItems: "center", justifyContent: "center", color: "#666" }}>
        Drawing area (your friend will replace this)
      </div>

      <div style={{ marginTop: 10, opacity: 0.85 }}>{status}</div>
      <div style={{ marginTop: 10, fontSize: 18, minHeight: 26 }}>{subtitles}</div>

      <pre style={{ marginTop: 10, whiteSpace: "pre-wrap", background: "#f6f6f6", padding: 10, borderRadius: 8, height: 220, overflow: "auto" }}>
        {log}
      </pre>
    </main>
  );
}

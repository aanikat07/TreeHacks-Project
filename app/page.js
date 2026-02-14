"use client";

import { useEffect, useRef, useState } from "react";

export default function Page() {
  // ===== realtime state =====
  const [status, setStatus] = useState("Idle.");
  const [subtitles, setSubtitles] = useState("");
  const [log, setLog] = useState("");
  const [started, setStarted] = useState(false);
  const [muted, setMuted] = useState(false);

  const pcRef = useRef(null);
  const dcRef = useRef(null);
  const micStreamRef = useRef(null);

  // ===== whiteboard state =====
  const canvasRef = useRef(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [color, setColor] = useState("black");
  const [tool, setTool] = useState("brush"); // "brush" | "eraser"
  const colors = ["black", "red", "blue"];

  function appendLog(s) {
    setLog((prev) => prev + s + "\n");
  }

  function sendEvent(evt) {
    const dc = dcRef.current;
    if (dc && dc.readyState === "open") dc.send(JSON.stringify(evt));
  }

  // Make sure the background is white so "eraser" works + exported image isn't transparent
  function fillCanvasWhite() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.save();
    ctx.globalCompositeOperation = "source-over";
    ctx.fillStyle = "white";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.restore();
  }

  useEffect(() => {
    fillCanvasWhite();
  }, []);

  // ===== Drawing: coords for mouse OR touch (no TS types needed) =====
  const getCoords = (e) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();

    // Touch
    if (e.touches || e.changedTouches) {
      const t = (e.touches && e.touches[0]) || (e.changedTouches && e.changedTouches[0]);
      if (!t) return { x: 0, y: 0 };
      return { x: t.clientX - rect.left, y: t.clientY - rect.top };
    }

    // Mouse
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const startDrawing = (e) => {
    e.preventDefault();
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;

    const { x, y } = getCoords(e);
    ctx.beginPath();
    ctx.moveTo(x, y);
    setIsDrawing(true);
  };

  const draw = (e) => {
    e.preventDefault();
    if (!isDrawing) return;

    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;

    const { x, y } = getCoords(e);

    ctx.strokeStyle = tool === "eraser" ? "white" : color;
    ctx.lineWidth = tool === "eraser" ? 20 : 4;
    ctx.lineCap = "round";

    ctx.lineTo(x, y);
    ctx.stroke();
  };

  const stopDrawing = (e) => {
    if (e?.preventDefault) e.preventDefault();
    setIsDrawing(false);
  };

  const clearBoard = () => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!ctx || !canvas) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    fillCanvasWhite();
  };

  // ====== bridge: snapshot image ======
  function getLatestDrawingDataUrl() {
    const canvas = canvasRef.current;
    if (!canvas) return null;

    // JPEG is much smaller than PNG for realtime
    return canvas.toDataURL("image/jpeg", 0.85);
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

      // optional: clear after each spoken turn
      // clearBoard();
    }

    dc.onopen = () => {
      setStarted(true);
      setStatus("Connected. Always listening.");

      sendEvent({
        type: "session.update",
        session: {
          type: "realtime",
          model: "gpt-realtime",

          // If you want text subtitle events, include "text"
          output_modalities: ["audio"],

          audio: {
            input: {
              turn_detection: {
                type: "server_vad",
                threshold: 0.55,
                prefix_padding_ms: 250,
                silence_duration_ms: 1500,
                create_response: false, // manual response so you can attach image
                interrupt_response: true,
              },
            },
            output: { voice: "marin" },
          },

          instructions: [
            "You are a cordial, helpful real-time TA.",
            "If the user message includes a sketch image, use it to guide the explanation.",
            "If not math-related, respond normally.",
            "Keep responses clear and not too long.",
          ].join("\n"),
        },
      });
    };

    dc.onmessage = (e) => {
      let evt;
      try {
        evt = JSON.parse(e.data);
      } catch {
        return;
      }

      if (evt.type === "input_audio_buffer.speech_started") {
        turnActive = true;
        turnTranscript = "";
        transcriptItemId = null;
        appendLog("speech_started");
        return;
      }

      // User transcription
      if (evt.type === "conversation.item.input_audio_transcription.delta") {
        if (!transcriptItemId) transcriptItemId = evt.item_id;
        if (turnActive && evt.item_id === transcriptItemId) {
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
        setTimeout(finalizeAndSendTurn, 250);
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
      {/* controls */}
      <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
        <button onClick={start} disabled={started}>
          Start
        </button>
        <button onClick={toggleMute} disabled={!started}>
          {muted ? "Unmute mic" : "Mute mic"}
        </button>
        <button onClick={stop} disabled={!started}>
          Stop
        </button>
      </div>

      {/* toolbar (from friend) */}
      <div style={{ marginTop: 16, display: "flex", alignItems: "center", gap: 12 }}>
        {colors.map((c) => (
          <button
            key={c}
            onClick={() => {
              setColor(c);
              setTool("brush");
            }}
            style={{
              width: 28,
              height: 28,
              borderRadius: 999,
              background: c,
              border: color === c && tool === "brush" ? "2px solid #000" : "2px solid transparent",
              transform: color === c && tool === "brush" ? "scale(1.08)" : "scale(1)",
              cursor: "pointer",
            }}
            aria-label={`color-${c}`}
          />
        ))}

        <button
          onClick={() => setTool("eraser")}
          style={{
            width: 36,
            height: 36,
            borderRadius: 10,
            border: "1px solid #ddd",
            background: tool === "eraser" ? "#eee" : "#fff",
            cursor: "pointer",
          }}
          aria-label="eraser"
        >
          🧼
        </button>

        <button onClick={clearBoard} style={{ marginLeft: 8 }}>
          Clear
        </button>
      </div>

      {/* CANVAS (the missing piece you suspected) */}
      <div style={{ marginTop: 12 }}>
        <canvas
          ref={canvasRef}
          width={900}
          height={550}
          style={{
            background: "#fff",
            border: "1px solid #ddd",
            borderRadius: 12,
            touchAction: "none",
            maxWidth: "100%",
          }}
          onMouseDown={startDrawing}
          onMouseMove={draw}
          onMouseUp={stopDrawing}
          onMouseLeave={stopDrawing}
          onTouchStart={startDrawing}
          onTouchMove={draw}
          onTouchEnd={stopDrawing}
          onTouchCancel={stopDrawing}
        />
      </div>

      <div style={{ marginTop: 10, opacity: 0.85 }}>{status}</div>
      <div style={{ marginTop: 10, fontSize: 18, minHeight: 26 }}>{subtitles}</div>

      <pre
        style={{
          marginTop: 10,
          whiteSpace: "pre-wrap",
          background: "#f6f6f6",
          padding: 10,
          borderRadius: 8,
          height: 220,
          overflow: "auto",
        }}
      >
        {log}
      </pre>
    </main>
  );
}

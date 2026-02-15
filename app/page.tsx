"use client";

import { useEffect, useRef, useState } from "react";

type AppMode = "graph" | "animation";

interface ChatMessage {
  role: "user" | "assistant";
  text: string;
  code?: string;
}

interface AnimationPayload {
  jobId: string;
  status: "queued" | "rendering" | "completed" | "failed";
  code: string;
}

interface AnimationJobResponse {
  id: string;
  status: "queued" | "rendering" | "completed" | "failed";
  videoUrl?: string;
  error?: string;
}

export default function Home() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const calculatorRef = useRef<any>(null);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [chatHistory, setChatHistory] = useState<ChatMessage[]>([]);
  const chatEndRef = useRef<HTMLDivElement | null>(null);
  const [mode, setMode] = useState<AppMode>("graph");
  const [dimension, setDimension] = useState<"2d" | "3d">("3d");
  const expressionIdRef = useRef(0);
  const [activeAnimationJobId, setActiveAnimationJobId] = useState<string | null>(
    null,
  );
  const [animationVideoUrl, setAnimationVideoUrl] = useState<string | null>(null);
  const [animationStatus, setAnimationStatus] = useState<
    "idle" | "queued" | "rendering" | "completed" | "failed"
  >("idle");

  const getCurrentExpressions = () => {
    const calculator = calculatorRef.current;
    if (!calculator) return [];
    const exprs = calculator.getExpressions();
    return exprs
      .filter((e: any) => e.latex)
      .map((e: any) => ({ id: e.id, latex: e.latex }));
  };

  const handleModeChange = (nextMode: AppMode) => {
    if (nextMode === mode) return;
    setMode(nextMode);
    setChatHistory([]);
    setQuery("");
    setActiveAnimationJobId(null);
    setAnimationVideoUrl(null);
    setAnimationStatus("idle");
  };

  const handleSubmit = async () => {
    if (!query.trim() || loading) return;
    const userMessage = query.trim();
    setChatHistory((prev) => [...prev, { role: "user", text: userMessage }]);
    setLoading(true);

    try {
      if (mode === "animation") {
        setAnimationVideoUrl(null);
        setAnimationStatus("queued");
      }

      const currentExpressions = mode === "graph" ? getCurrentExpressions() : [];
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query, currentExpressions, dimension, mode }),
      });
      const data = await res.json();

      const calculator = calculatorRef.current;
      if (mode === "graph" && calculator && Array.isArray(data.actions)) {
        const tempIdMap = new Map<string, string>();

        for (const action of data.actions) {
          switch (action.type) {
            case "add": {
              expressionIdRef.current += 1;
              const realId = `expr-${expressionIdRef.current}`;
              calculator.setExpression({ id: realId, latex: action.latex });
              if (action.id) tempIdMap.set(action.id, realId);
              break;
            }
            case "remove": {
              const resolvedId = tempIdMap.get(action.id) || action.id;
              calculator.removeExpression({ id: resolvedId });
              break;
            }
            case "set": {
              const resolvedId = tempIdMap.get(action.id) || action.id;
              calculator.setExpression({ id: resolvedId, latex: action.latex });
              break;
            }
          }
        }
      }

      const reply = data.message || "Done.";
      if (mode === "animation" && data.animation) {
        const animation = data.animation as AnimationPayload;
        setActiveAnimationJobId(animation.jobId);
        setAnimationStatus(animation.status);
        setChatHistory((prev) => [
          ...prev,
          { role: "assistant", text: reply, code: animation.code },
        ]);
      } else {
        setChatHistory((prev) => [...prev, { role: "assistant", text: reply }]);
      }
    } catch (err) {
      console.error("Failed to process query:", err);
      setChatHistory((prev) => [
        ...prev,
        { role: "assistant", text: "Something went wrong." },
      ]);
      if (mode === "animation") {
        setAnimationStatus("failed");
      }
    } finally {
      setLoading(false);
      setQuery("");
    }
  };

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatHistory]);

  useEffect(() => {
    if (mode !== "animation" || !activeAnimationJobId) return;

    let cancelled = false;
    const poll = async () => {
      try {
        const response = await fetch(`/api/animation/jobs/${activeAnimationJobId}`, {
          cache: "no-store",
        });
        if (!response.ok) return;
        const job = (await response.json()) as AnimationJobResponse;
        if (cancelled) return;

        setAnimationStatus(job.status);

        if (job.status === "completed" && job.videoUrl) {
          setAnimationVideoUrl(job.videoUrl);
          setActiveAnimationJobId(null);
          setChatHistory((prev) => [
            ...prev,
            { role: "assistant", text: "Animation render complete." },
          ]);
          return;
        }

        if (job.status === "failed") {
          setActiveAnimationJobId(null);
          setChatHistory((prev) => [
            ...prev,
            {
              role: "assistant",
              text: `Animation render failed${job.error ? `: ${job.error}` : "."}`,
            },
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
  }, [activeAnimationJobId, mode]);

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

    if (mode !== "graph") return;

    const Desmos = (window as any).Desmos;
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
  }, [dimension, mode]);

  useEffect(() => {
    const check = setInterval(() => {
      if (desmosLoadedRef.current) {
        clearInterval(check);
        const Desmos = (window as any).Desmos;
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
  }, [dimension]);

  const shellAccentClass = "border-orange-500";
  const activeTabClass = "bg-orange-500 text-white border-orange-600";
  const inactiveTabClass =
    "bg-orange-300 text-white border-orange-400 hover:bg-orange-400";

  return (
    <div className="h-screen bg-orange-50">
      <div className="h-full flex flex-col">
        <div className="flex items-end">
          <button
            onClick={() => handleModeChange("graph")}
            className={`w-40 border px-5 py-2 text-sm font-semibold text-center transition ${
              mode === "graph" ? activeTabClass : inactiveTabClass
            }`}
          >
            Graph
          </button>
          <button
            onClick={() => handleModeChange("animation")}
            className={`w-40 border px-5 py-2 text-sm font-semibold text-center transition ${
              mode === "animation" ? activeTabClass : inactiveTabClass
            }`}
          >
            Animation
          </button>
        </div>

        <div className={`flex-1 min-h-0 border-2 bg-white ${shellAccentClass}`}>
          <div className="h-12 flex items-center justify-between px-4 border-b border-gray-200">
            <p className="text-sm font-medium text-gray-700">
              {mode === "graph" ? "Graph Workspace" : "Animation Workspace"}
            </p>

            {mode === "graph" && (
              <div className="flex rounded border border-gray-300 overflow-hidden">
                <button
                  onClick={() => setDimension("2d")}
                  className={`px-3 py-1 text-sm ${dimension === "2d" ? activeTabClass : "text-black hover:bg-gray-100"}`}
                >
                  2D
                </button>
                <button
                  onClick={() => setDimension("3d")}
                  className={`px-3 py-1 text-sm ${dimension === "3d" ? activeTabClass : "text-black hover:bg-gray-100"}`}
                >
                  3D
                </button>
              </div>
            )}
          </div>

          <div className="flex flex-1 min-h-0 h-[calc(100%-49px)]">
            <div className="w-1/2 h-full border-r border-gray-200">
              {mode === "graph" ? (
                <div id="calculator" ref={containerRef} className="w-full h-full" />
              ) : (
                <div className="w-full h-full bg-gray-50 flex items-center justify-center p-4">
                  {animationVideoUrl ? (
                    <video
                      src={animationVideoUrl}
                      controls
                      className="max-h-full max-w-full rounded border border-gray-200 bg-black"
                    />
                  ) : (
                    <span className="text-gray-500 text-sm">
                      {loading || animationStatus === "queued" || animationStatus === "rendering"
                        ? "Rendering animation..."
                        : animationStatus === "failed"
                          ? "Render failed."
                          : "Animation output will appear here."}
                    </span>
                  )}
                </div>
              )}
            </div>

            <div className="w-1/2 h-full flex flex-col p-8">
              <h1 className="text-black font-sans text-5xl sm:text-2xl font-semibold">
                Hello, Om
              </h1>
              <div className="flex-1 min-h-0 mt-4 overflow-y-auto">
                {chatHistory.map((msg, i) => (
                  <div
                    key={i}
                    className={`mb-3 ${msg.role === "user" ? "text-right" : "text-left"}`}
                  >
                    <span
                      className={`inline-block px-3 py-1.5 rounded text-sm ${
                        msg.role === "user" ? "bg-black text-white" : "bg-gray-100 text-black"
                      }`}
                    >
                      {msg.text}
                    </span>
                    {msg.code && (
                      <pre className="mt-2 p-3 rounded text-xs bg-gray-900 text-gray-100 overflow-x-auto">
                        <code>{msg.code}</code>
                      </pre>
                    )}
                  </div>
                ))}
                {loading && (
                  <div className="mb-3 text-left">
                    <span className="inline-block px-3 py-1.5 rounded text-sm bg-gray-100 text-gray-400">
                      ...
                    </span>
                  </div>
                )}
                <div ref={chatEndRef} />
              </div>
              <div className="flex mt-4">
                <input
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
                  placeholder={
                    mode === "animation"
                      ? "Describe the animation you want..."
                      : "Type something..."
                  }
                  className="flex-1 border border-gray-300 rounded-l px-3 py-2 text-black text-sm outline-none focus:border-black"
                />
                <button
                  onClick={handleSubmit}
                  className="border border-l-0 border-gray-300 rounded-r px-4 py-2 text-black text-sm hover:bg-gray-100"
                  disabled={loading}
                >
                  {loading ? "..." : "Submit"}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

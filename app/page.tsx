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

  const getCurrentExpressions = () => {
    const calculator = calculatorRef.current;
    if (!calculator) return [];
    const exprs = calculator.getExpressions();
    return exprs
      .filter((e: any) => e.latex)
      .map((e: any) => ({ id: e.id, latex: e.latex }));
  };

  const handleSubmit = async (targetMode: AppMode) => {
    const query = targetMode === "graph" ? graphQuery : animationQuery;
    const loading = targetMode === "graph" ? graphLoading : animationLoading;
    if (!query.trim() || loading) return;

    const userMessage = query.trim();
    if (targetMode === "graph") {
      setGraphChatHistory((prev) => [
        ...prev,
        { role: "user", text: userMessage },
      ]);
      setGraphLoading(true);
    } else {
      setAnimationChatHistory((prev) => [
        ...prev,
        { role: "user", text: userMessage },
      ]);
      setAnimationLoading(true);
    }

    try {
      if (targetMode === "animation") {
        setAnimationVideoUrl(null);
        setAnimationStatus("queued");
      }

      const currentExpressions =
        targetMode === "graph" ? getCurrentExpressions() : [];
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query: userMessage,
          currentExpressions,
          dimension,
          mode: targetMode,
        }),
      });
      const data = await res.json();

      const calculator = calculatorRef.current;
      if (targetMode === "graph" && calculator && Array.isArray(data.actions)) {
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
      if (targetMode === "animation" && data.animation) {
        const animation = data.animation as AnimationPayload;
        setActiveAnimationJobId(animation.jobId);
        setAnimationStatus(animation.status);
        setAnimationChatHistory((prev) => [
          ...prev,
          { role: "assistant", text: reply },
        ]);
      } else {
        const setTargetChatHistory =
          targetMode === "graph"
            ? setGraphChatHistory
            : setAnimationChatHistory;
        setTargetChatHistory((prev) => [
          ...prev,
          { role: "assistant", text: reply },
        ]);
      }
    } catch (err) {
      console.error("Failed to process query:", err);
      const setTargetChatHistory =
        targetMode === "graph" ? setGraphChatHistory : setAnimationChatHistory;
      setTargetChatHistory((prev) => [
        ...prev,
        { role: "assistant", text: "Something went wrong." },
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
    animationChatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [animationChatHistory]);

  useEffect(() => {
    graphChatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [graphChatHistory]);

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
          setAnimationChatHistory((prev) => [
            ...prev,
            { role: "assistant", text: "Animation render complete." },
          ]);
          return;
        }

        if (job.status === "failed") {
          setActiveAnimationJobId(null);
          setAnimationChatHistory((prev) => [
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
  }, [dimension, graphWindowOpen]);

  useEffect(() => {
    if (!graphWindowOpen) return;

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
  }, [dimension, graphWindowOpen]);

  const shellAccentClass = "border-orange-500";
  const activeTabClass = "bg-orange-500 text-white border-orange-600";

  return (
    <div className="h-screen bg-orange-50">
      <div className="h-full flex flex-col">
        <div className={`flex-1 min-h-0 border-2 bg-white ${shellAccentClass}`}>
          <div className="h-12 flex items-center justify-between px-4 border-b border-gray-200">
            <p className="text-sm font-medium text-gray-700">
              Animation Workspace
            </p>
          </div>

          <div className="flex flex-1 min-h-0 h-[calc(100%-49px)]">
            <div className="w-1/2 h-full border-r border-gray-200">
              <div className="w-full h-full bg-black flex items-center justify-center p-4">
                {animationVideoUrl ? (
                  <video
                    src={animationVideoUrl}
                    controls
                    className="max-h-full max-w-full rounded border border-gray-200 bg-black"
                  />
                ) : (
                  <span className="text-gray-500 text-sm">
                    {animationLoading ||
                    animationStatus === "queued" ||
                    animationStatus === "rendering"
                      ? "Rendering animation..."
                      : animationStatus === "failed"
                        ? "Render failed."
                        : "Animation output will appear here."}
                  </span>
                )}
              </div>
            </div>

            <div className="w-1/2 h-full flex flex-col p-8">
              <h1 className="text-black font-sans text-5xl sm:text-2xl font-semibold">
                Hello, Om
              </h1>
              <div className="flex-1 min-h-0 mt-4 overflow-y-auto">
                {animationChatHistory.map((msg, i) => (
                  <div
                    key={i}
                    className={`mb-3 ${msg.role === "user" ? "text-right" : "text-left"}`}
                  >
                    <span
                      className={`inline-block px-3 py-1.5 rounded text-sm ${
                        msg.role === "user"
                          ? "bg-black text-white"
                          : "bg-gray-100 text-black"
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
                {animationLoading && (
                  <div className="mb-3 text-left">
                    <span className="inline-block px-3 py-1.5 rounded text-sm bg-gray-100 text-gray-400">
                      ...
                    </span>
                  </div>
                )}
                <div ref={animationChatEndRef} />
              </div>
              <div className="flex mt-4">
                <input
                  type="text"
                  value={animationQuery}
                  onChange={(e) => setAnimationQuery(e.target.value)}
                  onKeyDown={(e) =>
                    e.key === "Enter" && handleSubmit("animation")
                  }
                  placeholder="Describe the animation you want..."
                  className="flex-1 border border-gray-300 rounded-l px-3 py-2 text-black text-sm outline-none focus:border-black"
                />
                <button
                  type="button"
                  onClick={() => handleSubmit("animation")}
                  className="border border-l-0 border-gray-300 rounded-r px-4 py-2 text-black text-sm hover:bg-gray-100"
                  disabled={animationLoading}
                >
                  {animationLoading ? "..." : "Submit"}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {!graphWindowOpen && (
        <button
          type="button"
          onClick={() => setGraphWindowOpen(true)}
          aria-label="Open graph workspace"
          className="fixed bottom-6 right-6 z-40 h-14 w-14 rounded-full bg-orange-500 text-white text-lg font-semibold shadow-lg hover:bg-orange-600 transition"
        >
          f(x)
        </button>
      )}

      {graphWindowOpen && (
        <div className="fixed inset-0 z-50 bg-black/20">
          <div className="absolute left-1/2 top-1/2 h-[86vh] w-[min(96vw,1320px)] -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-lg border-2 border-orange-500 bg-white shadow-2xl">
            <div className="h-12 flex items-center justify-between px-4 border-b border-gray-200">
              <p className="text-sm font-medium text-gray-700">
                Graph Workspace
              </p>
              <div className="flex items-center gap-2">
                <div className="flex rounded border border-gray-300 overflow-hidden">
                  <button
                    type="button"
                    onClick={() => setDimension("2d")}
                    className={`px-3 py-1 text-sm ${dimension === "2d" ? activeTabClass : "text-black hover:bg-gray-100"}`}
                  >
                    2D
                  </button>
                  <button
                    type="button"
                    onClick={() => setDimension("3d")}
                    className={`px-3 py-1 text-sm ${dimension === "3d" ? activeTabClass : "text-black hover:bg-gray-100"}`}
                  >
                    3D
                  </button>
                </div>
                <button
                  type="button"
                  onClick={() => setGraphWindowOpen(false)}
                  aria-label="Close graph workspace"
                  className="h-8 w-8 rounded border border-gray-300 text-gray-700 hover:bg-gray-100"
                >
                  X
                </button>
              </div>
            </div>
            <div className="h-[calc(100%-48px)] flex min-h-0">
              <div className="w-[68%] h-full border-r border-gray-200">
                <div
                  id="calculator"
                  ref={containerRef}
                  className="h-full w-full"
                />
              </div>

              <div className="w-[32%] h-full flex flex-col p-4">
                <p className="text-sm font-semibold text-gray-800">
                  Graph Assistant
                </p>
                <div className="flex-1 min-h-0 mt-3 overflow-y-auto">
                  {graphChatHistory.map((msg, i) => (
                    <div
                      key={i}
                      className={`mb-3 ${msg.role === "user" ? "text-right" : "text-left"}`}
                    >
                      <span
                        className={`inline-block px-3 py-1.5 rounded text-sm ${
                          msg.role === "user"
                            ? "bg-black text-white"
                            : "bg-gray-100 text-black"
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
                  {graphLoading && (
                    <div className="mb-3 text-left">
                      <span className="inline-block px-3 py-1.5 rounded text-sm bg-gray-100 text-gray-400">
                        ...
                      </span>
                    </div>
                  )}
                  <div ref={graphChatEndRef} />
                </div>

                <div className="flex mt-3">
                  <input
                    type="text"
                    value={graphQuery}
                    onChange={(e) => setGraphQuery(e.target.value)}
                    onKeyDown={(e) =>
                      e.key === "Enter" && handleSubmit("graph")
                    }
                    placeholder="Describe the graph changes you want..."
                    className="flex-1 border border-gray-300 rounded-l px-3 py-2 text-black text-sm outline-none focus:border-black"
                  />
                  <button
                    type="button"
                    onClick={() => handleSubmit("graph")}
                    className="border border-l-0 border-gray-300 rounded-r px-4 py-2 text-black text-sm hover:bg-gray-100"
                    disabled={graphLoading}
                  >
                    {graphLoading ? "..." : "Submit"}
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

"use client";

import { Eraser, Pencil, Trash2, Undo2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";

type Tool = "brush" | "eraser";

const COLORS = ["#111111", "#ef4444", "#2563eb", "#16a34a", "#f97316"];

interface WhiteboardProps {
  className?: string;
}

export default function Whiteboard({ className = "" }: WhiteboardProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const historyRef = useRef<ImageData[]>([]);
  const [tool, setTool] = useState<Tool>("brush");
  const [color, setColor] = useState(COLORS[0]);
  const [isDrawing, setIsDrawing] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const resize = () => {
      const rect = container.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;

      const nextWidth = Math.max(1, Math.floor(rect.width));
      const nextHeight = Math.max(1, Math.floor(rect.height));

      const snapshot = ctx.getImageData(0, 0, canvas.width, canvas.height);

      canvas.width = Math.floor(nextWidth * dpr);
      canvas.height = Math.floor(nextHeight * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, nextWidth, nextHeight);

      if (snapshot.width > 0 && snapshot.height > 0) {
        const temp = document.createElement("canvas");
        temp.width = snapshot.width;
        temp.height = snapshot.height;
        const tempCtx = temp.getContext("2d");
        if (tempCtx) {
          tempCtx.putImageData(snapshot, 0, 0);
          ctx.drawImage(temp, 0, 0, nextWidth, nextHeight);
        }
      }
    };

    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(container);

    return () => observer.disconnect();
  }, []);

  const getPoint = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    return {
      x: (event.clientX - rect.left) * dpr,
      y: (event.clientY - rect.top) * dpr,
    };
  };

  const handlePointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;

    historyRef.current.push(
      ctx.getImageData(0, 0, canvas.width, canvas.height),
    );
    if (historyRef.current.length > 50) historyRef.current.shift();

    canvas.setPointerCapture(event.pointerId);
    const point = getPoint(event);

    ctx.beginPath();
    ctx.moveTo(
      point.x / (window.devicePixelRatio || 1),
      point.y / (window.devicePixelRatio || 1),
    );
    setIsDrawing(true);
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!isDrawing) return;

    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const point = getPoint(event);

    ctx.strokeStyle = tool === "eraser" ? "#ffffff" : color;
    ctx.lineWidth = tool === "eraser" ? 18 : 3;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.lineTo(point.x / dpr, point.y / dpr);
    ctx.stroke();
  };

  const stopDrawing = () => {
    setIsDrawing(false);
  };

  const clearBoard = () => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;

    historyRef.current.push(
      ctx.getImageData(0, 0, canvas.width, canvas.height),
    );
    if (historyRef.current.length > 50) historyRef.current.shift();

    const dpr = window.devicePixelRatio || 1;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width / dpr, canvas.height / dpr);
  };

  const undo = () => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const previous = historyRef.current.pop();
    if (!previous) return;
    ctx.putImageData(previous, 0, 0);
  };

  return (
    <div className={`flex h-full flex-col ${className}`}>
      <div className="flex items-center gap-2 border-b border-[hsl(var(--border))] bg-[hsl(var(--card-strong))] px-3 py-2">
        <div className="flex items-center gap-1.5">
          {COLORS.map((swatch) => (
            <button
              key={swatch}
              type="button"
              aria-label="Select color"
              onClick={() => {
                setColor(swatch);
                setTool("brush");
              }}
              className="h-5 w-5  border-2"
              style={{
                backgroundColor: swatch,
                borderColor:
                  tool === "brush" && color === swatch
                    ? "hsl(var(--primary))"
                    : "transparent",
              }}
            />
          ))}
        </div>

        <div className="mx-1 h-5 w-px bg-[hsl(var(--border))]" />

        <button
          type="button"
          onClick={() => setTool("brush")}
          aria-label="Brush tool"
          className={` px-2 py-1 text-xs ${tool === "brush" ? "bg-[hsl(var(--primary))] text-white" : "text-[hsl(var(--foreground))] hover:bg-[hsl(var(--card))]"}`}
        >
          <Pencil className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={() => setTool("eraser")}
          aria-label="Eraser tool"
          className={` px-2 py-1 text-xs ${tool === "eraser" ? "bg-[hsl(var(--primary))] text-white" : "text-[hsl(var(--foreground))] hover:bg-[hsl(var(--card))]"}`}
        >
          <Eraser className="h-4 w-4" />
        </button>

        <button
          type="button"
          onClick={undo}
          aria-label="Undo"
          className="px-2 py-1 text-xs text-[hsl(var(--foreground))] hover:bg-[hsl(var(--card))]"
        >
          <Undo2 className="h-4 w-4" />
        </button>

        <button
          type="button"
          onClick={clearBoard}
          aria-label="Clear whiteboard"
          className="ml-auto  px-2 py-1 text-xs text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--card))]"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </div>

      <div ref={containerRef} className="relative min-h-0 flex-1 bg-white">
        <canvas
          ref={canvasRef}
          className="absolute inset-0 h-full w-full cursor-crosshair"
          style={{ touchAction: "none" }}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={stopDrawing}
          onPointerCancel={stopDrawing}
          onPointerLeave={stopDrawing}
        />
      </div>
    </div>
  );
}

"use client";

import { useRef, useState } from "react";

export default function Home() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [color, setColor] = useState("black");
  const [tool, setTool] = useState<"brush" | "eraser">("brush");

  const colors = ["black", "red", "blue"];

  // Get coordinates for mouse or touch
  const getCoords = (
    e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>
  ) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };

    const rect = canvas.getBoundingClientRect();
    if ("touches" in e) {
      return {
        x: e.touches[0].clientX - rect.left,
        y: e.touches[0].clientY - rect.top,
      };
    } else {
      return {
        x: e.nativeEvent.offsetX,
        y: e.nativeEvent.offsetY,
      };
    }
  };

  const startDrawing = (
    e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>
  ) => {
    e.preventDefault();
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;

    const { x, y } = getCoords(e);
    ctx.beginPath();
    ctx.moveTo(x, y);
    setIsDrawing(true);
  };

  const draw = (
    e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>
  ) => {
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

  const stopDrawing = (
    e?: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>
  ) => {
    e?.preventDefault();
    setIsDrawing(false);
  };

  const clearBoard = () => {
    const ctx = canvasRef.current?.getContext("2d");
    const canvas = canvasRef.current;
    if (!ctx || !canvas) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  };

  return (
    <div className="flex flex-col items-center min-h-screen bg-zinc-100 p-6">
      <h1 className="text-3xl font-bold mb-6">Whiteboard</h1>

      {/* TOOLBAR */}
      <div className="flex items-center gap-4 mb-6 bg-white px-6 py-3 rounded-full shadow">

        {/* Color Circles */}
        {colors.map((c) => (
          <button
            key={c}
            onClick={() => {
              setColor(c);
              setTool("brush");
            }}
            className={`w-8 h-8 rounded-full border-2 transition 
              ${color === c && tool === "brush"
                ? "border-black scale-110"
                : "border-transparent"}
            `}
            style={{ backgroundColor: c }}
          />
        ))}

        {/* Eraser */}
        <button
          onClick={() => setTool("eraser")}
          className={`w-8 h-8 flex items-center justify-center transition ${
            tool === "eraser" ? "scale-110" : ""
          }`}
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="currentColor"
            className="w-6 h-6 text-gray-700"
          >
            <path d="M16.24 3.56a3 3 0 0 0-4.24 0l-8.44 8.44a3 3 0 0 0 0 4.24l3 3a3 3 0 0 0 4.24 0l8.44-8.44a3 3 0 0 0 0-4.24l-3-3zM5.76 13.76L12 7.52l4.24 4.24-6.24 6.24H8.76l-3-3z" />
          </svg>
        </button>

        {/* Clear */}
        <button
          onClick={clearBoard}
          className="ml-2 text-sm text-gray-600 hover:text-black"
        >
          Clear
        </button>
      </div>

      {/* CANVAS */}
      <canvas
        ref={canvasRef}
        width={900}
        height={550}
        className="bg-white shadow-lg rounded-lg border touch-none"
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
  );
}
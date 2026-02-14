"use client";

import { useRef, useState } from "react";

export default function Home() {
  const canvasRef = useRef(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [color, setColor] = useState("black");
  const [tool, setTool] = useState("brush"); // brush or eraser

  const startDrawing = (e) => {
    const ctx = canvasRef.current.getContext("2d");
    ctx.beginPath();
    ctx.moveTo(e.nativeEvent.offsetX, e.nativeEvent.offsetY);
    setIsDrawing(true);
  };

  const draw = (e) => {
    if (!isDrawing) return;

    const ctx = canvasRef.current.getContext("2d");

    if (tool === "eraser") {
      ctx.strokeStyle = "white";
      ctx.lineWidth = 20;
    } else {
      ctx.strokeStyle = color;
      ctx.lineWidth = 4;
    }

    ctx.lineCap = "round";
    ctx.lineTo(e.nativeEvent.offsetX, e.nativeEvent.offsetY);
    ctx.stroke();
  };

  const stopDrawing = () => {
    setIsDrawing(false);
  };

  const clearBoard = () => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  };

  const colors = ["black", "red", "blue"];

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
          className={`w-8 h-8 flex items-center justify-center transition ${tool === "eraser" ? "scale-110" : ""
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
        className="bg-white shadow-lg rounded-lg border"
        onMouseDown={startDrawing}
        onMouseMove={draw}
        onMouseUp={stopDrawing}
        onMouseLeave={stopDrawing}
      />
    </div>
  );
}
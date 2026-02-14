"use client";

import { useRef, useState, useEffect } from "react";

export default function Home() {
  const canvasRef = useRef(null);
  const [isDrawing, setIsDrawing] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");

    ctx.lineWidth = 3;
    ctx.lineCap = "round";
    ctx.strokeStyle = "black";
  }, []);

  const startDrawing = (e) => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");

    ctx.beginPath();
    ctx.moveTo(e.nativeEvent.offsetX, e.nativeEvent.offsetY);
    setIsDrawing(true);
  };

  const draw = (e) => {
    if (!isDrawing) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");

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

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-zinc-100 p-6">
      <h1 className="text-3xl font-bold mb-6">Whiteboard</h1>

      <canvas
        ref={canvasRef}
        width={800}
        height={500}
        className="bg-white shadow-lg rounded-lg border"
        onMouseDown={startDrawing}
        onMouseMove={draw}
        onMouseUp={stopDrawing}
        onMouseLeave={stopDrawing}
      />

      <button
        onClick={clearBoard}
        className="mt-4 px-6 py-2 bg-black text-white rounded-lg"
      >
        Clear
      </button>
    </div>
  );
}

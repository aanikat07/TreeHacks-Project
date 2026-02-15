"use client";

import { useEffect, useRef } from "react";

interface SpirographCanvasProps {
  className?: string;
  animate?: boolean;
  size?: number;
}

export default function SpirographCanvas({
  className = "",
  animate = true,
  size = 600,
}: SpirographCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationRef = useRef<number>(0);
  const startTimeRef = useRef<number>(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.floor(size * dpr);
    canvas.height = Math.floor(size * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    startTimeRef.current = performance.now();

    const w = size;
    const h = size;
    const cx = w / 2;
    const cy = h / 2;

    const heart = (t: number, scale: number) => {
      const sinT = Math.sin(t);
      const x = 16 * sinT * sinT * sinT * scale;
      const y =
        -(
          13 * Math.cos(t) -
          5 * Math.cos(2 * t) -
          2 * Math.cos(3 * t) -
          Math.cos(4 * t)
        ) * scale;
      return { x, y };
    };

    const ringCount = 14;
    const dotsPerRing = 180;

    const draw = (timestamp: number) => {
      const elapsed = (timestamp - startTimeRef.current) / 1000;
      ctx.clearRect(0, 0, w, h);

      const baseScale = Math.min(w, h) * 0.022;

      for (let r = 0; r < ringCount; r++) {
        const frac = (r + 1) / ringCount;
        const scale = baseScale * (0.15 + frac * 0.85);
        const rotation = elapsed * (0.3 + r * 0.08) * (r % 2 === 0 ? 1 : -1);
        const alpha = 0.12 + frac * 0.35;
        const light = 42 + frac * 24;

        ctx.beginPath();
        for (let d = 0; d <= dotsPerRing; d++) {
          const t = (d / dotsPerRing) * Math.PI * 2 + rotation;
          const p = heart(t, scale);
          const sx = cx + p.x;
          const sy = cy + p.y;

          if (d === 0) ctx.moveTo(sx, sy);
          else ctx.lineTo(sx, sy);
        }
        ctx.strokeStyle = `hsla(280, 30%, ${light}%, ${alpha})`;
        ctx.lineWidth = 1 + frac * 0.8;
        ctx.stroke();
      }

      if (animate) {
        animationRef.current = requestAnimationFrame(draw);
      }
    };

    animationRef.current = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(animationRef.current);
  }, [animate, size]);

  return (
    <canvas
      ref={canvasRef}
      className={className}
      style={{ width: size, height: size, display: "block", margin: "0 auto" }}
    />
  );
}

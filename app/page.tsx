"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import SpirographCanvas from "@/components/SpirographCanvas";

const symbols = ["∫", "∇", "π", "Σ", "∞", "θ", "λ", "Δ", "x²", "eᶦπ"];

export default function Home() {
  const router = useRouter();
  const [transitioning, setTransitioning] = useState(false);
  const transitionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleBegin = () => {
    if (transitioning) return;
    setTransitioning(true);
    transitionTimerRef.current = setTimeout(() => {
      router.push("/session");
    }, 2000);
  };

  useEffect(() => {
    return () => {
      if (transitionTimerRef.current) {
        clearTimeout(transitionTimerRef.current);
      }
    };
  }, []);

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[hsl(var(--background))] px-6">
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute left-[-120px] top-[-160px] h-[420px] w-[420px] rounded-full bg-[hsl(var(--primary))]/15 blur-3xl" />
        <div className="absolute bottom-[-200px] right-[-120px] h-[500px] w-[500px] rounded-full bg-[hsl(var(--primary-strong))]/12 blur-3xl" />
      </div>

      <div className="pointer-events-none absolute inset-0">
        {symbols.map((symbol, index) => (
          <span
            key={symbol}
            className="absolute font-mono text-[hsl(var(--muted-foreground))]/18"
            style={{
              left: `${8 + ((index * 11) % 80)}%`,
              top: `${12 + ((index * 19) % 70)}%`,
              fontSize: `${20 + (index % 4) * 8}px`,
              animation: `float ${5 + (index % 3)}s ease-in-out infinite`,
              animationDelay: `${index * 0.25}s`,
            }}
          >
            {symbol}
          </span>
        ))}
      </div>

      <section className="relative z-10 mx-auto w-full max-w-3xl px-7 py-12 text-center sm:px-12">
        <span className="inline-flex rounded-full border border-[hsl(var(--border))] bg-[hsl(var(--card))]/75 px-4 py-1.5 font-mono text-xs uppercase tracking-[0.18em] text-[hsl(var(--muted-foreground))]">
          Virtual Office Hours
        </span>

        <h1 className="mt-7 text-6xl font-semibold tracking-tight text-[hsl(var(--foreground))] sm:text-8xl">
          LoveLace
        </h1>

        <p className="mx-auto mt-5 max-w-2xl text-lg text-[hsl(var(--muted-foreground))]">
          Ask questions, reason visually, and generate math animations with
          grounded support from your working context.
        </p>

        <p className="mx-auto mt-2 max-w-xl text-sm text-[hsl(var(--muted-foreground))]/80">
          Start in the animation workspace and open the graph assistant whenever
          you need to explore a function in 2D or 3D.
        </p>

        <div className="mt-10 flex items-center justify-center">
          <button
            type="button"
            onClick={handleBegin}
            disabled={transitioning}
            className="animate-pulse-glow rounded-xl bg-[hsl(var(--primary))] px-8 py-3 text-base font-semibold text-white transition hover:bg-[hsl(var(--primary-strong))]"
          >
            Begin
          </button>
        </div>
      </section>

      {transitioning && (
        <div className="transition-overlay fixed inset-0 z-50 flex items-center justify-center bg-[hsl(var(--background))]">
          <div className="spiro-shell flex flex-col items-center justify-center text-center">
            <div className="spiro-bounce">
              <SpirographCanvas animate size={500} />
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

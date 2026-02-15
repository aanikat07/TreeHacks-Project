"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import SpirographCanvas from "@/components/SpirographCanvas";

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024)
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

export default function SessionPage() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [transitioning, setTransitioning] = useState(false);
  const transitionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const addFiles = (incoming: FileList | null) => {
    if (!incoming) return;
    const next = Array.from(incoming);
    setFiles((prev) => {
      const seen = new Set(prev.map((file) => `${file.name}:${file.size}`));
      const merged = [...prev];
      for (const file of next) {
        const key = `${file.name}:${file.size}`;
        if (seen.has(key)) continue;
        seen.add(key);
        merged.push(file);
      }
      return merged;
    });
  };

  const handleStartSession = async () => {
    if (transitioning || isUploading) return;

    setUploadError(null);
    const lessonId = `lesson-${Date.now()}`;

    if (files.length > 0) {
      setIsUploading(true);
      try {
        const formData = new FormData();
        formData.set("lessonId", lessonId);
        for (const file of files) {
          formData.append("files", file);
        }

        const response = await fetch("/api/upload", {
          method: "POST",
          body: formData,
        });

        if (!response.ok) {
          const payload = (await response.json().catch(() => null)) as {
            error?: string;
          } | null;
          throw new Error(payload?.error || "File ingestion failed.");
        }

        const payload = (await response.json()) as { lessonId?: string };
        const resolvedLessonId = payload.lessonId || lessonId;
        window.localStorage.setItem("lovelace:lessonId", resolvedLessonId);
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "File upload failed.";
        setUploadError(message);
        setIsUploading(false);
        return;
      } finally {
        setIsUploading(false);
      }
    } else {
      window.localStorage.setItem("lovelace:lessonId", lessonId);
    }

    setTransitioning(true);
    transitionTimerRef.current = setTimeout(() => {
      router.push("/workspace");
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
    <main className="relative flex min-h-screen flex-col bg-[hsl(var(--background))]">
      <header className="flex items-center justify-between border-b border-[hsl(var(--border))] bg-[hsl(var(--card))] px-4 py-2">
        <p className="font-display text-lg font-medium tracking-tight text-[hsl(var(--primary))]">
          LoveLace
        </p>
        <Link
          href="/"
          className="rounded-bl-[8px] rounded-br-[4px] rounded-tl-[4px] rounded-tr-[8px] border-2 border-[hsl(var(--primary-strong))] bg-[hsl(var(--card))] px-3 py-1.5 font-display text-xs font-medium tracking-wide text-[hsl(var(--primary))] hover:bg-[hsl(var(--card-strong))]"
        >
          Back
        </Link>
      </header>

      <section className="flex flex-1 items-center justify-center px-6 py-12">
        <div className="mx-auto w-full max-w-xl">
          <div className="text-center">
            <h1 className="text-3xl font-semibold tracking-tight text-[hsl(var(--foreground))] sm:text-4xl">
              Customize Your Teaching Assistant
            </h1>
            <p className="mt-3 text-[hsl(var(--muted-foreground))]">
              Add lecture videos, audio, textbooks, or notes for better
              responses in your workspace.
            </p>
          </div>

          <button
            type="button"
            aria-label="Drop files here or click to pick files"
            onDragEnter={(event) => {
              event.preventDefault();
              setIsDragging(true);
            }}
            onDragOver={(event) => {
              event.preventDefault();
              setIsDragging(true);
            }}
            onDragLeave={(event) => {
              event.preventDefault();
              setIsDragging(false);
            }}
            onDrop={(event) => {
              event.preventDefault();
              setIsDragging(false);
              addFiles(event.dataTransfer.files);
            }}
            onClick={() => inputRef.current?.click()}
            className={`group relative mx-auto mt-10 flex h-72 w-72 cursor-pointer items-center justify-center rounded-full transition-all duration-300 ${
              isDragging
                ? "scale-105 bg-[hsl(var(--primary))]/20 shadow-[0_10px_40px_hsl(var(--primary)_/_0.28),inset_0_-4px_12px_hsl(var(--primary)_/_0.14)]"
                : "bg-[hsl(var(--primary))]/10 shadow-[0_4px_24px_hsl(var(--primary)_/_0.12),inset_0_-2px_8px_hsl(var(--primary)_/_0.08)] hover:scale-105 hover:bg-[hsl(var(--primary))]/15"
            }`}
          >
            <span className="absolute inset-0 overflow-hidden rounded-full">
              <span className="absolute left-6 right-6 top-3 h-[38%] rounded-full bg-gradient-to-b from-white/20 to-transparent" />
            </span>
            <span className="relative flex flex-col items-center">
              <span
                className={`font-semibold leading-none transition-colors ${
                  isDragging
                    ? "text-[hsl(var(--primary))] text-[9rem]"
                    : "text-[hsl(var(--primary))]/45 text-[9rem] group-hover:text-[hsl(var(--primary))]/70"
                }`}
              >
                Σ
              </span>
              <p className="mt-1 text-sm text-[hsl(var(--muted-foreground))]">
                Drop files here
              </p>
              <p className="text-xs text-[hsl(var(--muted-foreground))]/75">
                or click to pick files
              </p>
            </span>
          </button>

          <input
            ref={inputRef}
            type="file"
            multiple
            accept="video/*,audio/*,.pdf,.doc,.docx,.txt,.md"
            className="hidden"
            onChange={(event) => {
              addFiles(event.target.files);
              event.target.value = "";
            }}
          />

          {files.length > 0 && (
            <div className="mt-7 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-4">
              <div className="mb-3 flex items-center justify-between">
                <p className="text-sm font-semibold text-[hsl(var(--foreground))]">
                  Files Added ({files.length})
                </p>
                <button
                  type="button"
                  onClick={() => setFiles([])}
                  className="text-xs font-medium text-[hsl(var(--muted-foreground))] underline underline-offset-4"
                >
                  Clear all
                </button>
              </div>
              <ul className="space-y-2">
                {files.map((file) => (
                  <li
                    key={`${file.name}:${file.size}`}
                    className="flex items-center justify-between rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-3 py-2"
                  >
                    <span className="truncate pr-4 text-sm text-[hsl(var(--foreground))]">
                      {file.name}
                    </span>
                    <span className="whitespace-nowrap font-mono text-xs text-[hsl(var(--muted-foreground))]">
                      {formatBytes(file.size)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="mt-8 flex flex-col items-center gap-3">
            <button
              type="button"
              onClick={() => void handleStartSession()}
              disabled={transitioning || isUploading}
              className="animate-pulse-glow w-full rounded-bl-[14px] rounded-br-[6px] rounded-tl-[6px] rounded-tr-[14px] border-2 border-[hsl(var(--primary-strong))] bg-[hsl(var(--primary))] px-6 py-3 text-center font-display text-sm font-medium tracking-wide text-white transition hover:bg-[hsl(var(--primary-strong))] disabled:cursor-not-allowed disabled:opacity-70 sm:w-auto"
            >
              {isUploading ? "Uploading..." : "Start Session"}
            </button>
            {files.length === 0 && (
              <p className="text-xs text-[hsl(var(--muted-foreground))]">
                No files yet? You can still continue.
              </p>
            )}
            {uploadError && (
              <p className="text-xs text-red-500">{uploadError}</p>
            )}
          </div>
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

"use client";

import { useEffect, useRef, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronLeft, Download, RotateCcw, CheckCircle2, XCircle, Loader2 } from "lucide-react";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

type Stage =
  | "briefing" | "backgrounds" | "compositing" | "animating"
  | "scoring"  | "audio"       | "merging"     | "complete" | "failed";

interface SceneProgress {
  scene_number: number;
  status: "pending" | "processing" | "complete" | "failed";
  setting: string;
  video_url?: string;
}

interface ProjectStatus {
  project_id: string;
  status: Stage;
  current_stage: string;
  scene_progress: SceneProgress[];
  final_video_url?: string;
  error?: string;
}

const STAGES: { key: Stage; label: string }[] = [
  { key: "briefing",     label: "Briefing"     },
  { key: "backgrounds",  label: "Backgrounds"  },
  { key: "compositing",  label: "Compositing"  },
  { key: "animating",    label: "Animating"    },
  { key: "scoring",      label: "Scoring"      },
  { key: "audio",        label: "Audio"        },
  { key: "merging",      label: "Merging"      },
  { key: "complete",     label: "Complete"     },
];

const STAGE_INDEX: Record<Stage, number> = Object.fromEntries(
  STAGES.map((s, i) => [s.key, i])
) as Record<Stage, number>;

export default function FilmPage() {
  const params       = useParams<{ projectId: string }>();
  const searchParams = useSearchParams();
  const tone         = searchParams.get("tone") ?? "warm";

  const [status, setStatus]   = useState<ProjectStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const videoRef   = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const poll = async () => {
      try {
        const r = await fetch(`${API}/status/${params.projectId}`);
        if (!r.ok) return;
        const d: ProjectStatus = await r.json();
        setStatus(d);
        setLoading(false);
        if (d.status === "complete" || d.status === "failed") {
          if (pollingRef.current) clearInterval(pollingRef.current);
        }
      } catch {
        setLoading(false);
      }
    };

    poll();
    pollingRef.current = setInterval(poll, 3000);
    return () => { if (pollingRef.current) clearInterval(pollingRef.current); };
  }, [params.projectId]);

  const isDone   = status?.status === "complete";
  const isFailed = status?.status === "failed";
  const stageIdx = status ? (STAGE_INDEX[status.current_stage ?? status.status] ?? 0) : 0;

  const videoSrc = isDone && status?.final_video_url
    ? (status.final_video_url.startsWith("/static")
        ? `${API}${status.final_video_url}`
        : status.final_video_url)
    : null;

  const download = () => {
    if (!videoSrc) return;
    const a = document.createElement("a");
    a.href = videoSrc;
    a.download = "codaline-film.mp4";
    a.click();
  };

  return (
    <div
      className="min-h-screen flex flex-col"
      style={{ background: "var(--dark-bg)" }}
    >
      {/* NAV */}
      <header
        className="sticky top-0 z-50 flex items-center justify-between px-6 py-4 border-b"
        style={{ background: "rgba(28,20,16,0.9)", backdropFilter: "blur(12px)", borderColor: "var(--dark-border)" }}
      >
        <Link href="/studio" className="flex items-center gap-2 text-white/40 hover:text-white/70 transition-colors text-sm">
          <ChevronLeft className="w-5 h-5" /> Studio
        </Link>
        <span className="font-display text-xl text-[#F5EDD6]">Codaline</span>
        <div className="w-24" />
      </header>

      <div className="flex-1 flex flex-col items-center justify-start px-6 py-12 max-w-4xl mx-auto w-full">

        {/* STATUS HEADER */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-center mb-12"
        >
          {isDone ? (
            <>
              <div className="flex items-center justify-center gap-2 text-[#E8A838] mb-4">
                <CheckCircle2 className="w-6 h-6" />
                <span className="text-sm font-semibold uppercase tracking-widest">Your film is ready</span>
              </div>
              <h1 className="font-display text-[clamp(2.5rem,6vw,4.5rem)] text-[#F5EDD6] leading-tight">
                Lights.
                <br />
                <span className="italic text-[#C4622D]">Camera. Clay.</span>
              </h1>
            </>
          ) : isFailed ? (
            <>
              <div className="flex items-center justify-center gap-2 text-red-400 mb-4">
                <XCircle className="w-5 h-5" />
                <span className="text-sm font-semibold">Something went wrong</span>
              </div>
              <p className="text-white/50 text-sm">{status?.error ?? "The pipeline encountered an error."}</p>
            </>
          ) : (
            <>
              <div className="flex items-center justify-center gap-2 text-[#E8A838] mb-4">
                <Loader2 className="w-5 h-5 animate-spin" />
                <span className="text-sm font-semibold uppercase tracking-widest">Directing your film</span>
              </div>
              <h1 className="font-display text-[clamp(2rem,5vw,3.5rem)] text-[#F5EDD6] leading-tight">
                {status?.current_stage
                  ? STAGES.find(s => s.key === status.current_stage)?.label ?? "Working…"
                  : "Warming up…"}
              </h1>
            </>
          )}
        </motion.div>

        {/* STAGE PIPELINE */}
        {!isDone && !isFailed && (
          <div className="w-full mb-12">
            <div className="flex items-center justify-between relative">
              {/* Track */}
              <div className="absolute top-4 left-0 right-0 h-px" style={{ background: "rgba(255,255,255,0.08)" }} />
              <motion.div
                className="absolute top-4 left-0 h-px"
                style={{ background: "var(--terracotta)" }}
                animate={{ width: `${(stageIdx / (STAGES.length - 1)) * 100}%` }}
                transition={{ duration: 0.5 }}
              />
              {STAGES.map((stage, i) => {
                const done    = i < stageIdx;
                const active  = i === stageIdx;
                return (
                  <div key={stage.key} className="flex flex-col items-center gap-2 relative z-10">
                    <div
                      className="w-8 h-8 rounded-full flex items-center justify-center border-2 transition-all"
                      style={{
                        background:   done    ? "var(--terracotta)" : active ? "var(--dark-surface)" : "var(--dark-bg)",
                        borderColor:  done    ? "var(--terracotta)" : active ? "var(--terracotta)"   : "rgba(255,255,255,0.12)",
                      }}
                    >
                      {done ? (
                        <CheckCircle2 className="w-4 h-4 text-white" />
                      ) : active ? (
                        <Loader2 className="w-4 h-4 text-[#C4622D] animate-spin" />
                      ) : (
                        <span className="w-2 h-2 rounded-full" style={{ background: "rgba(255,255,255,0.2)" }} />
                      )}
                    </div>
                    <span
                      className="text-[11px] font-medium"
                      style={{ color: done || active ? "#F5EDD6" : "rgba(255,255,255,0.25)" }}
                    >
                      {stage.label}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* SCENE PROGRESS GRID */}
        {status?.scene_progress && status.scene_progress.length > 0 && !isDone && (
          <div className="w-full mb-10">
            <p className="text-xs text-white/35 uppercase tracking-widest mb-4">Scenes</p>
            <div className="grid grid-cols-3 gap-3">
              {status.scene_progress.map(scene => (
                <motion.div
                  key={scene.scene_number}
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="rounded-2xl border p-4 flex flex-col gap-2"
                  style={{
                    background: "rgba(255,255,255,0.03)",
                    borderColor: scene.status === "complete"   ? "rgba(232,168,56,0.3)"
                               : scene.status === "processing" ? "rgba(196,98,45,0.3)"
                               : scene.status === "failed"     ? "rgba(239,68,68,0.3)"
                               : "rgba(255,255,255,0.08)",
                  }}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-white/50">Scene {scene.scene_number}</span>
                    <span
                      className="text-[10px] font-semibold rounded-full px-2 py-0.5"
                      style={{
                        background: scene.status === "complete"   ? "rgba(232,168,56,0.15)"
                                  : scene.status === "processing" ? "rgba(196,98,45,0.15)"
                                  : scene.status === "failed"     ? "rgba(239,68,68,0.15)"
                                  : "rgba(255,255,255,0.06)",
                        color: scene.status === "complete"   ? "#E8A838"
                             : scene.status === "processing" ? "#C4622D"
                             : scene.status === "failed"     ? "#EF4444"
                             : "rgba(255,255,255,0.3)",
                      }}
                    >
                      {scene.status}
                    </span>
                  </div>
                  <p className="text-xs text-white/50 leading-relaxed line-clamp-2">{scene.setting}</p>
                  {scene.status === "processing" && (
                    <div className="h-0.5 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.08)" }}>
                      <motion.div
                        className="h-full rounded-full"
                        style={{ background: "var(--terracotta)" }}
                        animate={{ width: ["0%", "80%", "0%"] }}
                        transition={{ repeat: Infinity, duration: 2, ease: "easeInOut" }}
                      />
                    </div>
                  )}
                </motion.div>
              ))}
            </div>
          </div>
        )}

        {/* FINAL VIDEO */}
        <AnimatePresence>
          {isDone && videoSrc && (
            <motion.div
              initial={{ opacity: 0, scale: 0.96 }}
              animate={{ opacity: 1, scale: 1 }}
              className="w-full"
            >
              <div className="rounded-3xl overflow-hidden border" style={{ borderColor: "rgba(255,255,255,0.08)", background: "#000" }}>
                <video
                  ref={videoRef}
                  src={videoSrc}
                  controls
                  autoPlay
                  className="w-full max-h-[60vh] object-contain"
                />
              </div>

              <div className="flex items-center justify-center gap-4 mt-6">
                <button
                  onClick={download}
                  className="flex items-center gap-2 px-6 py-3 rounded-full font-semibold text-sm text-white transition-all glow-primary"
                  style={{ background: "var(--terracotta)" }}
                >
                  <Download className="w-4 h-4" /> Download Film
                </button>
                <Link
                  href="/studio"
                  className="flex items-center gap-2 px-6 py-3 rounded-full font-semibold text-sm border transition-all hover:bg-white/5"
                  style={{ color: "#F5EDD6", borderColor: "rgba(255,255,255,0.15)" }}
                >
                  <RotateCcw className="w-4 h-4" /> Make Another
                </Link>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* FAILED STATE */}
        {isFailed && (
          <Link
            href="/studio"
            className="flex items-center gap-2 px-6 py-3 rounded-full font-semibold text-sm transition-all"
            style={{ background: "var(--terracotta)", color: "#fff" }}
          >
            <RotateCcw className="w-4 h-4" /> Try Again
          </Link>
        )}

        {/* Loading skeleton */}
        {loading && !status && (
          <div className="flex flex-col items-center gap-4 text-white/30">
            <Loader2 className="w-8 h-8 animate-spin" />
            <p className="text-sm">Connecting to the studio…</p>
          </div>
        )}
      </div>
    </div>
  );
}

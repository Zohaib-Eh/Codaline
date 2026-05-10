"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "sonner";
import {
  Upload, X, ChevronLeft, Sparkles, User, Box,
  Wand2, ArrowRight, Plus, Loader2, Camera, FlipHorizontal,
} from "lucide-react";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

type SubjectType = "person" | "character" | "prop";
type Tone        = "warm" | "dark" | "whimsical" | "dramatic";

interface CastMember {
  id: string;
  tag: string;
  thumbnail_b64: string;
  subject_type: SubjectType;
  is_clayified: boolean;
  is_demo: boolean;
}

interface PendingSegment {
  x1: number; y1: number; x2: number; y2: number;
  maskB64: string;
  thumbnailB64: string;
  objectId: string;
}

const TONES: { value: Tone; label: string; desc: string; color: string }[] = [
  { value: "warm",      label: "Warm",      desc: "Golden & cosy",    color: "#E8A838" },
  { value: "dark",      label: "Dark",      desc: "Moody & ominous",  color: "#6B7280" },
  { value: "whimsical", label: "Whimsical", desc: "Playful & bright", color: "#8B5CF6" },
  { value: "dramatic",  label: "Dramatic",  desc: "Epic & cinematic", color: "#EF4444" },
];

export default function StudioPage() {
  const router = useRouter();

  // Image
  const [imageId, setImageId]       = useState<string | null>(null);
  const [imageUrl, setImageUrl]     = useState<string | null>(null);
  const [isDropping, setIsDropping] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Drag-to-box tracking (canvas-% for CSS rect, px for backend)
  const [dragStart, setDragStart]     = useState<{ x: number; y: number } | null>(null);
  const [dragCurrent, setDragCurrent] = useState<{ x: number; y: number } | null>(null);
  const dragStartPx   = useRef<{ x: number; y: number } | null>(null);
  const isDraggingBox = useRef(false);

  // Segmentation state
  const [isSegmenting, setIsSegmenting] = useState(false);
  const [pending, setPending]           = useState<PendingSegment | null>(null);
  const [pendingTag, setPendingTag]           = useState("");
  const [pendingDescription, setPendingDescription] = useState("");
  const [pendingType, setPendingType]         = useState<SubjectType>("character");

  // Cast
  const [cast, setCast]             = useState<CastMember[]>([]);
  const [clayifying, setClayifying] = useState<Set<string>>(new Set());

  // Story
  const [story, setStory]           = useState("");
  const [tone, setTone]             = useState<Tone | null>(null);
  const [mentionSearch, setMentionSearch] = useState<string | null>(null);
  const [mentionStart, setMentionStart]   = useState(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [isGenerating, setIsGenerating] = useState(false);

  const canvasRef = useRef<HTMLDivElement>(null);
  const imgRef    = useRef<HTMLImageElement>(null);
  const [naturalSize, setNaturalSize] = useState<{ w: number; h: number } | null>(null);

  // Camera state (refs defined here, callbacks defined after uploadFile)
  const [inputMode, setInputMode]     = useState<"upload" | "camera">("upload");
  const [cameraReady, setCameraReady] = useState(false);
  const videoRef   = useRef<HTMLVideoElement>(null);
  const streamRef  = useRef<MediaStream | null>(null);

  // ── Load demo cast ───────────────────────────────────────────────────────
  useEffect(() => {
    fetch(`${API}/objects`)
      .then(r => r.json())
      .then(data => setCast(data))
      .catch(() => {
        setCast([
          { id: "demo-bear", tag: "bear", thumbnail_b64: "", subject_type: "object", is_clayified: true,  is_demo: true },
          { id: "demo-cup",  tag: "cup",  thumbnail_b64: "", subject_type: "object", is_clayified: false, is_demo: true },
        ]);
      });
  }, []);

  // ── Upload ───────────────────────────────────────────────────────────────
  const uploadFile = useCallback(async (file: File) => {
    setImageUrl(URL.createObjectURL(file));
    setNaturalSize(null);
    setPending(null);
    setDragStart(null);
    setDragCurrent(null);
    const fd = new FormData();
    fd.append("file", file);
    try {
      const r = await fetch(`${API}/upload`, { method: "POST", body: fd });
      const d = await r.json();
      setImageId(d.image_id);
    } catch {
      setImageId(`local-${Date.now()}`);
    }
  }, []);

  // ── Camera callbacks (defined after uploadFile) ──────────────────────────
  const startCamera = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.play();
        setCameraReady(true);
      }
    } catch {
      toast.error("Camera access denied");
      setInputMode("upload");
    }
  }, []);

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
    setCameraReady(false);
  }, []);

  const capturePhoto = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    const canvas = document.createElement("canvas");
    canvas.width  = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext("2d")!.drawImage(video, 0, 0);
    canvas.toBlob(blob => {
      if (!blob) return;
      const file = new File([blob], "capture.jpg", { type: "image/jpeg" });
      stopCamera();
      setInputMode("upload");
      uploadFile(file);
    }, "image/jpeg", 0.92);
  }, [stopCamera, uploadFile]);

  useEffect(() => {
    if (inputMode === "camera") startCamera();
    else stopCamera();
  }, [inputMode, startCamera, stopCamera]);

  useEffect(() => () => stopCamera(), [stopCamera]);

  // ── Canvas-% coords (for CSS rect only) ─────────────────────────────────
  const toCanvasPct = useCallback((clientX: number, clientY: number) => {
    const el = canvasRef.current;
    if (!el) return { x: 0, y: 0 };
    const rect = el.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(100, ((clientX - rect.left)  / rect.width)  * 100)),
      y: Math.max(0, Math.min(100, ((clientY - rect.top)   / rect.height) * 100)),
    };
  }, []);

  // ── Mouse → original-image pixel coords ─────────────────────────────────
  const toImagePixels = useCallback((clientX: number, clientY: number) => {
    const el = canvasRef.current;
    if (!el || !naturalSize) return { x: 0, y: 0 };
    const rect     = el.getBoundingClientRect();
    const { w: nW, h: nH } = naturalSize;
    const scale    = Math.min(rect.width / nW, rect.height / nH);
    const rW       = nW * scale;
    const rH       = nH * scale;
    const oX       = (rect.width  - rW) / 2;
    const oY       = (rect.height - rH) / 2;
    return {
      x: Math.max(0, Math.min(nW, ((clientX - rect.left - oX) / rW) * nW)),
      y: Math.max(0, Math.min(nH, ((clientY - rect.top  - oY) / rH) * nH)),
    };
  }, [naturalSize]);

  // ── Box segmentation ─────────────────────────────────────────────────────
  const runSegment = useCallback(async (x1: number, y1: number, x2: number, y2: number) => {
    if (!imageId) return;
    setIsSegmenting(true);
    try {
      const r = await fetch(`${API}/segment/box`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image_id: imageId, x1, y1, x2, y2, tag: "_pending_", subject_type: pendingType }),
      });
      const d = await r.json();
      setPending({ x1, y1, x2, y2, maskB64: d.masked_png_b64, thumbnailB64: d.thumbnail_b64, objectId: d.object_id });
      setTimeout(() => document.getElementById("pending-tag")?.focus(), 50);
    } catch {
      setPending({ x1, y1, x2, y2, maskB64: "", thumbnailB64: "", objectId: `local-${Date.now()}` });
      setTimeout(() => document.getElementById("pending-tag")?.focus(), 50);
    } finally {
      setIsSegmenting(false);
    }
  }, [imageId, pendingType]);

  // ── Canvas mouse handlers ────────────────────────────────────────────────
  const onMouseDown = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (!imageUrl || pending) return;
    setDragStart(toCanvasPct(e.clientX, e.clientY));
    setDragCurrent(toCanvasPct(e.clientX, e.clientY));
    dragStartPx.current = toImagePixels(e.clientX, e.clientY);
    isDraggingBox.current = false;
  }, [imageUrl, pending, toCanvasPct, toImagePixels]);

  const onMouseMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (!dragStart) return;
    const pct = toCanvasPct(e.clientX, e.clientY);
    setDragCurrent(pct);
    const dx = Math.abs(pct.x - dragStart.x);
    const dy = Math.abs(pct.y - dragStart.y);
    if (dx > 1.5 || dy > 1.5) isDraggingBox.current = true;
  }, [dragStart, toCanvasPct]);

  const onMouseUp = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (!dragStart || !imageUrl) return;
    const endPx = toImagePixels(e.clientX, e.clientY);
    setDragStart(null);
    setDragCurrent(null);

    if (isDraggingBox.current && dragStartPx.current) {
      const x1 = Math.min(dragStartPx.current.x, endPx.x);
      const y1 = Math.min(dragStartPx.current.y, endPx.y);
      const x2 = Math.max(dragStartPx.current.x, endPx.x);
      const y2 = Math.max(dragStartPx.current.y, endPx.y);
      if (x2 - x1 > 4 && y2 - y1 > 4) runSegment(x1, y1, x2, y2);
    }

    isDraggingBox.current = false;
    dragStartPx.current = null;
  }, [dragStart, imageUrl, toImagePixels, runSegment]);

  const selectionRect = dragStart && dragCurrent ? {
    left:   `${Math.min(dragStart.x, dragCurrent.x)}%`,
    top:    `${Math.min(dragStart.y, dragCurrent.y)}%`,
    width:  `${Math.abs(dragCurrent.x - dragStart.x)}%`,
    height: `${Math.abs(dragCurrent.y - dragStart.y)}%`,
  } : null;

  // ── Clayify ──────────────────────────────────────────────────────────────
  const clayify = useCallback(async (id: string) => {
    setClayifying(prev => new Set(prev).add(id));
    try {
      const r = await fetch(`${API}/clayify/${id}`, { method: "POST" });
      const d = await r.json();
      setCast(prev => prev.map(m =>
        m.id === id ? { ...m, thumbnail_b64: d.clayified_png_b64, is_clayified: true } : m
      ));
    } catch {
      await new Promise(r => setTimeout(r, 1500));
      setCast(prev => prev.map(m => m.id === id ? { ...m, is_clayified: true } : m));
    }
    setClayifying(prev => { const s = new Set(prev); s.delete(id); return s; });
  }, []);

  // ── Confirm extracted object into cast ───────────────────────────────────
  const confirmCast = useCallback(async () => {
    if (!pending || !pendingTag.trim()) return;
    const tag = pendingTag.trim().toLowerCase().replace(/\s+/g, "-");
    const description = pendingDescription.trim() || undefined;
    // Update tag + subject_type + description on the backend
    try {
      await fetch(`${API}/objects/${pending.objectId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tag, subject_type: pendingType, description }),
      });
    } catch { /* non-fatal — cast still works locally */ }
    const newMember = {
      id: pending.objectId,
      tag,
      thumbnail_b64: pending.thumbnailB64,
      subject_type: pendingType,
      is_clayified: false,
      is_demo: false,
    };
    setCast(prev => [...prev, newMember]);
    toast.success(`@${tag} added to cast`);
    setPending(null);
    setPendingTag("");
    setPendingDescription("");
    // Auto-clayify immediately
    clayify(pending.objectId);
  }, [pending, pendingTag, pendingDescription, pendingType, clayify]);

  // ── Generate ─────────────────────────────────────────────────────────────
  const generate = useCallback(async () => {
    if (!tone || !story.trim() || cast.length === 0) return;
    setIsGenerating(true);
    try {
      const r = await fetch(`${API}/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ story_prompt: story, tone, object_ids: cast.map(m => m.id) }),
      });
      const d = await r.json();
      router.push(`/film/${d.project_id}?tone=${tone}`);
    } catch {
      toast.error("Couldn't reach the server — is the backend running?");
      setIsGenerating(false);
    }
  }, [tone, story, cast, router]);

  const canGenerate = cast.length > 0 && story.trim().length > 0 && tone !== null;

  // ── @ mention dropdown ───────────────────────────────────────────────────
  const handleStoryChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setStory(val);
    const cursor = e.target.selectionStart ?? val.length;
    const textBefore = val.slice(0, cursor);
    const atMatch = textBefore.match(/@(\w*)$/);
    if (atMatch) {
      setMentionSearch(atMatch[1].toLowerCase());
      setMentionStart(cursor - atMatch[0].length);
    } else {
      setMentionSearch(null);
    }
  }, []);

  const insertMention = useCallback((tag: string) => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    const cursor = textarea.selectionStart ?? story.length;
    const before = story.slice(0, mentionStart);
    const after = story.slice(cursor);
    const newStory = before + `@${tag} ` + after;
    setStory(newStory);
    setMentionSearch(null);
    setTimeout(() => {
      textarea.focus();
      const pos = mentionStart + tag.length + 2;
      textarea.setSelectionRange(pos, pos);
    }, 0);
  }, [story, mentionStart]);

  const filteredMentions = mentionSearch !== null
    ? cast.filter(m => m.tag.toLowerCase().startsWith(mentionSearch))
    : [];

  return (
    <div className="h-screen flex flex-col overflow-hidden" style={{ background: "var(--dark-bg)" }}>

      {/* ── TOP BAR ── */}
      <header
        className="flex-shrink-0 flex items-center justify-between px-6 py-4 border-b z-50"
        style={{ background: "rgba(28,20,16,0.95)", borderColor: "var(--dark-border)" }}
      >
        <div className="flex items-center gap-4">
          <Link href="/" className="text-white/40 hover:text-white/70 transition-colors">
            <ChevronLeft className="w-5 h-5" />
          </Link>
          <span className="font-display text-xl text-[#F5EDD6]">Codaline</span>
        </div>

        <div className="flex items-center gap-2 text-xs text-white/30">
          <span className={cast.length > 0 ? "text-[#E8A838]" : ""}>Cast</span>
          <span>→</span>
          <span className={story && tone ? "text-[#E8A838]" : ""}>Story</span>
          <span>→</span>
          <span className={canGenerate ? "text-[#E8A838]" : ""}>Generate</span>
        </div>
      </header>

      {/* ── MAIN SPLIT ── */}
      <div className="flex-1 flex overflow-hidden min-h-0">

        {/* LEFT: CANVAS ─────────────────────────────────────────────────── */}
        <div className="w-[58%] flex flex-col border-r min-h-0" style={{ borderColor: "var(--dark-border)" }}>
          <div className="flex-shrink-0 px-8 pt-6 pb-3">
            <h2 className="font-display text-2xl text-[#F5EDD6] mb-0.5">Build your cast</h2>
            <p className="text-sm text-white/40">
              {!imageUrl
                ? "Upload a photo or use your camera"
                : "Drag a box around any object or person to extract them"}
            </p>
          </div>

          <div className="flex-1 px-8 pb-4 min-h-0 flex flex-col">
            {!imageUrl ? (
              <div className="flex-1 flex flex-col gap-3 min-h-0">
                {/* Mode toggle */}
                <div className="flex rounded-xl overflow-hidden border self-start" style={{ borderColor: "rgba(255,255,255,0.12)" }}>
                  {([
                    { mode: "upload", icon: <Upload className="w-3.5 h-3.5" />, label: "Upload" },
                    { mode: "camera", icon: <Camera className="w-3.5 h-3.5" />, label: "Camera" },
                  ] as { mode: "upload" | "camera"; icon: React.ReactNode; label: string }[]).map(({ mode, icon, label }) => (
                    <button key={mode} onClick={() => setInputMode(mode)}
                      className="flex items-center gap-1.5 px-4 py-2 text-xs font-semibold transition-all"
                      style={{
                        background: inputMode === mode ? "rgba(196,98,45,0.25)" : "transparent",
                        color:      inputMode === mode ? "#C4622D" : "rgba(255,255,255,0.35)",
                      }}
                    >{icon}{label}</button>
                  ))}
                </div>

                {inputMode === "upload" ? (
                  <div
                    onClick={() => fileInputRef.current?.click()}
                    onDrop={e => { e.preventDefault(); setIsDropping(false); const f = e.dataTransfer.files[0]; if (f?.type.startsWith("image/")) uploadFile(f); }}
                    onDragOver={e => { e.preventDefault(); setIsDropping(true); }}
                    onDragLeave={() => setIsDropping(false)}
                    className="flex-1 min-h-[260px] rounded-2xl border-2 border-dashed flex flex-col items-center justify-center gap-4 cursor-pointer transition-all"
                    style={{
                      borderColor: isDropping ? "var(--terracotta)" : "rgba(255,255,255,0.12)",
                      background:  isDropping ? "rgba(196,98,45,0.07)" : "rgba(255,255,255,0.02)",
                    }}
                  >
                    <Upload className="w-10 h-10 text-white/30" />
                    <div className="text-center">
                      <p className="text-[#F5EDD6]/70 font-medium">Drop a photo here</p>
                      <p className="text-white/30 text-sm mt-1">or click to browse</p>
                    </div>
                    <input ref={fileInputRef} type="file" accept="image/*" className="hidden"
                      onChange={e => e.target.files?.[0] && uploadFile(e.target.files[0])} />
                  </div>
                ) : (
                  <div className="flex-1 relative rounded-2xl overflow-hidden bg-black min-h-[260px] flex flex-col items-center justify-center">
                    <video
                      ref={videoRef}
                      autoPlay
                      playsInline
                      muted
                      className="absolute inset-0 w-full h-full object-cover"
                      style={{ transform: "scaleX(-1)" }}
                    />
                    {!cameraReady && (
                      <div className="flex flex-col items-center gap-2 text-white/40">
                        <Loader2 className="w-6 h-6 animate-spin" />
                        <span className="text-sm">Starting camera…</span>
                      </div>
                    )}
                    {cameraReady && (
                      <button
                        onClick={capturePhoto}
                        className="absolute bottom-5 left-1/2 -translate-x-1/2 w-16 h-16 rounded-full border-4 border-white flex items-center justify-center transition-all hover:scale-105 active:scale-95"
                        style={{ background: "rgba(196,98,45,0.9)" }}
                      >
                        <Camera className="w-7 h-7 text-white" />
                      </button>
                    )}
                  </div>
                )}
              </div>
            ) : (
              <div
                ref={canvasRef}
                onMouseDown={onMouseDown}
                onMouseMove={onMouseMove}
                onMouseUp={onMouseUp}
                onMouseLeave={() => { if (dragStart) { setDragStart(null); setDragCurrent(null); } }}
                className="flex-1 relative rounded-2xl overflow-hidden bg-black/50 select-none"
                style={{ cursor: isSegmenting ? "wait" : "crosshair" }}
              >
                {/* Base image */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  ref={imgRef}
                  src={imageUrl}
                  alt=""
                  onLoad={e => setNaturalSize({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
                  className="absolute inset-0 w-full h-full object-contain"
                  draggable={false}
                />

                {/* Segmentation mask overlay */}
                <AnimatePresence>
                  {pending?.maskB64 && (
                    <motion.img
                      key="mask"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      src={`data:image/png;base64,${pending.maskB64}`}
                      alt="mask"
                      className="absolute inset-0 w-full h-full object-contain pointer-events-none"
                      style={{ filter: "drop-shadow(0 0 8px rgba(196,98,45,0.8))" }}
                      draggable={false}
                    />
                  )}
                </AnimatePresence>

                {/* Drag selection rectangle */}
                <AnimatePresence>
                  {selectionRect && isDraggingBox.current && (
                    <motion.div
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      className="absolute pointer-events-none rounded border-2"
                      style={{
                        ...selectionRect,
                        borderColor: "var(--terracotta)",
                        background: "rgba(196,98,45,0.12)",
                      }}
                    />
                  )}
                </AnimatePresence>

                {/* Segmenting spinner */}
                <AnimatePresence>
                  {isSegmenting && (
                    <motion.div
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      className="absolute inset-0 flex items-center justify-center"
                      style={{ background: "rgba(0,0,0,0.4)" }}
                    >
                      <div className="flex flex-col items-center gap-3">
                        <Loader2 className="w-8 h-8 text-[#C4622D] animate-spin" />
                        <span className="text-sm text-white/70 font-medium">Extracting object…</span>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>

                {/* Reset image button */}
                <button
                  className="absolute top-3 right-3 w-8 h-8 rounded-full bg-black/70 flex items-center justify-center text-white/50 hover:text-white transition-colors z-10"
                  onClick={() => { setImageUrl(null); setImageId(null); setPending(null); }}
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            )}
          </div>

          {/* ── Name & confirm panel ── */}
          <AnimatePresence>
            {pending && !isSegmenting && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.2 }}
                className="flex-shrink-0 overflow-hidden border-t"
                style={{ borderColor: "var(--dark-border)", background: "rgba(196,98,45,0.07)" }}
              >
                <div className="px-8 py-5">
                  <p className="text-xs text-[#C4622D]/80 uppercase tracking-widest font-semibold mb-3">
                    ✓ Object extracted — name this character
                  </p>
                  <div className="flex items-center gap-3">
                    {/* Extracted object preview */}
                    {pending.thumbnailB64 && (
                      <div
                        className="w-14 h-14 rounded-xl flex-shrink-0 overflow-hidden flex items-center justify-center border"
                        style={{
                          background: "repeating-conic-gradient(rgba(255,255,255,0.06) 0% 25%, transparent 0% 50%) 0 0 / 10px 10px",
                          borderColor: "rgba(196,98,45,0.4)",
                        }}
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={`data:image/png;base64,${pending.thumbnailB64}`} alt="extracted" className="w-full h-full object-contain" />
                      </div>
                    )}
                    {/* Tag input */}
                    <div
                      className="flex items-center flex-1 rounded-xl border overflow-hidden"
                      style={{ borderColor: "rgba(196,98,45,0.4)", background: "rgba(255,255,255,0.04)" }}
                    >
                      <span className="px-3 text-[#C4622D] font-bold text-sm">@</span>
                      <input
                        id="pending-tag"
                        type="text"
                        value={pendingTag}
                        onChange={e => setPendingTag(e.target.value)}
                        onKeyDown={e => e.key === "Enter" && confirmCast()}
                        placeholder="bear, cup, me…"
                        className="flex-1 bg-transparent text-[#F5EDD6] text-sm py-2.5 pr-3 outline-none placeholder:text-white/25"
                      />
                    </div>
                    {/* Description input */}
                    <input
                      type="text"
                      value={pendingDescription}
                      onChange={e => setPendingDescription(e.target.value)}
                      onKeyDown={e => e.key === "Enter" && confirmCast()}
                      placeholder="describe it: alarm clock with two bells (helps clayification)"
                      className="flex-1 rounded-xl border px-3 py-2.5 text-sm bg-transparent text-[#F5EDD6] outline-none placeholder:text-white/20"
                      style={{ borderColor: "rgba(255,255,255,0.12)" }}
                    />
                    {/* Type toggle */}
                    <div className="flex rounded-xl overflow-hidden border" style={{ borderColor: "rgba(255,255,255,0.12)" }}>
                      {([
                        { value: "character", label: "Character", icon: <Box className="w-3.5 h-3.5" /> },
                        { value: "person",    label: "Person",    icon: <User className="w-3.5 h-3.5" /> },
                        { value: "prop",      label: "Prop",      icon: <Box className="w-3.5 h-3.5" /> },
                      ] as { value: SubjectType; label: string; icon: React.ReactNode }[]).map(t => (
                        <button key={t.value} onClick={() => setPendingType(t.value)}
                          className="flex items-center gap-1.5 px-3 py-2.5 text-xs font-medium transition-all"
                          style={{
                            background: pendingType === t.value ? "rgba(196,98,45,0.25)" : "transparent",
                            color:      pendingType === t.value ? "#C4622D" : "rgba(255,255,255,0.35)",
                          }}
                        >
                          {t.icon}{t.label}
                        </button>
                      ))}
                    </div>
                    {/* Confirm */}
                    <button
                      onClick={confirmCast}
                      disabled={!pendingTag.trim()}
                      className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-bold text-white transition-all disabled:opacity-40"
                      style={{ background: "var(--terracotta)" }}
                    >
                      <Plus className="w-4 h-4" /> Add to cast
                    </button>
                    {/* Discard */}
                    <button
                      onClick={() => { setPending(null); setPendingTag(""); setPendingDescription(""); }}
                      className="w-9 h-9 rounded-xl flex items-center justify-center text-white/40 hover:text-white transition-colors"
                      style={{ background: "rgba(255,255,255,0.05)" }}
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* RIGHT: CAST + STORY ─────────────────────────────────────────── */}
        <div className="w-[42%] flex flex-col overflow-y-auto scrollbar-thin" style={{ background: "var(--dark-surface)" }}>

          {/* Cast */}
          <div className="px-8 pt-7 pb-6 border-b flex-shrink-0" style={{ borderColor: "var(--dark-border)" }}>
            <div className="flex items-center justify-between mb-5">
              <h3 className="font-display text-xl text-[#F5EDD6]">Your cast</h3>
              {cast.some(m => !m.is_clayified) && (
                <button
                  onClick={() => cast.filter(m => !m.is_clayified).forEach(m => clayify(m.id))}
                  className="flex items-center gap-1.5 text-xs font-semibold text-[#E8A838] border border-[#E8A838]/30 rounded-full px-3 py-1.5 hover:bg-[#E8A838]/10 transition-all"
                >
                  <Wand2 className="w-3.5 h-3.5" /> Clayify all
                </button>
              )}
            </div>

            {cast.length === 0 ? (
              <p className="text-sm text-white/25 leading-relaxed">
                {imageUrl
                  ? "Drag a box around an object to extract a cast member."
                  : "Upload a photo first, then extract your cast."}
              </p>
            ) : (
              <div className="flex flex-wrap gap-3">
                <AnimatePresence>
                  {cast.map(m => (
                    <motion.div
                      key={m.id}
                      initial={{ scale: 0.8, opacity: 0 }}
                      animate={{ scale: 1, opacity: 1 }}
                      exit={{ scale: 0.8, opacity: 0 }}
                      className="group relative flex flex-col items-center gap-2 p-3 rounded-2xl border transition-all"
                      style={{
                        background:   "rgba(255,255,255,0.04)",
                        borderColor:  m.is_clayified ? "rgba(232,168,56,0.35)" : "rgba(255,255,255,0.1)",
                        minWidth: 76,
                      }}
                    >
                      <div className="w-14 h-14 rounded-xl overflow-hidden bg-black/30 flex items-center justify-center">
                        {m.thumbnail_b64
                          // eslint-disable-next-line @next/next/no-img-element
                          ? <img src={`data:image/png;base64,${m.thumbnail_b64}`} alt={m.tag} className="w-full h-full object-contain" />
                          : <span className="text-2xl">{m.subject_type === "person" ? "👤" : m.subject_type === "prop" ? "📦" : "🧸"}</span>}
                      </div>
                      <span className="text-xs font-bold text-[#F5EDD6]">@{m.tag}</span>
                      {m.is_clayified ? (
                        <span className="text-[10px] font-semibold text-[#E8A838]">clay ✓</span>
                      ) : (
                        <button onClick={() => clayify(m.id)} disabled={clayifying.has(m.id)}
                          className="flex items-center gap-1 text-[10px] font-semibold text-white/40 hover:text-[#C4622D] transition-colors">
                          {clayifying.has(m.id)
                            ? <><Loader2 className="w-3 h-3 animate-spin" />clayifying</>
                            : <><Wand2 className="w-3 h-3" />clayify</>}
                        </button>
                      )}
                      {m.is_demo && (
                        <span className="absolute -top-1.5 -right-1.5 text-[9px] font-bold rounded-full px-1.5 py-0.5"
                          style={{ background: "#E8A838", color: "#1C1410" }}>demo</span>
                      )}
                      <button
                        onClick={() => {
                          setCast(prev => prev.filter(c => c.id !== m.id));
                          fetch(`${API}/objects/${m.id}`, { method: "DELETE" }).catch(() => {});
                        }}
                        className="absolute -top-1.5 -left-1.5 w-5 h-5 rounded-full bg-black/80 items-center justify-center text-white/50 hover:text-white hidden group-hover:flex"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </motion.div>
                  ))}
                </AnimatePresence>
              </div>
            )}
          </div>

          {/* Story */}
          <div className="px-8 pt-6 pb-5 border-b flex-shrink-0" style={{ borderColor: "var(--dark-border)" }}>
            <h3 className="font-display text-xl text-[#F5EDD6] mb-0.5">Write your story</h3>
            <p className="text-xs text-white/35 mb-3">Use @tags to place your cast — e.g. @bear finds @cup</p>
            <div className="relative">
              <textarea
                ref={textareaRef}
                value={story}
                onChange={handleStoryChange}
                onKeyDown={e => {
                  if (filteredMentions.length === 0) return;
                  if (e.key === "Escape") { setMentionSearch(null); }
                  if (e.key === "Enter" && filteredMentions.length > 0) {
                    e.preventDefault();
                    insertMention(filteredMentions[0].tag);
                  }
                }}
                placeholder="@bear tries to find @cup before the sun sets…"
                rows={4}
                className="w-full rounded-xl px-4 py-3 text-sm text-[#F5EDD6] resize-none outline-none transition-all scrollbar-thin"
                style={{
                  background: "rgba(255,255,255,0.04)",
                  border: "1px solid rgba(255,255,255,0.08)",
                  caretColor: "#C4622D",
                }}
                onFocus={e => (e.currentTarget.style.borderColor = "rgba(196,98,45,0.5)")}
                onBlur={e => {
                  e.currentTarget.style.borderColor = "rgba(255,255,255,0.08)";
                  setTimeout(() => setMentionSearch(null), 150);
                }}
              />
              {filteredMentions.length > 0 && (
                <div
                  className="absolute left-0 right-0 z-50 rounded-xl border overflow-hidden shadow-xl"
                  style={{ top: "100%", marginTop: 4, background: "#1E1A14", borderColor: "rgba(196,98,45,0.4)" }}
                >
                  {filteredMentions.map(m => (
                    <button
                      key={m.id}
                      onMouseDown={e => { e.preventDefault(); insertMention(m.tag); }}
                      className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-left hover:bg-white/5 transition-colors"
                    >
                      {m.thumbnail_b64 && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={`data:image/png;base64,${m.thumbnail_b64}`} alt={m.tag} className="w-6 h-6 rounded object-contain" />
                      )}
                      <span className="text-[#C4622D] font-medium">@{m.tag}</span>
                      <span className="text-white/30 text-xs">{m.subject_type}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            {cast.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {cast.map(m => (
                  <button key={m.id}
                    onClick={() => setStory(s => s + (s && !s.endsWith(" ") ? " " : "") + `@${m.tag} `)}
                    className="text-xs px-2.5 py-1 rounded-full transition-all"
                    style={{ background: "rgba(196,98,45,0.15)", color: "#C4622D" }}
                  >@{m.tag}</button>
                ))}
              </div>
            )}
          </div>

          {/* Tone + Generate */}
          <div className="px-8 py-6 flex-shrink-0">
            <p className="text-xs text-white/35 uppercase tracking-widest mb-3">Pick a tone</p>
            <div className="grid grid-cols-2 gap-2 mb-5">
              {TONES.map(t => (
                <button key={t.value} onClick={() => setTone(t.value)}
                  className="flex items-start gap-3 p-3 rounded-xl border text-left transition-all"
                  style={{
                    background:  tone === t.value ? `${t.color}18` : "rgba(255,255,255,0.03)",
                    borderColor: tone === t.value ? `${t.color}55` : "rgba(255,255,255,0.07)",
                  }}
                >
                  <span className="w-2 h-2 rounded-full mt-[5px] flex-shrink-0"
                    style={{ background: t.color, boxShadow: tone === t.value ? `0 0 8px ${t.color}` : "none" }} />
                  <div>
                    <p className="text-sm font-semibold" style={{ color: tone === t.value ? t.color : "#F5EDD6" }}>{t.label}</p>
                    <p className="text-xs text-white/30 mt-0.5">{t.desc}</p>
                  </div>
                </button>
              ))}
            </div>

            <button
              onClick={generate}
              disabled={!canGenerate || isGenerating}
              className="w-full flex items-center justify-center gap-3 py-4 rounded-2xl font-bold text-base text-white transition-all disabled:opacity-40 disabled:cursor-not-allowed glow-primary"
              style={{ background: canGenerate ? "var(--terracotta)" : "rgba(196,98,45,0.25)" }}
            >
              {isGenerating
                ? <><Loader2 className="w-5 h-5 animate-spin" /> Submitting…</>
                : <><Sparkles className="w-5 h-5" /> Make Film <ArrowRight className="w-5 h-5" /></>}
            </button>

            {!canGenerate && (
              <p className="text-center text-xs text-white/20 mt-3">
                {cast.length === 0 ? "Extract at least one cast member" : !story.trim() ? "Write a story prompt" : "Pick a tone to continue"}
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

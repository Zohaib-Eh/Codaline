"use client";

import { useCallback, useRef, useState } from "react";
import { Camera, Upload, X, Sparkles, User, Package } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { CastMember } from "@/app/page";

interface CastBuilderProps {
  uploadedImageUrl: string | null;
  castMembers: CastMember[];
  onUpload: (file: File) => void;
  onSegmentClick: (
    x: number,
    y: number,
    tag: string,
    subjectType: "person" | "object"
  ) => void;
  onClayify: (id: string) => void;
  onClayifyAll: () => void;
  onRemove: (id: string) => void;
}

export function CastBuilder({
  uploadedImageUrl,
  castMembers,
  onUpload,
  onSegmentClick,
  onClayify,
  onClayifyAll,
  onRemove,
}: CastBuilderProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const [selectedPoint, setSelectedPoint] = useState<{ x: number; y: number } | null>(null);
  const [tagInput, setTagInput] = useState("");
  const [subjectType, setSubjectType] = useState<"person" | "object">("object");
  const [isDragging, setIsDragging] = useState(false);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      const file = e.dataTransfer.files[0];
      if (file && file.type.startsWith("image/")) {
        onUpload(file);
      }
    },
    [onUpload]
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback(() => {
    setIsDragging(false);
  }, []);

  const handleFileSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) {
        onUpload(file);
      }
    },
    [onUpload]
  );

  const handleCanvasClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (!canvasRef.current) return;
      const rect = canvasRef.current.getBoundingClientRect();
      const x = (e.clientX - rect.left) / rect.width;
      const y = (e.clientY - rect.top) / rect.height;
      setSelectedPoint({ x, y });
    },
    []
  );

  const handleAddToCast = useCallback(() => {
    if (!selectedPoint || !tagInput.trim()) return;
    onSegmentClick(
      selectedPoint.x,
      selectedPoint.y,
      tagInput.trim().toLowerCase().replace(/\s+/g, "_"),
      subjectType
    );
    setSelectedPoint(null);
    setTagInput("");
  }, [selectedPoint, tagInput, subjectType, onSegmentClick]);

  const hasUnclayified = castMembers.some((m) => !m.is_clayified && !m.is_demo);

  return (
    <section className="bg-card rounded-3xl shadow-lg border border-border overflow-hidden">
      <div className="p-6 border-b border-border">
        <h2 className="text-xl font-bold text-foreground flex items-center gap-2">
          <Camera className="w-5 h-5 text-primary" />
          Cast Builder
        </h2>
        <p className="text-muted-foreground text-sm mt-1">
          Upload a photo, click to select objects, and build your cast
        </p>
      </div>

      <div className="grid md:grid-cols-2 gap-6 p-6">
        {/* Left Panel: Photo Upload + Canvas */}
        <div className="space-y-4">
          {!uploadedImageUrl ? (
            <div
              onDrop={handleDrop}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onClick={() => fileInputRef.current?.click()}
              className={cn(
                "aspect-video rounded-2xl border-2 border-dashed flex flex-col items-center justify-center cursor-pointer transition-all",
                isDragging
                  ? "border-primary bg-primary/10"
                  : "border-muted-foreground/30 hover:border-primary/50 hover:bg-accent/50"
              )}
            >
              <Upload className="w-12 h-12 text-muted-foreground mb-3" />
              <p className="text-muted-foreground font-medium">
                Drop a photo or click to upload
              </p>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                onChange={handleFileSelect}
                className="hidden"
              />
            </div>
          ) : (
            <div className="space-y-4">
              <div
                ref={canvasRef}
                onClick={handleCanvasClick}
                className="relative aspect-video rounded-2xl overflow-hidden cursor-crosshair bg-muted"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={uploadedImageUrl}
                  alt="Uploaded"
                  className="w-full h-full object-contain"
                />
                {selectedPoint && (
                  <div
                    className="absolute w-16 h-16 border-4 border-primary rounded-full animate-pulse pointer-events-none"
                    style={{
                      left: `${selectedPoint.x * 100}%`,
                      top: `${selectedPoint.y * 100}%`,
                      transform: "translate(-50%, -50%)",
                      boxShadow: "0 0 20px rgba(196, 98, 45, 0.5)",
                    }}
                  />
                )}
                <p className="absolute bottom-2 left-2 right-2 text-center text-xs text-white bg-black/50 rounded-lg py-1 px-2">
                  Click on an object to select it
                </p>
              </div>

              {selectedPoint && (
                <div className="bg-accent/50 rounded-2xl p-4 space-y-3">
                  <Input
                    value={tagInput}
                    onChange={(e) => setTagInput(e.target.value)}
                    placeholder="Name this character, e.g. bear"
                    className="bg-background rounded-xl"
                  />
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-muted-foreground">Type:</span>
                    <button
                      onClick={() => setSubjectType("person")}
                      className={cn(
                        "flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-sm font-medium transition-all",
                        subjectType === "person"
                          ? "bg-primary text-primary-foreground"
                          : "bg-muted text-muted-foreground hover:bg-muted/80"
                      )}
                    >
                      <User className="w-4 h-4" />
                      Person
                    </button>
                    <button
                      onClick={() => setSubjectType("object")}
                      className={cn(
                        "flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-sm font-medium transition-all",
                        subjectType === "object"
                          ? "bg-primary text-primary-foreground"
                          : "bg-muted text-muted-foreground hover:bg-muted/80"
                      )}
                    >
                      <Package className="w-4 h-4" />
                      Object
                    </button>
                  </div>
                  <Button
                    onClick={handleAddToCast}
                    disabled={!tagInput.trim()}
                    className="w-full rounded-xl bg-primary hover:bg-primary/90 text-primary-foreground font-semibold h-11 shadow-lg"
                  >
                    Add to Cast
                  </Button>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Right Panel: Cast Chips */}
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold text-foreground flex items-center gap-2">
              <ClayFigureSmall className="w-5 h-5 text-primary" />
              Your Cast
            </h3>
            {hasUnclayified && (
              <Button
                onClick={onClayifyAll}
                variant="secondary"
                size="sm"
                className="rounded-xl bg-secondary text-secondary-foreground hover:bg-secondary/80"
              >
                <Sparkles className="w-4 h-4 mr-1" />
                Clayify All
              </Button>
            )}
          </div>

          {castMembers.length === 0 ? (
            <div className="bg-muted/50 rounded-2xl p-8 text-center">
              <p className="text-muted-foreground">
                No cast members yet. Upload an image and click to select objects!
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {castMembers.map((member) => (
                <CastChip
                  key={member.id}
                  member={member}
                  onClayify={() => onClayify(member.id)}
                  onRemove={() => onRemove(member.id)}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function CastChip({
  member,
  onClayify,
  onRemove,
}: {
  member: CastMember;
  onClayify: () => void;
  onRemove: () => void;
}) {
  const [isClayifying, setIsClayifying] = useState(false);

  const handleClayify = () => {
    setIsClayifying(true);
    onClayify();
    // Reset after animation
    setTimeout(() => setIsClayifying(false), 3000);
  };

  return (
    <div className="flex items-center gap-3 bg-background rounded-2xl p-3 border border-border shadow-sm">
      {/* Thumbnail */}
      <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center overflow-hidden border-2 border-primary/30 shrink-0">
        {member.thumbnail_b64 ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={`data:image/png;base64,${member.thumbnail_b64}`}
            alt={member.tag}
            className="w-full h-full object-cover"
          />
        ) : (
          <span className="text-lg">
            {member.subject_type === "person" ? "👤" : "📦"}
          </span>
        )}
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <span className="font-bold text-primary">@{member.tag}</span>
        <div className="flex items-center gap-2 mt-1">
          {member.is_demo && (
            <Badge variant="outline" className="text-xs rounded-lg">
              demo
            </Badge>
          )}
          {isClayifying || (!member.is_clayified && !member.is_demo) ? (
            <Badge
              className={cn(
                "text-xs rounded-lg",
                isClayifying
                  ? "bg-secondary text-secondary-foreground animate-pulse"
                  : "bg-muted text-muted-foreground"
              )}
            >
              {isClayifying ? "clayifying…" : "raw"}
            </Badge>
          ) : member.is_clayified ? (
            <Badge className="text-xs rounded-lg bg-green-100 text-green-700 border-green-200">
              clay ready
            </Badge>
          ) : null}
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2">
        {!member.is_clayified && !member.is_demo && !isClayifying && (
          <Button
            onClick={handleClayify}
            size="sm"
            variant="ghost"
            className="rounded-xl text-secondary hover:text-secondary hover:bg-secondary/20"
          >
            <Sparkles className="w-4 h-4" />
          </Button>
        )}
        <button
          onClick={onRemove}
          className="w-6 h-6 rounded-full bg-muted hover:bg-destructive/20 hover:text-destructive flex items-center justify-center transition-colors"
        >
          <X className="w-3 h-3" />
        </button>
      </div>
    </div>
  );
}

function ClayFigureSmall({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <circle cx="12" cy="8" r="4" />
      <path d="M12 12v8" />
      <path d="M8 16l4 4 4-4" />
    </svg>
  );
}

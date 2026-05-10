"use client";

import { CheckCircle2, Circle, Loader2, XCircle, Play, Image, Music, Film, Palette, Clapperboard, Volume2, Layers } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { ProjectStatus, SceneProgress } from "@/app/page";

interface GenerationProgressProps {
  projectStatus: ProjectStatus | null;
  isGenerating: boolean;
}

const STAGES = [
  { key: "briefing", label: "Briefing", icon: Clapperboard },
  { key: "backgrounds", label: "Backgrounds", icon: Image },
  { key: "compositing", label: "Compositing", icon: Layers },
  { key: "animating", label: "Animating", icon: Play },
  { key: "scoring", label: "Scoring", icon: Music },
  { key: "audio", label: "Audio", icon: Volume2 },
  { key: "merging", label: "Merging", icon: Film },
  { key: "complete", label: "Complete", icon: CheckCircle2 },
] as const;

export function GenerationProgress({
  projectStatus,
  isGenerating,
}: GenerationProgressProps) {
  const currentStageIndex = projectStatus
    ? STAGES.findIndex((s) => s.key === projectStatus.status)
    : -1;

  return (
    <section className="bg-card rounded-3xl shadow-lg border border-border overflow-hidden">
      <div className="p-6 border-b border-border">
        <h2 className="text-xl font-bold text-foreground flex items-center gap-2">
          <Palette className="w-5 h-5 text-primary" />
          Generation Progress
        </h2>
        <p className="text-muted-foreground text-sm mt-1">
          Watch your claymation film come to life
        </p>
      </div>

      <div className="p-6 space-y-6">
        {/* Pipeline Stepper */}
        <div className="relative">
          {/* Progress line */}
          <div className="absolute top-5 left-0 right-0 h-1 bg-muted rounded-full overflow-hidden">
            <div
              className="h-full bg-primary transition-all duration-500 ease-out"
              style={{
                width: `${Math.max(0, ((currentStageIndex + 1) / STAGES.length) * 100)}%`,
              }}
            />
          </div>

          {/* Stage icons */}
          <div className="relative flex justify-between">
            {STAGES.map((stage, index) => {
              const Icon = stage.icon;
              const isComplete = currentStageIndex > index;
              const isCurrent = currentStageIndex === index;
              const isPending = currentStageIndex < index;

              return (
                <div
                  key={stage.key}
                  className="flex flex-col items-center gap-2"
                >
                  <div
                    className={cn(
                      "w-10 h-10 rounded-full flex items-center justify-center transition-all duration-300 relative z-10",
                      isComplete
                        ? "bg-primary text-primary-foreground"
                        : isCurrent
                        ? "bg-secondary text-secondary-foreground animate-pulse"
                        : "bg-muted text-muted-foreground"
                    )}
                  >
                    {isCurrent && isGenerating ? (
                      <Loader2 className="w-5 h-5 animate-spin" />
                    ) : (
                      <Icon className="w-5 h-5" />
                    )}
                  </div>
                  <span
                    className={cn(
                      "text-xs font-medium text-center",
                      isComplete || isCurrent
                        ? "text-foreground"
                        : "text-muted-foreground"
                    )}
                  >
                    {stage.label}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Clay Worm Progress Indicator */}
        {isGenerating && (
          <div className="flex justify-center py-4">
            <ClayWorm />
          </div>
        )}

        {/* Scene Cards Grid */}
        {projectStatus?.scene_progress && projectStatus.scene_progress.length > 0 && (
          <div className="space-y-4">
            <h3 className="font-semibold text-foreground">Scenes</h3>
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {projectStatus.scene_progress.map((scene) => (
                <SceneCard key={scene.scene_number} scene={scene} />
              ))}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

function SceneCard({ scene }: { scene: SceneProgress }) {
  return (
    <div className="bg-background rounded-2xl border border-border p-4 space-y-3">
      <div className="flex items-center justify-between">
        <span className="font-bold text-foreground">Scene {scene.scene_number}</span>
        <SceneStatusBadge status={scene.status} />
      </div>
      <p className="text-sm text-muted-foreground line-clamp-2">{scene.setting}</p>
      
      {/* Video thumbnail preview */}
      <div className="aspect-video rounded-xl bg-muted overflow-hidden">
        {scene.status === "complete" && scene.video_url ? (
          <video
            src={scene.video_url}
            className="w-full h-full object-cover"
            muted
            playsInline
          />
        ) : scene.status === "processing" ? (
          <div className="w-full h-full flex items-center justify-center">
            <Loader2 className="w-8 h-8 text-secondary animate-spin" />
          </div>
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <Circle className="w-8 h-8 text-muted-foreground/30" />
          </div>
        )}
      </div>
    </div>
  );
}

function SceneStatusBadge({ status }: { status: SceneProgress["status"] }) {
  switch (status) {
    case "pending":
      return (
        <Badge variant="outline" className="text-xs rounded-lg">
          <Circle className="w-3 h-3 mr-1" />
          Pending
        </Badge>
      );
    case "processing":
      return (
        <Badge className="text-xs rounded-lg bg-secondary text-secondary-foreground">
          <Loader2 className="w-3 h-3 mr-1 animate-spin" />
          Processing
        </Badge>
      );
    case "complete":
      return (
        <Badge className="text-xs rounded-lg bg-green-100 text-green-700 border-green-200">
          <CheckCircle2 className="w-3 h-3 mr-1" />
          Complete
        </Badge>
      );
    case "failed":
      return (
        <Badge variant="destructive" className="text-xs rounded-lg">
          <XCircle className="w-3 h-3 mr-1" />
          Failed
        </Badge>
      );
  }
}

function ClayWorm() {
  return (
    <div className="flex items-center gap-1">
      {[...Array(5)].map((_, i) => (
        <div
          key={i}
          className="w-3 h-3 rounded-full bg-primary"
          style={{
            animation: "clayWorm 1.2s ease-in-out infinite",
            animationDelay: `${i * 0.1}s`,
          }}
        />
      ))}
      <style jsx>{`
        @keyframes clayWorm {
          0%, 100% {
            transform: translateY(0) scale(1);
            opacity: 0.7;
          }
          50% {
            transform: translateY(-8px) scale(1.2);
            opacity: 1;
          }
        }
      `}</style>
    </div>
  );
}

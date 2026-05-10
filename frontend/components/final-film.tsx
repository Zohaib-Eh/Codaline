"use client";

import { Download, RefreshCw, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useRef, useState } from "react";

interface FinalFilmProps {
  videoUrl: string;
  storyPrompt: string;
  onMakeAnother: () => void;
}

export function FinalFilm({ videoUrl, storyPrompt, onMakeAnother }: FinalFilmProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);

  // Generate a title from the story prompt
  const generateTitle = (prompt: string) => {
    // Extract mentioned characters and create a title
    const mentions = prompt.match(/@\w+/g) || [];
    if (mentions.length >= 2) {
      const char1 = mentions[0].slice(1);
      const char2 = mentions[1].slice(1);
      return `The Tale of ${capitalize(char1)} & ${capitalize(char2)}`;
    } else if (mentions.length === 1) {
      return `The Adventure of ${capitalize(mentions[0].slice(1))}`;
    }
    return "A Claymation Tale";
  };

  const capitalize = (str: string) => str.charAt(0).toUpperCase() + str.slice(1);

  const handlePlay = () => {
    if (videoRef.current) {
      if (isPlaying) {
        videoRef.current.pause();
      } else {
        videoRef.current.play();
      }
      setIsPlaying(!isPlaying);
    }
  };

  const handleDownload = () => {
    const link = document.createElement("a");
    link.href = videoUrl;
    link.download = "codaline-film.mp4";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <section className="bg-card rounded-3xl shadow-lg border border-border overflow-hidden">
      <div className="p-6 border-b border-border">
        <h2 className="text-xl font-bold text-foreground flex items-center gap-2">
          🎬 Your Film is Ready!
        </h2>
      </div>

      <div className="p-6 space-y-6">
        {/* Film Title */}
        <h3 className="text-2xl md:text-3xl font-bold text-center text-foreground">
          {generateTitle(storyPrompt)}
        </h3>

        {/* Video Player */}
        <div className="relative aspect-video rounded-2xl overflow-hidden bg-foreground/5 shadow-xl">
          <video
            ref={videoRef}
            src={videoUrl}
            className="w-full h-full object-contain bg-black"
            controls
            playsInline
            onPlay={() => setIsPlaying(true)}
            onPause={() => setIsPlaying(false)}
            onEnded={() => setIsPlaying(false)}
          />
          
          {/* Play overlay for demo */}
          {!isPlaying && (
            <button
              onClick={handlePlay}
              className="absolute inset-0 flex items-center justify-center bg-black/30 hover:bg-black/40 transition-colors group"
            >
              <div className="w-20 h-20 rounded-full bg-primary/90 flex items-center justify-center shadow-2xl group-hover:scale-110 transition-transform">
                <Play className="w-10 h-10 text-primary-foreground ml-1" fill="currentColor" />
              </div>
            </button>
          )}
        </div>

        {/* Actions */}
        <div className="flex flex-col sm:flex-row gap-4">
          <Button
            onClick={handleDownload}
            className="flex-1 h-12 rounded-2xl bg-primary hover:bg-primary/90 text-primary-foreground font-semibold shadow-lg"
          >
            <Download className="w-5 h-5 mr-2" />
            Download Film
          </Button>
          <Button
            onClick={onMakeAnother}
            variant="outline"
            className="flex-1 h-12 rounded-2xl border-2 font-semibold"
          >
            <RefreshCw className="w-5 h-5 mr-2" />
            Make Another
          </Button>
        </div>

        {/* Credits */}
        <div className="text-center pt-4 border-t border-border">
          <p className="text-sm text-muted-foreground">
            Made with ❤️ by <span className="font-semibold text-primary">Codaline</span>
          </p>
        </div>
      </div>
    </section>
  );
}

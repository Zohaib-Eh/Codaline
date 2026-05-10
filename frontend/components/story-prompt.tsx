"use client";

import { useRef, useState, useCallback, useEffect } from "react";
import { Film, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { CastMember, Tone } from "@/app/page";

interface StoryPromptProps {
  storyPrompt: string;
  tone: Tone | null;
  castMembers: CastMember[];
  isGenerating: boolean;
  canGenerate: boolean;
  onStoryChange: (story: string) => void;
  onToneChange: (tone: Tone) => void;
  onGenerate: () => void;
}

const TONES: { value: Tone; label: string; icon: string }[] = [
  { value: "warm", label: "Warm", icon: "☀️" },
  { value: "dark", label: "Dark", icon: "🌙" },
  { value: "whimsical", label: "Whimsical", icon: "✨" },
  { value: "dramatic", label: "Dramatic", icon: "🎭" },
];

export function StoryPrompt({
  storyPrompt,
  tone,
  castMembers,
  isGenerating,
  canGenerate,
  onStoryChange,
  onToneChange,
  onGenerate,
}: StoryPromptProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [showAutocomplete, setShowAutocomplete] = useState(false);
  const [autocompleteQuery, setAutocompleteQuery] = useState("");
  const [autocompletePosition, setAutocompletePosition] = useState({ top: 0, left: 0 });

  // Filter cast members for autocomplete
  const filteredCast = castMembers.filter((m) =>
    m.tag.toLowerCase().includes(autocompleteQuery.toLowerCase())
  );

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const value = e.target.value;
      onStoryChange(value);

      // Check for @ mention
      const cursorPos = e.target.selectionStart;
      const textBeforeCursor = value.slice(0, cursorPos);
      const atMatch = textBeforeCursor.match(/@(\w*)$/);

      if (atMatch) {
        setAutocompleteQuery(atMatch[1]);
        setShowAutocomplete(true);

        // Calculate position (simplified)
        if (textareaRef.current) {
          const rect = textareaRef.current.getBoundingClientRect();
          setAutocompletePosition({
            top: rect.height + 4,
            left: 16,
          });
        }
      } else {
        setShowAutocomplete(false);
      }
    },
    [onStoryChange]
  );

  const insertMention = useCallback(
    (tag: string) => {
      if (!textareaRef.current) return;

      const cursorPos = textareaRef.current.selectionStart;
      const textBeforeCursor = storyPrompt.slice(0, cursorPos);
      const textAfterCursor = storyPrompt.slice(cursorPos);

      // Find the @ position
      const atMatch = textBeforeCursor.match(/@(\w*)$/);
      if (atMatch) {
        const newTextBefore = textBeforeCursor.slice(0, -atMatch[0].length);
        const newValue = `${newTextBefore}@${tag} ${textAfterCursor}`;
        onStoryChange(newValue);
      }

      setShowAutocomplete(false);
      textareaRef.current.focus();
    },
    [storyPrompt, onStoryChange]
  );

  // Close autocomplete on click outside
  useEffect(() => {
    const handleClick = () => setShowAutocomplete(false);
    if (showAutocomplete) {
      document.addEventListener("click", handleClick);
      return () => document.removeEventListener("click", handleClick);
    }
  }, [showAutocomplete]);

  // Render story with highlighted mentions
  const renderHighlightedStory = () => {
    const parts = storyPrompt.split(/(@\w+)/g);
    return parts.map((part, i) => {
      if (part.startsWith("@")) {
        const tag = part.slice(1);
        const exists = castMembers.some((m) => m.tag === tag);
        return (
          <span
            key={i}
            className={cn(
              "inline-flex items-center px-1.5 py-0.5 rounded-lg text-sm font-medium mx-0.5",
              exists
                ? "bg-primary/20 text-primary"
                : "bg-muted text-muted-foreground"
            )}
          >
            {part}
          </span>
        );
      }
      return <span key={i}>{part}</span>;
    });
  };

  return (
    <section className="bg-card rounded-3xl shadow-lg border border-border overflow-hidden">
      <div className="p-6 border-b border-border">
        <h2 className="text-xl font-bold text-foreground flex items-center gap-2">
          <Film className="w-5 h-5 text-primary" />
          Story Prompt
        </h2>
        <p className="text-muted-foreground text-sm mt-1">
          Write your story using @mentions to include cast members
        </p>
      </div>

      <div className="p-6 space-y-6">
        {/* Story Textarea */}
        <div className="relative">
          <textarea
            ref={textareaRef}
            value={storyPrompt}
            onChange={handleInputChange}
            placeholder="Tell your story… e.g. @bear tries to find @cup before the sun sets"
            rows={4}
            className="w-full bg-background border border-border rounded-2xl px-4 py-3 text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary resize-none text-base"
          />

          {/* Preview overlay (visual only) */}
          {storyPrompt && (
            <div className="absolute inset-0 px-4 py-3 pointer-events-none opacity-0">
              {renderHighlightedStory()}
            </div>
          )}

          {/* Autocomplete dropdown */}
          {showAutocomplete && filteredCast.length > 0 && (
            <div
              className="absolute z-10 bg-background border border-border rounded-xl shadow-lg overflow-hidden"
              style={{ top: autocompletePosition.top, left: autocompletePosition.left }}
              onClick={(e) => e.stopPropagation()}
            >
              {filteredCast.map((member) => (
                <button
                  key={member.id}
                  onClick={() => insertMention(member.tag)}
                  className="w-full px-4 py-2 text-left hover:bg-accent flex items-center gap-2 transition-colors"
                >
                  <span className="w-6 h-6 rounded-full bg-primary/20 flex items-center justify-center text-xs">
                    {member.subject_type === "person" ? "👤" : "📦"}
                  </span>
                  <span className="font-medium text-primary">@{member.tag}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Cast tags preview */}
        {castMembers.length > 0 && (
          <div className="flex flex-wrap gap-2">
            <span className="text-sm text-muted-foreground">Available:</span>
            {castMembers.map((member) => (
              <button
                key={member.id}
                onClick={() => {
                  onStoryChange(storyPrompt + `@${member.tag} `);
                  textareaRef.current?.focus();
                }}
                className="inline-flex items-center px-2 py-1 rounded-lg bg-primary/10 text-primary text-sm font-medium hover:bg-primary/20 transition-colors"
              >
                @{member.tag}
              </button>
            ))}
          </div>
        )}

        {/* Tone Selection */}
        <div className="space-y-3">
          <span className="text-sm font-medium text-foreground">Tone</span>
          <div className="flex flex-wrap gap-2">
            {TONES.map((t) => (
              <button
                key={t.value}
                onClick={() => onToneChange(t.value)}
                className={cn(
                  "flex items-center gap-2 px-4 py-2.5 rounded-2xl font-medium transition-all",
                  tone === t.value
                    ? "bg-primary text-primary-foreground shadow-lg"
                    : "bg-muted text-muted-foreground hover:bg-muted/80"
                )}
              >
                <span>{t.icon}</span>
                <span>{t.label}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Generate Button */}
        <Button
          onClick={onGenerate}
          disabled={!canGenerate || isGenerating}
          className="w-full h-14 rounded-2xl bg-primary hover:bg-primary/90 text-primary-foreground font-bold text-lg shadow-xl disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isGenerating ? (
            <>
              <Loader2 className="w-5 h-5 mr-2 animate-spin" />
              Directing your film…
            </>
          ) : (
            <>
              Make Film 🎬
            </>
          )}
        </Button>

        {!canGenerate && !isGenerating && (
          <p className="text-center text-sm text-muted-foreground">
            {castMembers.length === 0
              ? "Add at least one cast member to continue"
              : !storyPrompt.trim()
              ? "Write your story prompt"
              : "Select a tone for your film"}
          </p>
        )}
      </div>
    </section>
  );
}

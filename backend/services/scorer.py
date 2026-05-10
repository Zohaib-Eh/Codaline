from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Any

import anthropic
from dotenv import load_dotenv

from models import FilmBrief, ToneEnum

load_dotenv()

_client = anthropic.AsyncAnthropic(api_key=os.getenv("ANTHROPIC_API_KEY", ""))
CLAUDE_MODEL = os.getenv("CLAUDE_MODEL", "claude-sonnet-4-6")

_SYSTEM_PROMPT = """\
You are a composer and sound designer for a claymation stop-motion film.
Given a completed film brief, you write two things:

1. NARRATION SCRIPT — a warm storyteller voice (Paddington Bear / Roald Dahl style).
   Each scene has a word budget shown in brackets — HARD LIMIT, do not exceed it.
   Speaking rate is ~2 words per second. Exceeding the budget means narration runs
   over the scene cut and becomes out of sync with the visuals.
   Write exactly one sentence per scene. Keep it vivid and present-tense.
   Format: [MM:SS] sentence
   Example: [00:00] The bear set off at dawn, determined to find what was lost.

2. SOUND TRANSCRIPT — a moment-by-moment description of the music and sound design
   across the entire film, referencing timestamps in MM:SS format.
   Cover: opening music theme, ambient sounds per scene, transition swells between
   scenes, character sound effects, and a closing resolution.
   Be specific: name instruments, describe tempo, texture, and emotional quality.
   This transcript will be used directly to generate the audio score.
"""

_SCORE_TOOL: dict[str, Any] = {
    "name": "submit_film_score",
    "description": "Submit the narration script and sound design transcript for the film.",
    "input_schema": {
        "type": "object",
        "required": ["narration_script", "sound_transcript"],
        "properties": {
            "narration_script": {
                "type": "string",
                "description": "Full narration to be read by a storyteller voice over the film.",
            },
            "sound_transcript": {
                "type": "string",
                "description": (
                    "Timestamped sound design and music description for the entire film, "
                    "in MM:SS format. Covers music, ambience, effects, and transitions."
                ),
            },
        },
    },
}


@dataclass
class FilmScore:
    narration_script: str
    sound_transcript: str


def _build_user_message(brief: FilmBrief, tone: ToneEnum) -> str:
    lines = [
        f'Title: "{brief.title}"',
        f"Tone: {tone.value}",
        f"Total duration: {brief.total_duration} seconds",
        "",
        "Scenes (word budget = scene_duration_seconds × 2 × 0.75, hard limit):",
    ]
    elapsed = 0
    for scene in brief.scenes:
        start_mm = elapsed // 60
        start_ss = elapsed % 60
        elapsed += scene.duration
        end_mm = elapsed // 60
        end_ss = elapsed % 60
        clip_duration = 5 if scene.duration < 30 else 10  # mirrors runware.py clip cap
        word_budget = int(clip_duration * 1.5)  # ~1.5 words/sec for slow storyteller pace
        lines.append(
            f"  Scene {scene.scene_number} ({start_mm:02d}:{start_ss:02d} – {end_mm:02d}:{end_ss:02d}) "
            f"[narration budget: {word_budget} words]: "
            f"{scene.setting}. Cast: {', '.join(scene.cast)}. "
            f"Action: {scene.motion_prompt}. Mood: {scene.mood}."
        )

    lines += ["", "Write the narration and sound transcript for this claymation film."]
    return "\n".join(lines)


async def generate_film_score(brief: FilmBrief, tone: ToneEnum) -> FilmScore:
    """
    Call Claude to write narration + sound design transcript for the full film.
    """
    message = await _client.messages.create(
        model=CLAUDE_MODEL,
        max_tokens=2048,
        system=_SYSTEM_PROMPT,
        tools=[_SCORE_TOOL],
        tool_choice={"type": "tool", "name": "submit_film_score"},
        messages=[
            {"role": "user", "content": _build_user_message(brief, tone)}
        ],
    )

    tool_block = next(
        (b for b in message.content if b.type == "tool_use"),
        None,
    )
    if tool_block is None:
        raise ValueError("Claude did not call submit_film_score")

    inp = tool_block.input
    return FilmScore(
        narration_script=inp.get("narration_script") or inp.get("narration", ""),
        sound_transcript=inp.get("sound_transcript") or inp.get("transcript", ""),
    )

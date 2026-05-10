from __future__ import annotations

import json
import os
from typing import Any

import anthropic
from dotenv import load_dotenv

import db
from models import CastMember, CastPlacement, FilmBrief, SceneSpec, ToneEnum

load_dotenv()

_client = anthropic.AsyncAnthropic(api_key=os.getenv("ANTHROPIC_API_KEY", ""))
CLAUDE_MODEL = os.getenv("CLAUDE_MODEL", "claude-sonnet-4-6")

_SYSTEM_PROMPT = """\
You are the director of a claymation stop-motion film studio.
Given a story prompt, a tone, and a cast of clay characters, you write a concise film brief.

Rules:
- 3 to 5 scenes only.
- Total duration must not exceed 300 seconds (5 minutes).
- Only use cast members that are provided — never invent new characters.
- Each scene must include at least one cast member from the provided cast.
- Scenes must form a continuous, coherent story — each scene follows directly from the previous.
- motion_prompt is a literal animation instruction for the AI video model — describe exactly what
  is continuously happening in the frame, in present tense, with precise positions and actions.
  Think of it as a camera-ready description of a 5-second clip. Rules:
  * Describe what IS happening (continuous action), never a sequence of steps or a transition.
  * Avoid: "gets into", "climbs onto", "then", "arrives at", "walks over to" — these imply
    multi-step sequences the model will hallucinate.
  * Use instead: "bear sitting on car roof, gripping the edges, car speeding through a forest"
  * Specify where each character is physically: "bear on the roof", "cup rolling on the ground"
  * One clear continuous action per character, happening simultaneously.
  Bad:  "bear climbs into the car and they drive off together"
  Good: "bear crouching on the car roof, gripping tight, car racing down a dirt road at speed"
  Bad:  "bear finds the cup and picks it up happily"
  Good: "bear standing over cup on the ground, reaching down with both arms, cup tilting upright"
- scene_context is one sentence describing the story state ENTERING this scene — what just happened,
  where characters are, what they know. Scene 1 context sets the opening state.
  This is used to brief the background artist and animator so they understand the continuity.
- setting is a short, evocative description of the physical location for that scene.
- mood is a comma-separated list of 2-3 adjectives.
- For each cast member in a scene, provide a placement:
    x/y are normalised coordinates (0.0–1.0): x is horizontal (0=left, 1=right),
    y is the vertical base (feet) of the character (0=top, 1=bottom).
    scale is the character height as a fraction of the background height (0.1–0.6).
    z_index controls depth order (0=furthest back, higher=closer to camera).
- Placements should reflect the scene's action and staging — spread characters out naturally.
- Write the story as if it will be filmed with physical clay sets and puppets.
"""


_FILM_BRIEF_TOOL: dict[str, Any] = {
    "name": "submit_film_brief",
    "description": "Submit the complete film brief for the claymation production.",
    "input_schema": {
        "type": "object",
        "required": ["title", "total_duration", "scenes"],
        "properties": {
            "title": {"type": "string"},
            "total_duration": {"type": "integer", "description": "Total film duration in seconds"},
            "scenes": {
                "type": "array",
                "minItems": 3,
                "maxItems": 5,
                "items": {
                    "type": "object",
                    "required": ["scene_number", "setting", "cast", "motion_prompt", "scene_context", "mood", "duration", "placements"],
                    "properties": {
                        "scene_number":   {"type": "integer"},
                        "setting":        {"type": "string"},
                        "cast":           {"type": "array", "items": {"type": "string"}},
                        "motion_prompt":  {"type": "string"},
                        "scene_context":  {"type": "string", "description": "One sentence: story state entering this scene — what just happened and where characters are."},
                        "mood":           {"type": "string"},
                        "duration":       {"type": "integer", "description": "Scene duration in seconds"},
                        "placements": {
                            "type": "array",
                            "items": {
                                "type": "object",
                                "required": ["tag", "x", "y", "scale", "z_index"],
                                "properties": {
                                    "tag":     {"type": "string"},
                                    "x":       {"type": "number", "minimum": 0.0, "maximum": 1.0},
                                    "y":       {"type": "number", "minimum": 0.0, "maximum": 1.0},
                                    "scale":   {"type": "number", "minimum": 0.1, "maximum": 0.6},
                                    "z_index": {"type": "integer", "minimum": 0},
                                },
                            },
                        },
                    },
                },
            },
        },
    },
}


def _build_user_message(
    story_prompt: str,
    tone: ToneEnum,
    cast: list[CastMember],
) -> str:
    actors = [m for m in cast if m.subject_type.value in ("person", "character", "object")]
    props  = [m for m in cast if m.subject_type.value == "prop"]

    lines = [f"Story: {story_prompt}", f"Tone: {tone.value}", ""]

    if actors:
        lines.append("Characters (living beings with agency — they decide, feel, and act):")
        for m in actors:
            lines.append(f"  - @{m.tag} ({m.subject_type.value})")

    if props:
        lines.append("Props (inanimate objects — they appear and are acted upon, but have no will of their own.")
        lines.append("  Include them in scenes and placements normally. Write them as things that get used,")
        lines.append("  climbed on, driven, thrown, etc. — never as the initiator of action):")
        for m in props:
            lines.append(f"  - @{m.tag}")

    lines += ["", "Write the film brief for this claymation production."]
    return "\n".join(lines)


def _strip_at(tag: str) -> str:
    return tag.lstrip("@")


def _parse_tool_result(tool_input: dict) -> tuple[FilmBrief, dict[int, list[CastPlacement]]]:
    scenes = []
    placements_by_scene: dict[int, list[CastPlacement]] = {}

    for raw_scene in tool_input["scenes"]:
        scenes.append(SceneSpec(
            scene_number=raw_scene["scene_number"],
            setting=raw_scene["setting"],
            cast=[_strip_at(t) for t in raw_scene["cast"]],
            motion_prompt=raw_scene["motion_prompt"],
            scene_context=raw_scene.get("scene_context", ""),
            mood=raw_scene["mood"],
            duration=raw_scene["duration"],
        ))
        placements_by_scene[raw_scene["scene_number"]] = [
            CastPlacement(**{**p, "tag": _strip_at(p["tag"])})
            for p in raw_scene["placements"]
        ]

    brief = FilmBrief(
        title=tool_input["title"],
        total_duration=tool_input["total_duration"],
        scenes=scenes,
    )
    return brief, placements_by_scene


async def generate_film_brief(
    project_id: str,
    story_prompt: str,
    tone: ToneEnum,
    cast: list[CastMember],
) -> tuple[FilmBrief, dict[int, list[CastPlacement]]]:
    """
    Call Claude to write a film brief.
    Returns (FilmBrief, placements_by_scene_number).
    Saves the brief JSON to the project row in SQLite.
    """
    message = await _client.messages.create(
        model=CLAUDE_MODEL,
        max_tokens=2048,
        system=_SYSTEM_PROMPT,
        tools=[_FILM_BRIEF_TOOL],
        tool_choice={"type": "tool", "name": "submit_film_brief"},
        messages=[
            {"role": "user", "content": _build_user_message(story_prompt, tone, cast)}
        ],
    )

    tool_block = next(
        (b for b in message.content if b.type == "tool_use"),
        None,
    )
    if tool_block is None:
        raise ValueError("Claude did not call submit_film_brief")

    brief, placements = _parse_tool_result(tool_block.input)

    await db.update_project(
        project_id,
        film_brief_json=brief.model_dump_json(),
        current_stage="backgrounds",
    )

    return brief, placements

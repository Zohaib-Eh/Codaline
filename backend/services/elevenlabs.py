from __future__ import annotations

import os
import re
import subprocess
import uuid
from pathlib import Path

import httpx
from dotenv import load_dotenv

load_dotenv()

ELEVENLABS_API_KEY = os.getenv("ELEVENLABS_API_KEY", "")
ELEVENLABS_BASE = "https://api.elevenlabs.io"

# Warm British storyteller — ideal for claymation narration; override via env
NARRATOR_VOICE_ID = os.getenv("ELEVENLABS_VOICE_ID", "JBFqnCBsd6RMkjVDRZzb")  # George
TTS_MODEL = os.getenv("ELEVENLABS_TTS_MODEL", "eleven_multilingual_v2")
MUSIC_MODEL = os.getenv("ELEVENLABS_MUSIC_MODEL", "music_v1")

AUDIO_DIR = Path("static/audio")
AUDIO_DIR.mkdir(parents=True, exist_ok=True)

def _headers() -> dict:
    return {
        "xi-api-key": os.getenv("ELEVENLABS_API_KEY", ELEVENLABS_API_KEY),
        "Content-Type": "application/json",
    }


def _audio_duration(path: str) -> float:
    """Return duration of an audio file in seconds via ffprobe."""
    result = subprocess.run(
        ["ffprobe", "-v", "quiet", "-show_entries", "format=duration", "-of", "csv=p=0", path],
        capture_output=True, text=True,
    )
    try:
        return float(result.stdout.strip())
    except ValueError:
        return 0.0


def _pad_audio(input_path: str, output_path: str, target_dur: float) -> None:
    """Pad audio with silence to exactly target_dur seconds."""
    subprocess.run([
        "ffmpeg", "-y", "-i", input_path,
        "-af", f"apad=whole_dur={target_dur}",
        "-t", str(target_dur),
        output_path,
    ], capture_output=True)


def _concat_audio_files(paths: list[str], output_path: str) -> None:
    list_file = AUDIO_DIR / f"{uuid.uuid4()}_concat.txt"
    list_file.write_text("\n".join(f"file '{Path(p).resolve()}'" for p in paths))
    subprocess.run([
        "ffmpeg", "-y", "-f", "concat", "-safe", "0",
        "-i", str(list_file), "-c", "copy", output_path,
    ], capture_output=True)
    list_file.unlink(missing_ok=True)


async def _tts_bytes(text: str) -> bytes:
    payload = {
        "text": text,
        "model_id": TTS_MODEL,
        "voice_settings": {"stability": 0.55, "similarity_boost": 0.75, "style": 0.3, "speed": 0.92},
        "output_format": "mp3_44100_128",
    }
    async with httpx.AsyncClient(timeout=120) as client:
        resp = await client.post(
            f"{ELEVENLABS_BASE}/v1/text-to-speech/{NARRATOR_VOICE_ID}",
            json=payload, headers=_headers(),
        )
        if not resp.is_success:
            print(f"[AUDIO] TTS failed {resp.status_code}: {resp.text[:500]}")
            resp.raise_for_status()
        return resp.content


async def generate_narration(narration_script: str, clip_durations: list[int] | None = None) -> str:
    """
    TTS each scene's narration line separately, pad with silence to fill the clip
    duration, then concatenate — so each scene's narration starts exactly when its
    video clip starts, not immediately after the previous narration ends.
    """
    # Parse [MM:SS] sentence lines written by scorer
    lines = re.findall(r'\[\d{2}:\d{2}\]\s*(.+)', narration_script)

    if not lines or not clip_durations or len(lines) != len(clip_durations):
        # Fallback: single TTS pass, no timing enforcement
        print(f"[AUDIO] narration fallback — single pass ({len(narration_script)} chars)")
        audio_bytes = await _tts_bytes(narration_script)
        out_path = AUDIO_DIR / f"{uuid.uuid4()}_narration.mp3"
        out_path.write_bytes(audio_bytes)
        return str(out_path)

    segment_paths: list[str] = []
    tmp_paths: list[str] = []

    for i, (text, clip_dur) in enumerate(zip(lines, clip_durations)):
        print(f"[AUDIO] narration scene {i+1}: '{text[:60]}…' (clip={clip_dur}s)")
        audio_bytes = await _tts_bytes(text)

        raw_path = str(AUDIO_DIR / f"{uuid.uuid4()}_seg{i}_raw.mp3")
        Path(raw_path).write_bytes(audio_bytes)
        tmp_paths.append(raw_path)

        narr_dur = _audio_duration(raw_path)
        print(f"[AUDIO]   narration duration: {narr_dur:.1f}s, padding to {clip_dur}s")

        if narr_dur < clip_dur - 0.1:
            padded_path = str(AUDIO_DIR / f"{uuid.uuid4()}_seg{i}_padded.mp3")
            _pad_audio(raw_path, padded_path, clip_dur)
            tmp_paths.append(padded_path)
            segment_paths.append(padded_path)
        else:
            segment_paths.append(raw_path)

    out_path = str(AUDIO_DIR / f"{uuid.uuid4()}_narration.mp3")
    _concat_audio_files(segment_paths, out_path)

    for p in tmp_paths:
        Path(p).unlink(missing_ok=True)

    print(f"[AUDIO] narration assembled: {out_path}")
    return out_path


async def generate_score(sound_transcript: str, total_duration: int) -> str:
    """
    Generate ambient film score via ElevenLabs sound generation.
    Returns path to saved mp3 file.
    total_duration is in seconds.
    """
    # sound-generation endpoint max is 22s; trim transcript to a concise style description
    description = sound_transcript[:400].strip()
    duration_s = min(22.0, max(0.5, float(total_duration)))

    payload = {
        "text": description,
        "duration_seconds": duration_s,
        "prompt_influence": 0.3,
    }

    print(f"[AUDIO] generating score — {duration_s}s")
    async with httpx.AsyncClient(timeout=300) as client:
        resp = await client.post(
            f"{ELEVENLABS_BASE}/v1/sound-generation",
            json=payload,
            headers=_headers(),
        )
        if not resp.is_success:
            print(f"[AUDIO] score failed {resp.status_code}: {resp.text[:500]}")
            resp.raise_for_status()
        audio_bytes = resp.content

    out_path = AUDIO_DIR / f"{uuid.uuid4()}_score.mp3"
    out_path.write_bytes(audio_bytes)
    print(f"[AUDIO] score saved: {out_path}")
    return str(out_path)


def merge_narration_and_score(
    narration_path: str,
    score_path: str,
    total_duration: int,
) -> str:
    """
    Mix narration (clear, prominent) over score (softer, underneath).
    Returns path to merged mp3, trimmed/padded to total_duration.
    Uses FFmpeg.
    """
    out_path = AUDIO_DIR / f"{uuid.uuid4()}_final_audio.mp3"

    # amix: narration at 100%, score at 40% volume underneath
    # atrim + apad: ensure output is exactly total_duration seconds
    cmd = [
        "ffmpeg", "-y",
        "-i", narration_path,
        "-i", score_path,
        "-filter_complex",
        (
            f"[1:a]volume=0.4[score];"
            f"[0:a][score]amix=inputs=2:duration=longest,"
            f"atrim=0:{total_duration},"
            f"apad=whole_dur={total_duration}"
            "[out]"
        ),
        "-map", "[out]",
        "-codec:a", "libmp3lame",
        "-q:a", "2",
        str(out_path),
    ]

    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        raise RuntimeError(f"FFmpeg audio merge failed:\n{result.stderr}")

    return str(out_path)

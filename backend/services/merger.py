from __future__ import annotations

import asyncio
import subprocess
import uuid
from pathlib import Path

import httpx

OUTPUTS_DIR = Path("static/outputs")
OUTPUTS_DIR.mkdir(parents=True, exist_ok=True)

DOWNLOADS_DIR = Path("static/downloads")
DOWNLOADS_DIR.mkdir(parents=True, exist_ok=True)

CROSSFADE_DURATION = 1.0  # seconds between scenes


async def _download(url: str, dest: Path) -> None:
    async with httpx.AsyncClient(timeout=120, follow_redirects=True) as client:
        resp = await client.get(url)
        resp.raise_for_status()
        dest.write_bytes(resp.content)


def _probe_duration(path: Path) -> float:
    """Return video duration in seconds via ffprobe."""
    result = subprocess.run(
        [
            "ffprobe", "-v", "quiet",
            "-show_entries", "format=duration",
            "-of", "default=noprint_wrappers=1:nokey=1",
            str(path),
        ],
        capture_output=True,
        text=True,
    )
    return float(result.stdout.strip())


def _build_xfade_filter(durations: list[float]) -> tuple[str, str]:
    """
    Build an FFmpeg filter_complex string that chains xfade transitions
    between N video inputs. Returns (filter_complex, final_output_label).
    """
    n = len(durations)
    if n == 1:
        return "", "0:v"

    parts: list[str] = []
    prev_label = "[0:v]"
    # Running offset accounts for all prior clips minus prior crossfades
    offset = durations[0] - CROSSFADE_DURATION

    for i in range(1, n):
        out_label = f"[v{i}]"
        parts.append(
            f"{prev_label}[{i}:v]xfade=transition=fade"
            f":duration={CROSSFADE_DURATION}:offset={offset:.3f}{out_label}"
        )
        prev_label = out_label
        if i < n - 1:
            offset += durations[i] - CROSSFADE_DURATION

    return ";".join(parts), prev_label.strip("[]")


async def merge_film(
    scene_video_urls: list[str],
    audio_path: str | None,
    project_id: str | None = None,
) -> str:
    """
    Download scene videos, stitch with crossfade transitions, overlay audio.
    Returns path of the final mp4 in static/outputs/.
    """
    if not scene_video_urls:
        raise ValueError("No scene videos to merge")

    prefix = project_id or str(uuid.uuid4())

    # Download all scene videos concurrently
    video_paths: list[Path] = [
        DOWNLOADS_DIR / f"{prefix}_scene{i}.mp4"
        for i in range(len(scene_video_urls))
    ]
    await asyncio.gather(
        *(_download(url, path) for url, path in zip(scene_video_urls, video_paths))
    )

    out_path = OUTPUTS_DIR / f"{prefix}_film.mp4"

    # Fallback: generate a silent audio track if none provided
    effective_audio = audio_path or _make_silent_audio(prefix, video_paths)

    if len(video_paths) == 1:
        _merge_single(video_paths[0], effective_audio, out_path)
    else:
        durations = [_probe_duration(p) for p in video_paths]
        _merge_multi(video_paths, durations, effective_audio, out_path)

    # Clean up downloaded scene files
    for p in video_paths:
        p.unlink(missing_ok=True)

    return str(out_path)


def _make_silent_audio(prefix: str, video_paths: list[Path]) -> str:
    """Generate a silent mp3 whose duration matches the total video length."""
    total = sum(_probe_duration(p) for p in video_paths)
    out = DOWNLOADS_DIR / f"{prefix}_silence.mp3"
    cmd = [
        "ffmpeg", "-y",
        "-f", "lavfi", "-i", "anullsrc=r=44100:cl=stereo",
        "-t", str(total),
        "-q:a", "9",
        str(out),
    ]
    _run(cmd)
    return str(out)


def _merge_single(video: Path, audio: str, out: Path) -> None:
    cmd = [
        "ffmpeg", "-y",
        "-i", str(video),
        "-i", audio,
        "-map", "0:v",
        "-map", "1:a",
        "-c:v", "copy",
        "-c:a", "aac",
        "-shortest",
        str(out),
    ]
    _run(cmd)


def _merge_multi(
    videos: list[Path],
    durations: list[float],
    audio: str,
    out: Path,
) -> None:
    inputs = []
    for v in videos:
        inputs += ["-i", str(v)]
    inputs += ["-i", audio]

    audio_index = len(videos)
    filter_str, final_v_label = _build_xfade_filter(durations)

    if filter_str:
        cmd = (
            ["ffmpeg", "-y"]
            + inputs
            + [
                "-filter_complex", filter_str,
                "-map", f"[{final_v_label}]",
                "-map", f"{audio_index}:a",
                "-c:v", "libx264",
                "-c:a", "aac",
                "-shortest",
                str(out),
            ]
        )
    else:
        # filter_str empty means single video fell through — use simple copy
        cmd = (
            ["ffmpeg", "-y"]
            + inputs
            + [
                "-map", "0:v",
                "-map", f"{audio_index}:a",
                "-c:v", "copy",
                "-c:a", "aac",
                "-shortest",
                str(out),
            ]
        )

    _run(cmd)


def _run(cmd: list[str]) -> None:
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        raise RuntimeError(f"FFmpeg failed:\n{result.stderr[-2000:]}")

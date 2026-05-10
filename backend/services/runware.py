from __future__ import annotations

import base64
import io
import os
import uuid
from pathlib import Path

import httpx
from PIL import Image
from dotenv import load_dotenv
from runware import IFrameImage, IVideoInference, Runware

from models import ToneEnum

load_dotenv()

RUNWARE_API_KEY = os.getenv("RUNWARE_API_KEY", "")
RUNWARE_URL = "https://api.runware.ai/v1"

VIDEO_MODEL = os.getenv("RUNWARE_VIDEO_MODEL", "klingai:3@2")

VIDEOS_DIR = Path("static/videos")
VIDEOS_DIR.mkdir(parents=True, exist_ok=True)

_TONE_VIDEO_STYLE = {
    ToneEnum.warm:      "warm soft lighting, gentle movement, cosy atmosphere",
    ToneEnum.dark:      "dramatic shadows, slow ominous motion, moody atmosphere",
    ToneEnum.whimsical: "bouncy playful movement, bright colours, magical feel",
    ToneEnum.dramatic:  "sweeping cinematic motion, high contrast, intense atmosphere",
}

# Stop motion style is the primary aesthetic — it leads the prompt, not a suffix.
# "8fps stop motion" is the most direct signal to Kling; everything else reinforces it.
_STOP_MOTION_PREFIX = (
    "8fps stop motion animation, claymation puppet, frame-by-frame movement, "
    "no motion blur, discrete stepped motion, slight positional jitter between frames, "
    "handcrafted puppet feel, Coraline Laika Studios aesthetic, Wallace and Gromit style, "
    "no smooth interpolation, no fluid motion"
)

_NEGATIVE_VIDEO_PROMPT = (
    "smooth animation, fluid motion, motion blur, interpolated frames, "
    "CGI, 3d render, realistic video, live action, "
    "duplicate character, two copies of the same character, character splitting, character cloning, "
    "extra characters, character morphing, character dissolve, character multiplication"
)


def _build_video_prompt(motion_prompt: str, tone: ToneEnum) -> str:
    tone_style = _TONE_VIDEO_STYLE[tone]
    return f"{motion_prompt}, {tone_style}, {_STOP_MOTION_PREFIX}"


def _image_to_b64(image: Image.Image) -> str:
    buf = io.BytesIO()
    image.convert("RGB").save(buf, format="JPEG", quality=90)
    return base64.b64encode(buf.getvalue()).decode()


def _ensure_min_size(image: Image.Image, min_side: int = 300) -> Image.Image:
    """Upscale if either dimension is below min_side (Kling referenceImage requirement)."""
    w, h = image.size
    if w >= min_side and h >= min_side:
        return image
    scale = min_side / min(w, h)
    return image.resize((int(w * scale), int(h * scale)), Image.LANCZOS)


def _image_to_data_uri(image: Image.Image, ensure_min: bool = False) -> str:
    if ensure_min:
        image = _ensure_min_size(image)
    return f"data:image/jpeg;base64,{_image_to_b64(image)}"


def _pad_to_square(image: Image.Image, min_side: int = 300) -> Image.Image:
    """Pad image to 1:1 square with white background. Kling only accepts 16:9, 9:16, or 1:1."""
    image = image.convert("RGBA")
    side = max(image.width, image.height, min_side)
    square = Image.new("RGBA", (side, side), (255, 255, 255, 255))
    x = (side - image.width) // 2
    y = (side - image.height) // 2
    square.paste(image, (x, y), image)
    return square.convert("RGB")


async def generate_video(
    composite_path: str,
    motion_prompt: str,
    tone: ToneEnum,
    duration: int,
    scene_id: str | None = None,
    cast_image_paths: list[str] | None = None,
) -> str:
    """
    Animate a composite scene image using Runware img2video (via official SDK).
    cast_image_paths are passed as referenceImages — ground truth for character appearance
    so Kling renders the exact same character in every scene, not its own interpretation.
    duration is clamped to Kling's supported range (5–10 seconds per clip).
    """
    composite = Image.open(composite_path).convert("RGB")
    if composite.size != (1920, 1080):
        composite = composite.resize((1920, 1080), Image.LANCZOS)
    clip_duration = 5 if duration < 30 else 10  # Kling only supports 5s or 10s
    prompt = _build_video_prompt(motion_prompt, tone)

    frame_images = [IFrameImage(inputImage=_image_to_data_uri(composite))]

    reference_uris: list[str] = []
    for cast_path in (cast_image_paths or []):
        try:
            reference_uris.append(_image_to_data_uri(_pad_to_square(Image.open(cast_path), min_side=300)))
        except Exception:
            pass

    video_params: dict = dict(
        positivePrompt=prompt,
        negativePrompt=_NEGATIVE_VIDEO_PROMPT,
        model=VIDEO_MODEL,
        width=1920,
        height=1080,
        duration=clip_duration,
        numberResults=1,
        frameImages=frame_images,
    )
    if reference_uris:
        video_params["referenceImages"] = reference_uris

    request = IVideoInference(**video_params)

    print(f"[VIDEO] connecting to Runware SDK…")
    runware = Runware(api_key=RUNWARE_API_KEY)
    await runware.connect()

    print(f"[VIDEO] submitting videoInference — {clip_duration}s, model={VIDEO_MODEL}")
    response = await runware.videoInference(requestVideo=request)

    # Kling is always async — response is IAsyncTaskResponse with taskUUID
    task_uuid = getattr(response, "taskUUID", None)
    if not task_uuid:
        raise ValueError(f"videoInference did not return a taskUUID: {response}")

    print(f"[VIDEO] task {task_uuid[:8]}… waiting for result via getResponse")
    videos = await runware.getResponse(taskUUID=task_uuid, numberResults=1)

    video_list = list(videos) if hasattr(videos, "__iter__") else [videos]
    if not video_list:
        raise ValueError("Runware getResponse returned no results")

    video_url = video_list[0].videoURL
    print(f"[VIDEO] done — {video_url}")
    return video_url

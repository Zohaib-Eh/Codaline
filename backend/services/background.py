from __future__ import annotations

import asyncio
import io
import os
import uuid
from pathlib import Path
from typing import TypedDict

import httpx
from PIL import Image
from dotenv import load_dotenv

from models import ToneEnum

load_dotenv()

RUNWARE_API_KEY = os.getenv("RUNWARE_API_KEY", "")
RUNWARE_URL = "https://api.runware.ai/v1"

BACKGROUNDS_DIR = Path("static/backgrounds")
BACKGROUNDS_DIR.mkdir(parents=True, exist_ok=True)

_MODEL = os.getenv("RUNWARE_BG_MODEL", "runware:100@1")

# Background dimensions — 16:9, multiples of 64 (SD requirement)
# Kling outputs at 1920x1080; backgrounds are upscaled internally
BG_WIDTH = int(os.getenv("BG_WIDTH", "1024"))
BG_HEIGHT = int(os.getenv("BG_HEIGHT", "576"))


class BackgroundLayers(TypedDict):
    sky: str        # file path
    midground: str
    foreground: str


_TONE_STYLE = {
    ToneEnum.warm:      "warm golden lighting, soft afternoon sun, cosy atmosphere, golden hour",
    ToneEnum.dark:      "moody shadows, cool desaturated palette, overcast light, ominous atmosphere",
    ToneEnum.whimsical: "bright playful colours, pastel tones, fairy-tale lighting, magical atmosphere",
    ToneEnum.dramatic:  "high contrast lighting, cinematic shadows, intense atmosphere, epic scale",
}

_SHARED_STYLE = (
    "claymation set design, stop motion aesthetic, handcrafted miniature environment, "
    "clay textures, soft studio lighting, Coraline visual style, Wallace and Gromit aesthetic, "
    "no people, no characters, background only"
)

_NEGATIVE = (
    "photorealistic, photograph, CGI, 3d render, digital art, characters, people, "
    "text, watermark, blurry, low quality"
)

_SCENE_PROMPT = (
    "wide establishing shot, {tone_style}, {setting}, "
    "full scene with sky, midground, and foreground visible, depth and atmosphere, {shared}"
)


async def _run_inference(payload_task: dict, scene_prefix: str, layer: str) -> str:
    """Execute a Runware imageInference task and save the result. Returns file path."""
    print(f"[BG] requesting {layer} for {scene_prefix[:8]}…")
    async with httpx.AsyncClient(timeout=120) as client:
        resp = await client.post(
            RUNWARE_URL,
            json=[payload_task],
            headers={"Authorization": f"Bearer {RUNWARE_API_KEY}"},
        )
        if not resp.is_success:
            raise ValueError(f"Runware text2img {resp.status_code} [{layer}]: {resp.text}")

    data = resp.json()
    results = data.get("data", data) if isinstance(data, dict) else data
    if not results:
        raise ValueError(f"Runware returned no results for {layer}: {data}")

    result = results[0]
    b64 = result.get("imageBase64Data") or result.get("imageURL")
    if not b64:
        raise ValueError(f"Runware result missing image data for {layer}: {result}")

    if b64.startswith("http"):
        async with httpx.AsyncClient(timeout=60) as client:
            img_resp = await client.get(b64)
            img_resp.raise_for_status()
            image = Image.open(io.BytesIO(img_resp.content))
    else:
        import base64
        image = Image.open(io.BytesIO(base64.b64decode(b64)))

    out_path = BACKGROUNDS_DIR / f"{scene_prefix}_{layer}.png"
    image.save(out_path, format="PNG")
    print(f"[BG] saved {layer}: {out_path}")
    return str(out_path)


async def _upload_image(path: str) -> str:
    """Upload an image to Runware and return its imageUUID."""
    import base64
    image_b64 = base64.b64encode(Path(path).read_bytes()).decode()
    async with httpx.AsyncClient(timeout=60) as client:
        resp = await client.post(
            RUNWARE_URL,
            json=[{"taskType": "imageUpload", "taskUUID": str(uuid.uuid4()), "image": image_b64}],
            headers={"Authorization": f"Bearer {RUNWARE_API_KEY}"},
        )
        if not resp.is_success:
            raise ValueError(f"Runware imageUpload {resp.status_code}: {resp.text}")
    data = resp.json()
    results = data.get("data", data) if isinstance(data, dict) else data
    image_uuid = results[0].get("imageUUID") if results else None
    if not image_uuid:
        raise ValueError(f"Runware imageUpload returned no imageUUID: {data}")
    return image_uuid


def _base_task(prompt: str, seed: int) -> dict:
    return {
        "taskType": "imageInference",
        "taskUUID": str(uuid.uuid4()),
        "model": _MODEL,
        "positivePrompt": prompt,
        "negativePrompt": _NEGATIVE,
        "width": BG_WIDTH,
        "height": BG_HEIGHT,
        "numberResults": 1,
        "outputType": ["base64Data"],
        "steps": 25,
        "CFGScale": 7,
        "seed": seed,
    }


async def generate_layers(setting: str, tone: ToneEnum, scene_prefix: str | None = None) -> BackgroundLayers:
    """
    Generate a single background image for a scene.
    Returns it as all three layer slots so the rest of the pipeline stays unchanged.
    """
    prefix = scene_prefix or str(uuid.uuid4())
    tone_style = _TONE_STYLE[tone]
    seed = uuid.uuid4().int & 0x7FFF_FFFF

    prompt = _SCENE_PROMPT.format(tone_style=tone_style, setting=setting, shared=_SHARED_STYLE)
    task = _base_task(prompt, seed)
    bg_path = await _run_inference(task, prefix, "background")

    return BackgroundLayers(sky=bg_path, midground=bg_path, foreground=bg_path)

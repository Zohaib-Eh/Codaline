from __future__ import annotations

import base64
import io
import os
import uuid
from pathlib import Path

import httpx
from PIL import Image
from dotenv import load_dotenv

import db
from models import SubjectTypeEnum

load_dotenv()

RUNWARE_API_KEY = os.getenv("RUNWARE_API_KEY", "")
RUNWARE_URL = "https://api.runware.ai/v1"

OBJECTS_DIR = Path("static/objects")
OBJECTS_DIR.mkdir(parents=True, exist_ok=True)

# SD-native trigger words that SDXL actually responds to for clay/stop-motion look.
# Movie name references ("Coraline style") are decorative — concrete material/texture
# words like "plasticine", "clay material", "rounded edges" do the real work.
# "claymation" must be the first token — it anchors the style immediately for the LoRA
_CLAY_CORE = (
    "claymation, made of plasticine, distinct fingerprint smudges and tool marks visible, "
    "soft studio lighting, detailed sculpted textures, stop motion animation aesthetic, "
    "rounded soft edges, matte clay surface, vivid saturated colours"
)

_PROMPT_TEMPLATES = {
    SubjectTypeEnum.person: (
        "claymation, clay character, {subject}, " + _CLAY_CORE +
        ", expressive clay face, clay figure, stop motion puppet"
    ),
    SubjectTypeEnum.character: (
        "claymation, clay character, {subject}, " + _CLAY_CORE +
        ", expressive clay puppet, handcrafted stop motion figure"
    ),
    SubjectTypeEnum.object: (
        "claymation, clay character, {subject}, " + _CLAY_CORE +
        ", expressive clay puppet, handcrafted stop motion figure"
    ),
    SubjectTypeEnum.prop: (
        "claymation, clay prop, {subject}, " + _CLAY_CORE +
        ", isolated object, simple clay form, no face, no eyes, no expressions"
    ),
}

_NEGATIVE_PROMPT = (
    "realistic, photographic, smooth, natural skin, sharp edges, plastic sheen, "
    "CGI, 3d render, digital art, blurry, low quality, deformed, extra limbs, text, watermark"
)

_NEGATIVE_PROP = _NEGATIVE_PROMPT + ", face, eyes, nose, mouth, character face, anthropomorphic features, human features"


def _build_prompt(subject_type: SubjectTypeEnum, tag: str, description: str | None) -> str:
    subject = description.strip() if description else tag.strip()
    return _PROMPT_TEMPLATES[subject_type].format(subject=subject)

_MODEL = os.getenv("RUNWARE_CLAYIFY_MODEL", "runware:100@1")
_LORA = os.getenv("RUNWARE_CLAYIFY_LORA", "")

# Characters (teddy, toys with identity): low strength to preserve shape, lower CFG
# Props (vehicles, objects): slightly higher strength is fine, shape is geometric
_TYPE_PARAMS: dict[str, dict] = {
    "person":    {"imageStrength": 0.35, "CFGScale": 7},
    "character": {"imageStrength": 0.35, "CFGScale": 7},
    "object":    {"imageStrength": 0.45, "CFGScale": 8},  # legacy — was the old prop/object type
    "prop":      {"imageStrength": 0.45, "CFGScale": 8},
}


def _pil_to_b64(image: Image.Image) -> str:
    buf = io.BytesIO()
    image.save(buf, format="PNG")
    return base64.b64encode(buf.getvalue()).decode()


def _b64_to_pil(data: str) -> Image.Image:
    return Image.open(io.BytesIO(base64.b64decode(data)))


async def _runware_img2img(
    input_image: Image.Image,
    positive_prompt: str,
    width: int,
    height: int,
    subject_type: str = "prop",
    negative_prompt: str | None = None,
) -> Image.Image:
    # Step 1: upload image to get a Runware imageUUID
    upload_uuid = str(uuid.uuid4())
    async with httpx.AsyncClient(timeout=60) as client:
        up_resp = await client.post(
            RUNWARE_URL,
            json=[{"taskType": "imageUpload", "taskUUID": upload_uuid, "image": _pil_to_b64(input_image)}],
            headers={"Authorization": f"Bearer {RUNWARE_API_KEY}"},
        )
        if not up_resp.is_success:
            raise ValueError(f"Runware imageUpload {up_resp.status_code}: {up_resp.text}")
        up_resp.raise_for_status()

    up_data = up_resp.json()
    up_results = up_data.get("data", up_data) if isinstance(up_data, dict) else up_data
    image_uuid = up_results[0].get("imageUUID") if up_results else None
    if not image_uuid:
        raise ValueError(f"Runware image upload returned no imageUUID: {up_data}")

    # Step 2: run img2img inference
    params = _TYPE_PARAMS.get(subject_type, _TYPE_PARAMS["prop"])
    inference_uuid = str(uuid.uuid4())
    task: dict = {
        "taskType": "imageInference",
        "taskUUID": inference_uuid,
        "model": _MODEL,
        "positivePrompt": positive_prompt,
        "negativePrompt": negative_prompt or _NEGATIVE_PROMPT,
        "seedImage": image_uuid,
        "imageStrength": params["imageStrength"],
        "width": width,
        "height": height,
        "numberResults": 1,
        "outputType": ["URL"],
        "steps": 30,
        "CFGScale": params["CFGScale"],
    }
    if _LORA:
        task["lora"] = [{"model": _LORA, "weight": 1.0}]

    async with httpx.AsyncClient(timeout=120) as client:
        resp = await client.post(
            RUNWARE_URL,
            json=[task],
            headers={"Authorization": f"Bearer {RUNWARE_API_KEY}"},
        )
        if not resp.is_success:
            raise ValueError(f"Runware imageInference {resp.status_code}: {resp.text}")
        resp.raise_for_status()

    data = resp.json()
    results = data.get("data", data) if isinstance(data, dict) else data
    if not results:
        raise ValueError(f"Runware returned no results: {data}")

    result = results[0]
    b64 = result.get("imageBase64Data") or result.get("imageURL")
    if not b64:
        raise ValueError(f"Runware result missing image data: {result}")

    if b64.startswith("http"):
        async with httpx.AsyncClient(timeout=60) as client:
            img_resp = await client.get(b64)
            img_resp.raise_for_status()
            return Image.open(io.BytesIO(img_resp.content)).convert("RGBA")

    return _b64_to_pil(b64).convert("RGBA")


def _target_size(image: Image.Image) -> tuple[int, int]:
    """Scale to fit within 1024px, rounded to nearest 64px multiple."""
    w, h = image.size
    max_side = 1024
    if w > max_side or h > max_side:
        scale = max_side / max(w, h)
        w, h = int(w * scale), int(h * scale)
    # Round to nearest 64px multiple, clamp between 128 and 1024
    round64 = lambda x: max(128, min(1024, (x + 31) // 64 * 64))
    return round64(w), round64(h)


async def clayify(object_id: str) -> str:
    """
    Clayify an object by object_id. Returns base64-encoded clayified PNG.
    Updates the DB row on success.
    """
    obj = await db.get_object(object_id)
    if obj is None:
        raise ValueError(f"Object not found: {object_id}")

    subject_type = SubjectTypeEnum(obj["subject_type"])
    masked = Image.open(obj["masked_png_path"]).convert("RGBA")
    width, height = _target_size(masked)

    prompt = _build_prompt(subject_type, obj["tag"], obj.get("description"))
    neg = _NEGATIVE_PROP if subject_type == SubjectTypeEnum.prop else _NEGATIVE_PROMPT
    clayified = await _runware_img2img(masked, prompt, width, height, subject_type=subject_type.value, negative_prompt=neg)

    # Resize back to original dimensions if they differ
    if clayified.size != masked.size:
        clayified = clayified.resize(masked.size, Image.LANCZOS)

    # Preserve original alpha mask so the object stays cut out
    _, _, _, orig_alpha = masked.split()
    r, g, b, _ = clayified.split()
    clayified = Image.merge("RGBA", (r, g, b, orig_alpha))

    # Save to disk
    out_path = OBJECTS_DIR / f"{object_id}_clay.png"
    clayified.save(out_path, format="PNG")

    # Encode thumbnail for DB
    buf = io.BytesIO()
    thumb = clayified.copy()
    thumb.thumbnail((128, 128), Image.LANCZOS)
    thumb.save(buf, format="PNG")
    thumb_b64 = base64.b64encode(buf.getvalue()).decode()

    await db.update_object_clayified(object_id, str(out_path), thumb_b64)

    # Return full-size clayified image as base64
    buf = io.BytesIO()
    clayified.save(buf, format="PNG")
    return base64.b64encode(buf.getvalue()).decode()

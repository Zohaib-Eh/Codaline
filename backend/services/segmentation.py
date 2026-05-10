from __future__ import annotations

import base64
import io
import os
import uuid
from pathlib import Path

import anthropic
import numpy as np
from PIL import Image
from dotenv import load_dotenv

import db
import sam2_loader
from models import SegmentClickRequest, SegmentBoxRequest, SegmentResponse, SubjectTypeEnum

load_dotenv()
_claude = anthropic.AsyncAnthropic(api_key=os.getenv("ANTHROPIC_API_KEY", ""))
CLAUDE_MODEL = os.getenv("CLAUDE_MODEL", "claude-sonnet-4-6")

OBJECTS_DIR = Path("static/objects")
OBJECTS_DIR.mkdir(parents=True, exist_ok=True)

_PERSON_KEYWORDS = {"me", "self", "person", "human", "man", "woman", "boy", "girl", "guy", "lady"}


def _detect_subject_type(tag: str) -> SubjectTypeEnum:
    if tag.lower().strip() in _PERSON_KEYWORDS:
        return SubjectTypeEnum.person
    return SubjectTypeEnum.object


def _apply_mask(image: Image.Image, mask: np.ndarray) -> Image.Image:
    """Apply boolean mask, crop to bbox. Used for disk storage and thumbnails."""
    rgba = image.convert("RGBA")
    alpha = Image.fromarray((mask * 255).astype(np.uint8), mode="L")
    rgba.putalpha(alpha)
    bbox = rgba.getbbox()
    if bbox:
        rgba = rgba.crop(bbox)
    return rgba


def _full_size_mask(image: Image.Image, mask: np.ndarray) -> Image.Image:
    """Apply boolean mask at full image size (no crop). Used for canvas overlay."""
    rgba = image.convert("RGBA")
    alpha = Image.fromarray((mask * 255).astype(np.uint8), mode="L")
    rgba.putalpha(alpha)
    return rgba


def _make_thumbnail_b64(image: Image.Image, size: int = 128) -> str:
    thumb = image.copy()
    thumb.thumbnail((size, size), Image.LANCZOS)
    buf = io.BytesIO()
    thumb.save(buf, format="PNG")
    return base64.b64encode(buf.getvalue()).decode()


def _image_to_b64(image: Image.Image) -> str:
    buf = io.BytesIO()
    image.save(buf, format="PNG")
    return base64.b64encode(buf.getvalue()).decode()


async def _auto_describe(image: Image.Image) -> str | None:
    """Call Claude vision to auto-describe the segmented object in a few words."""
    try:
        thumb = image.copy()
        thumb.thumbnail((256, 256), Image.LANCZOS)
        buf = io.BytesIO()
        thumb.convert("RGBA").save(buf, format="PNG")
        b64 = base64.b64encode(buf.getvalue()).decode()

        msg = await _claude.messages.create(
            model=CLAUDE_MODEL,
            max_tokens=32,
            messages=[{
                "role": "user",
                "content": [
                    {
                        "type": "image",
                        "source": {"type": "base64", "media_type": "image/png", "data": b64},
                    },
                    {
                        "type": "text",
                        "text": (
                            "Describe this object in 5-8 words. Be specific about colour, material, and type. "
                            "Output only the description, nothing else. "
                            "Examples: 'blue Xbox game controller', 'red toy SUV off-road vehicle', 'white ceramic coffee mug', 'brown teddy bear plush toy'."
                        ),
                    },
                ],
            }],
        )
        return msg.content[0].text.strip().strip(".")
    except Exception as e:
        print(f"[SEGMENT] auto-describe failed: {e}")
        return None


async def _load_source_image(image_id: str) -> Image.Image:
    record = await db.get_image(image_id)
    if record is None:
        raise ValueError(f"Image not found: {image_id}")
    from PIL import ImageOps
    img = Image.open(record["path"])
    return ImageOps.exif_transpose(img)  # match the orientation the browser shows


async def _save_and_store(
    masked: Image.Image,
    image_id: str,
    tag: str,
    subject_type: SubjectTypeEnum,
) -> tuple[str, str, str]:
    """Save masked PNG to disk, insert DB row. Returns (object_id, path, thumbnail_b64)."""
    object_id = str(uuid.uuid4())
    path = OBJECTS_DIR / f"{object_id}.png"
    masked.save(path, format="PNG")

    thumbnail_b64 = _make_thumbnail_b64(masked)
    description = await _auto_describe(masked)
    print(f"[SEGMENT] auto-described '{tag}' as: {description}")

    await db.insert_object(
        object_id=object_id,
        image_id=image_id,
        tag=tag,
        masked_png_path=str(path),
        thumbnail_b64=thumbnail_b64,
        subject_type=subject_type.value,
        description=description,
    )
    return object_id, str(path), thumbnail_b64


async def segment_from_click(req: SegmentClickRequest) -> SegmentResponse:
    image = await _load_source_image(req.image_id)
    mask = await sam2_loader.predict_from_click_async(image, req.x, req.y)

    cropped  = _apply_mask(image, mask)       # bbox-cropped — stored on disk + thumbnail
    full     = _full_size_mask(image, mask)   # full-size — sent to frontend for canvas overlay

    subject_type = req.subject_type or _detect_subject_type(req.tag)
    object_id, _, thumbnail_b64 = await _save_and_store(cropped, req.image_id, req.tag, subject_type)

    return SegmentResponse(
        object_id=object_id,
        masked_png_b64=_image_to_b64(full),
        thumbnail_b64=thumbnail_b64,
        subject_type=subject_type,
    )


async def segment_from_box(req: SegmentBoxRequest) -> SegmentResponse:
    image = await _load_source_image(req.image_id)
    mask = await sam2_loader.predict_from_box_async(image, req.x1, req.y1, req.x2, req.y2)

    cropped  = _apply_mask(image, mask)
    full     = _full_size_mask(image, mask)

    subject_type = req.subject_type or _detect_subject_type(req.tag)
    object_id, _, thumbnail_b64 = await _save_and_store(cropped, req.image_id, req.tag, subject_type)

    return SegmentResponse(
        object_id=object_id,
        masked_png_b64=_image_to_b64(full),
        thumbnail_b64=thumbnail_b64,
        subject_type=subject_type,
    )

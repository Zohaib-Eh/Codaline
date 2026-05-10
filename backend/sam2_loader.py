from __future__ import annotations

import asyncio
import os
from threading import Lock

import numpy as np
import torch
from PIL import Image
from dotenv import load_dotenv

from sam2.build_sam import build_sam2
from sam2.sam2_image_predictor import SAM2ImagePredictor

load_dotenv()

SAM2_CHECKPOINT = os.getenv("SAM2_CHECKPOINT", "./checkpoints/sam2_hiera_small.pt")
SAM2_CONFIG = os.getenv("SAM2_CONFIG", "sam2_hiera_s.yaml")

_predictor: SAM2ImagePredictor | None = None
_lock = Lock()  # SAM2 predictor is not thread-safe across set_image calls


def load_model() -> None:
    global _predictor
    device = "cuda" if torch.cuda.is_available() else "cpu"
    model = build_sam2(SAM2_CONFIG, SAM2_CHECKPOINT, device=device)
    _predictor = SAM2ImagePredictor(model)
    print(f"SAM2 loaded on {device}")


def _get_predictor() -> SAM2ImagePredictor:
    if _predictor is None:
        raise RuntimeError("SAM2 model not loaded — call load_model() on startup")
    return _predictor


def _best_mask(masks: np.ndarray, scores: np.ndarray) -> np.ndarray:
    total_pixels = masks.shape[1] * masks.shape[2]
    areas = masks.sum(axis=(1, 2))

    print(f"[SAM2] scores={[round(float(s),3) for s in scores]}  "
          f"areas={[int(a) for a in areas]}  total={total_pixels}")

    # Avoid selecting the background/floor (very large mask covering >60% of image).
    # Among masks that are not background-sized, prefer the highest score.
    # Fall back to highest score overall if all masks are large.
    non_bg = [i for i, a in enumerate(areas) if a < 0.6 * total_pixels]
    if non_bg:
        best = max(non_bg, key=lambda i: scores[i])
    else:
        best = int(np.argmax(scores))

    print(f"[SAM2] selected mask {best}, area {int(areas[best])} "
          f"({100*areas[best]/total_pixels:.1f}% of image)")
    return masks[best].astype(bool)


def _pil_to_rgb_array(image: Image.Image) -> np.ndarray:
    return np.array(image.convert("RGB"))


def predict_from_click(image: Image.Image, x: float, y: float) -> np.ndarray:
    """Return a boolean mask (H×W) for the object at pixel (x, y)."""
    print(f"[SAM2] click ({x:.1f}, {y:.1f}) on {image.width}×{image.height} image")
    predictor = _get_predictor()
    with _lock:
        predictor.set_image(_pil_to_rgb_array(image))
        masks, scores, _ = predictor.predict(
            point_coords=np.array([[x, y]], dtype=np.float32),
            point_labels=np.array([1]),  # 1 = foreground
            multimask_output=True,
        )
    return _best_mask(masks, scores)


def predict_from_box(
    image: Image.Image, x1: float, y1: float, x2: float, y2: float
) -> np.ndarray:
    """Return a boolean mask (H×W) for the object inside the bounding box."""
    predictor = _get_predictor()
    with _lock:
        predictor.set_image(_pil_to_rgb_array(image))
        masks, scores, _ = predictor.predict(
            box=np.array([x1, y1, x2, y2], dtype=np.float32),
            multimask_output=False,
        )
    return _best_mask(masks, scores)


# Async wrappers — run blocking SAM2 inference in a thread pool so the
# FastAPI event loop is never blocked.

async def predict_from_click_async(
    image: Image.Image, x: float, y: float
) -> np.ndarray:
    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(None, predict_from_click, image, x, y)


async def predict_from_box_async(
    image: Image.Image, x1: float, y1: float, x2: float, y2: float
) -> np.ndarray:
    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(None, predict_from_box, image, x1, y1, x2, y2)

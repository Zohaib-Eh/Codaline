from __future__ import annotations

import io
from pathlib import Path

import numpy as np
from PIL import Image

from models import CastPlacement

COMPOSITES_DIR = Path("static/composites")
COMPOSITES_DIR.mkdir(parents=True, exist_ok=True)


def _gradient_mask(size: tuple[int, int], fade_start: float, fade_end: float) -> Image.Image:
    """
    Linear alpha mask (L mode). Fully transparent above fade_start (normalised y),
    fully opaque below fade_end, linear ramp in between.
    """
    w, h = size
    alpha = np.zeros((h, w), dtype=np.uint8)
    start_px = int(fade_start * h)
    end_px = int(fade_end * h)
    if end_px > start_px:
        ramp = np.linspace(0, 255, end_px - start_px, dtype=np.uint8)
        alpha[start_px:end_px, :] = ramp[:, None]
    alpha[end_px:, :] = 255
    return Image.fromarray(alpha, mode="L")


def _stack_background(sky_path: str, mid_path: str, fore_path: str) -> Image.Image:
    """Composite background layers. If all paths are the same, skip blending."""
    sky = Image.open(sky_path).convert("RGB")
    if sky_path == mid_path == fore_path:
        return sky

    mid = Image.open(mid_path).convert("RGBA")
    fore = Image.open(fore_path).convert("RGBA")
    size = sky.size

    mid_mask = _gradient_mask(size, fade_start=0.20, fade_end=0.45)
    mid.putalpha(mid_mask)
    fore_mask = _gradient_mask(size, fade_start=0.50, fade_end=0.70)
    fore.putalpha(fore_mask)

    canvas = sky.convert("RGBA")
    canvas.alpha_composite(mid)
    canvas.alpha_composite(fore)
    return canvas.convert("RGB")


def _place_cast(
    canvas: Image.Image,
    placements: list[CastPlacement],
    cast_paths: dict[str, str],  # tag → clayified_png_path (or masked fallback)
) -> Image.Image:
    """Paste cast members onto the canvas in z_index order."""
    result = canvas.convert("RGBA")
    bg_w, bg_h = result.size

    for placement in sorted(placements, key=lambda p: p.z_index):
        png_path = cast_paths.get(placement.tag)
        if not png_path or not Path(png_path).exists():
            continue

        char = Image.open(png_path).convert("RGBA")

        # Scale: character height = scale * bg_h
        target_h = max(1, int(placement.scale * bg_h))
        aspect = char.width / char.height
        target_w = max(1, int(target_h * aspect))
        char = char.resize((target_w, target_h), Image.LANCZOS)

        # Position: (x, y) is the horizontal centre / vertical base (feet)
        paste_x = int(placement.x * bg_w) - target_w // 2
        paste_y = int(placement.y * bg_h) - target_h

        result.alpha_composite(char, dest=(paste_x, paste_y))

    return result.convert("RGB")


def composite_scene(
    scene_id: str,
    sky_path: str,
    mid_path: str,
    fore_path: str,
    placements: list[CastPlacement],
    cast_paths: dict[str, str],
) -> str:
    """
    Stack background layers and place cast members.
    Returns the path of the saved composite PNG.
    """
    background = _stack_background(sky_path, mid_path, fore_path)
    final = _place_cast(background, placements, cast_paths)

    out_path = COMPOSITES_DIR / f"{scene_id}_composite.png"
    final.save(out_path, format="PNG")
    return str(out_path)

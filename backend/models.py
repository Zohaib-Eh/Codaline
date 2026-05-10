from __future__ import annotations

from enum import Enum
from typing import Optional
from pydantic import BaseModel, Field


# ---------------------------------------------------------------------------
# Enums
# ---------------------------------------------------------------------------

class ToneEnum(str, Enum):
    warm = "warm"
    dark = "dark"
    whimsical = "whimsical"
    dramatic = "dramatic"


class StageEnum(str, Enum):
    briefing = "briefing"
    backgrounds = "backgrounds"
    compositing = "compositing"
    animating = "animating"
    scoring = "scoring"
    audio = "audio"
    merging = "merging"
    complete = "complete"
    failed = "failed"


class SubjectTypeEnum(str, Enum):
    person    = "person"     # human actor
    character = "character"  # non-human actor (teddy, toy)
    object    = "object"     # legacy alias for character — kept for DB compatibility
    prop      = "prop"       # inanimate prop — appears in setting, doesn't act


class SceneStatusEnum(str, Enum):
    pending = "pending"
    processing = "processing"
    complete = "complete"
    failed = "failed"


# ---------------------------------------------------------------------------
# Upload
# ---------------------------------------------------------------------------

class UploadResponse(BaseModel):
    image_id: str


# ---------------------------------------------------------------------------
# Segmentation requests
# ---------------------------------------------------------------------------

class SegmentClickRequest(BaseModel):
    image_id: str
    x: float
    y: float
    tag: str
    subject_type: Optional[SubjectTypeEnum] = None  # user override


class SegmentBoxRequest(BaseModel):
    image_id: str
    x1: float
    y1: float
    x2: float
    y2: float
    tag: str
    subject_type: Optional[SubjectTypeEnum] = None


class SegmentResponse(BaseModel):
    object_id: str
    masked_png_b64: str
    thumbnail_b64: str
    subject_type: SubjectTypeEnum


# ---------------------------------------------------------------------------
# Objects
# ---------------------------------------------------------------------------

class ObjectResponse(BaseModel):
    id: str
    tag: str
    description: Optional[str] = None
    thumbnail_b64: Optional[str] = None
    subject_type: SubjectTypeEnum
    is_clayified: bool
    is_demo: bool


class ClayifyResponse(BaseModel):
    object_id: str
    clayified_png_b64: str


# ---------------------------------------------------------------------------
# Cast + story
# ---------------------------------------------------------------------------

class CastMember(BaseModel):
    id: str
    tag: str
    description: Optional[str] = None
    subject_type: SubjectTypeEnum
    masked_png_path: str
    clayified_png_path: Optional[str] = None


class GenerateRequest(BaseModel):
    story_prompt: str
    tone: ToneEnum
    object_ids: list[str] = Field(min_length=1)


# ---------------------------------------------------------------------------
# Compositor
# ---------------------------------------------------------------------------

class CastPlacement(BaseModel):
    tag: str
    x: float = 0.5        # normalised 0-1, horizontal centre of character
    y: float = 0.75       # normalised 0-1, vertical base (feet) of character
    scale: float = 0.35   # character height as fraction of background height
    z_index: int = 0      # higher = rendered in front


# ---------------------------------------------------------------------------
# Film brief (Claude → pipeline)
# ---------------------------------------------------------------------------

class SceneSpec(BaseModel):
    scene_number: int
    setting: str
    cast: list[str]          # tags e.g. ["bear", "cup"]
    motion_prompt: str
    scene_context: str = ""  # story state entering this scene
    mood: str
    duration: int            # seconds


class FilmBrief(BaseModel):
    title: str
    total_duration: int      # seconds
    scenes: list[SceneSpec] = Field(min_length=1)


# ---------------------------------------------------------------------------
# Scene (DB row + status)
# ---------------------------------------------------------------------------

class SceneProgress(BaseModel):
    scene_number: int
    status: SceneStatusEnum
    setting: Optional[str] = None
    video_url: Optional[str] = None


# ---------------------------------------------------------------------------
# Project status
# ---------------------------------------------------------------------------

class GenerateResponse(BaseModel):
    project_id: str


class ProjectStatusResponse(BaseModel):
    project_id: str
    status: StageEnum
    current_stage: Optional[StageEnum] = None
    scene_progress: list[SceneProgress] = []
    final_video_url: Optional[str] = None
    error: Optional[str] = None

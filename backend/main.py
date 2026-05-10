from __future__ import annotations

import asyncio
import uuid
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import BackgroundTasks, FastAPI, HTTPException, UploadFile
from typing import Optional
from pydantic import BaseModel
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

import db
import sam2_loader
from models import (
    CastMember,
    ClayifyResponse,
    GenerateRequest,
    GenerateResponse,
    ObjectResponse,
    ProjectStatusResponse,
    SceneProgress,
    SceneStatusEnum,
    SegmentBoxRequest,
    SegmentClickRequest,
    SegmentResponse,
    StageEnum,
    SubjectTypeEnum,
    ToneEnum,
    UploadResponse,
)
from services.background import generate_layers
from services.clayify import clayify
from services.compositor import composite_scene
from services.director import generate_film_brief
from services.elevenlabs import generate_narration, generate_score, merge_narration_and_score
from services.merger import merge_film
from services.runware import generate_video
from services.scorer import generate_film_score
from services.segmentation import segment_from_box, segment_from_click

UPLOADS_DIR = Path("static/uploads")
UPLOADS_DIR.mkdir(parents=True, exist_ok=True)


# ---------------------------------------------------------------------------
# Startup / shutdown
# ---------------------------------------------------------------------------

@asynccontextmanager
async def lifespan(app: FastAPI):
    await db.init_db()
    sam2_loader.load_model()
    yield


app = FastAPI(title="Codaline", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.mount("/static", StaticFiles(directory="static"), name="static")


# ---------------------------------------------------------------------------
# Cast building
# ---------------------------------------------------------------------------

@app.post("/upload", response_model=UploadResponse)
async def upload_image(file: UploadFile):
    image_id = str(uuid.uuid4())
    ext = Path(file.filename).suffix or ".jpg"
    path = UPLOADS_DIR / f"{image_id}{ext}"
    path.write_bytes(await file.read())
    await db.insert_image(image_id, str(path))
    return UploadResponse(image_id=image_id)


@app.post("/segment/click", response_model=SegmentResponse)
async def segment_click(req: SegmentClickRequest):
    try:
        return await segment_from_click(req)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


@app.post("/segment/box", response_model=SegmentResponse)
async def segment_box(req: SegmentBoxRequest):
    try:
        return await segment_from_box(req)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


@app.post("/clayify/{object_id}", response_model=ClayifyResponse)
async def clayify_object(object_id: str):
    obj = await db.get_object(object_id)
    if obj is None:
        raise HTTPException(status_code=404, detail="Object not found")
    try:
        clayified_b64 = await clayify(object_id)
        return ClayifyResponse(object_id=object_id, clayified_png_b64=clayified_b64)
    except Exception as e:
        print(f"[CLAYIFY] error for {object_id}: {e}")
        raise HTTPException(status_code=500, detail=str(e))


class UpdateObjectRequest(BaseModel):
    tag: str
    subject_type: SubjectTypeEnum
    description: Optional[str] = None


@app.patch("/objects/{object_id}")
async def update_object(object_id: str, req: UpdateObjectRequest):
    obj = await db.get_object(object_id)
    if obj is None:
        raise HTTPException(status_code=404, detail="Object not found")
    await db.update_object_tag(object_id, req.tag, req.subject_type.value, req.description)
    return {"ok": True}


@app.delete("/objects/{object_id}")
async def delete_object(object_id: str):
    obj = await db.get_object(object_id)
    if obj is None:
        raise HTTPException(status_code=404, detail="Object not found")
    await db.delete_object(object_id)
    return {"ok": True}


@app.get("/objects", response_model=list[ObjectResponse])
async def list_objects():
    rows = await db.get_all_objects()
    return [
        ObjectResponse(
            id=r["id"],
            tag=r["tag"],
            description=r.get("description"),
            thumbnail_b64=r["thumbnail_b64"],
            subject_type=SubjectTypeEnum(r["subject_type"]),
            is_clayified=bool(r["is_clayified"]),
            is_demo=bool(r["is_demo"]),
        )
        for r in rows
    ]


# ---------------------------------------------------------------------------
# Film generation
# ---------------------------------------------------------------------------

@app.post("/generate", response_model=GenerateResponse)
async def generate(req: GenerateRequest, background_tasks: BackgroundTasks):
    project_id = str(uuid.uuid4())
    await db.insert_project(project_id, req.story_prompt, req.tone.value, StageEnum.briefing.value)
    background_tasks.add_task(_run_pipeline, project_id, req)
    return GenerateResponse(project_id=project_id)


@app.get("/status/{project_id}", response_model=ProjectStatusResponse)
async def get_status(project_id: str):
    project = await db.get_project(project_id)
    if project is None:
        raise HTTPException(status_code=404, detail="Project not found")

    scenes = await db.get_scenes_for_project(project_id)
    scene_progress = [
        SceneProgress(
            scene_number=s["scene_number"],
            status=SceneStatusEnum(s["status"]),
            setting=s["setting"],
            video_url=s["video_url"],
        )
        for s in scenes
    ]

    return ProjectStatusResponse(
        project_id=project_id,
        status=StageEnum(project["status"]),
        current_stage=StageEnum(project["current_stage"]) if project["current_stage"] else None,
        scene_progress=scene_progress,
        final_video_url=project["final_video_url"],
        error=project["error"],
    )


# ---------------------------------------------------------------------------
# Pipeline
# ---------------------------------------------------------------------------

async def _run_pipeline(project_id: str, req: GenerateRequest) -> None:
    try:
        await _pipeline(project_id, req)
    except Exception as e:
        await db.update_project(project_id, status=StageEnum.failed.value, error=str(e))


async def _pipeline(project_id: str, req: GenerateRequest) -> None:
    print(f"\n[PIPELINE] starting project {project_id}")

    rows = await db.get_objects_by_ids(req.object_ids)
    if not rows:
        raise ValueError("No valid objects found for the given object_ids")

    cast = [
        CastMember(
            id=r["id"],
            tag=r["tag"],
            description=r.get("description"),
            subject_type=SubjectTypeEnum(r["subject_type"]),
            masked_png_path=r["masked_png_path"],
            clayified_png_path=r["clayified_png_path"],
        )
        for r in rows
    ]
    print(f"[PIPELINE] cast: {[m.tag for m in cast]}")

    # Auto-clayify characters/persons only — props use their original masked PNG as-is
    for member in cast:
        if member.subject_type == SubjectTypeEnum.prop:
            continue
        if not member.clayified_png_path:
            print(f"[PIPELINE] auto-clayifying '{member.tag}'")
            try:
                await clayify(member.id)
                row = await db.get_object(member.id)
                if row and row["clayified_png_path"]:
                    member.clayified_png_path = row["clayified_png_path"]
            except Exception as e:
                print(f"[PIPELINE] clayify failed for '{member.tag}': {e}")

    # 1. BRIEFING
    print("[PIPELINE] stage: briefing")
    await db.update_project(project_id, status=StageEnum.briefing.value, current_stage=StageEnum.briefing.value)
    brief, placements_by_scene = await generate_film_brief(
        project_id, req.story_prompt, req.tone, cast
    )
    print(f"[PIPELINE] brief ready: '{brief.title}', {len(brief.scenes)} scenes, {brief.total_duration}s total")

    cast_by_tag = {m.tag: m for m in cast}
    scene_ids: dict[int, str] = {}
    for scene_spec in brief.scenes:
        scene_id = str(uuid.uuid4())
        scene_ids[scene_spec.scene_number] = scene_id
        await db.insert_scene(
            scene_id, project_id, scene_spec.scene_number,
            scene_spec.setting, scene_spec.motion_prompt,
            scene_spec.mood, scene_spec.duration,
        )

    # 2. SCENES (backgrounds + composite + animate) in parallel
    print("[PIPELINE] stage: scenes (parallel)")
    await db.update_project(project_id, status=StageEnum.backgrounds.value, current_stage=StageEnum.backgrounds.value)

    scene_video_urls: list[str | None] = [None] * len(brief.scenes)

    async def _process_scene(idx: int, scene_spec):
        scene_id = scene_ids[scene_spec.scene_number]
        sn = scene_spec.scene_number
        try:
            await db.update_scene(scene_id, status=SceneStatusEnum.processing.value)

            print(f"[SCENE {sn}] generating backgrounds — {scene_spec.setting}")
            layers = await generate_layers(
                scene_spec.setting, req.tone, scene_prefix=scene_id
            )
            await db.update_scene(
                scene_id,
                background_sky_path=layers["sky"],
                background_mid_path=layers["midground"],
                background_fore_path=layers["foreground"],
            )
            print(f"[SCENE {sn}] backgrounds done")

            scene_placements = placements_by_scene.get(scene_spec.scene_number, [])
            cast_paths = {
                tag: (cast_by_tag[tag].clayified_png_path or cast_by_tag[tag].masked_png_path)
                for tag in scene_spec.cast
                if tag in cast_by_tag
            }
            # Composite clayified cast onto background — Kling sees the clay character
            # in position and animates what's already there. referenceImages still passed
            # to reinforce appearance consistency across scenes.
            print(f"[SCENE {sn}] compositing — cast: {list(cast_paths.keys())}")
            composite_path = composite_scene(
                scene_id=scene_id,
                sky_path=layers["sky"],
                mid_path=layers["midground"],
                fore_path=layers["foreground"],
                placements=scene_placements,
                cast_paths=cast_paths,
            )
            await db.update_scene(scene_id, composite_path=composite_path)
            print(f"[SCENE {sn}] composite saved: {composite_path}")

            # Build cast glossary — tells Kling exactly what each object looks like
            # so its text understanding matches the visual reference sheet.
            glossary_parts = [
                f"@{tag} is {cast_by_tag[tag].description}"
                for tag in scene_spec.cast
                if tag in cast_by_tag and cast_by_tag[tag].description
            ]
            glossary = " | ".join(glossary_parts)

            base_prompt = (
                f"{scene_spec.scene_context}. {scene_spec.motion_prompt}"
                if scene_spec.scene_context else scene_spec.motion_prompt
            )
            full_motion_prompt = f"{base_prompt}. Cast: {glossary}" if glossary else base_prompt
            print(f"[SCENE {sn}] animating — {full_motion_prompt}")
            await db.update_project(project_id, current_stage=StageEnum.animating.value)
            video_url = await generate_video(
                composite_path=composite_path,
                motion_prompt=full_motion_prompt,
                tone=req.tone,
                duration=scene_spec.duration,
                scene_id=scene_id,
                cast_image_paths=list(cast_paths.values()),
            )
            await db.update_scene(scene_id, video_url=video_url, status=SceneStatusEnum.complete.value)
            scene_video_urls[idx] = video_url
            print(f"[SCENE {sn}] complete — {video_url}")

        except Exception as e:
            print(f"[SCENE {sn}] FAILED: {e}")
            await db.update_scene(scene_id, status=SceneStatusEnum.failed.value)
            raise

    try:
        await asyncio.gather(*(_process_scene(i, s) for i, s in enumerate(brief.scenes)))
    except Exception as e:
        print(f"[PIPELINE] scene gather failed: {e}")
        if scene_video_urls[0] is None:
            raise
        print("[PIPELINE] falling back to scene 1 only")
        scene_video_urls = [scene_video_urls[0]]

    valid_urls = [u for u in scene_video_urls if u]
    if not valid_urls:
        raise ValueError("All scenes failed to generate")
    print(f"[PIPELINE] {len(valid_urls)} scene(s) ready")

    # 3. SCORING
    print("[PIPELINE] stage: scoring")
    await db.update_project(project_id, status=StageEnum.scoring.value, current_stage=StageEnum.scoring.value)
    film_score = await generate_film_score(brief, req.tone)
    print("[PIPELINE] score written")

    # 4. AUDIO
    print("[PIPELINE] stage: audio")
    await db.update_project(project_id, status=StageEnum.audio.value, current_stage=StageEnum.audio.value)
    try:
        clip_durations = [5 if s.duration < 30 else 10 for s in brief.scenes]
        narration_path = await generate_narration(film_score.narration_script, clip_durations) if film_score.narration_script.strip() else None
        print(f"[PIPELINE] narration: {narration_path}")
        score_path = await generate_score(film_score.sound_transcript, brief.total_duration) if film_score.sound_transcript.strip() else None
        print(f"[PIPELINE] score audio: {score_path}")
        if narration_path and score_path:
            audio_path = merge_narration_and_score(narration_path, score_path, brief.total_duration)
        elif narration_path:
            audio_path = narration_path
        else:
            audio_path = score_path
        print(f"[PIPELINE] merged audio: {audio_path}")
    except Exception as e:
        print(f"[PIPELINE] audio failed (continuing silently): {e}")
        audio_path = None

    # 5. MERGING
    print("[PIPELINE] stage: merging")
    await db.update_project(project_id, status=StageEnum.merging.value, current_stage=StageEnum.merging.value)
    final_path = await merge_film(valid_urls, audio_path, project_id)

    final_video_url = f"/static/outputs/{Path(final_path).name}"
    await db.update_project(
        project_id,
        status=StageEnum.complete.value,
        current_stage=StageEnum.complete.value,
        final_video_url=final_video_url,
    )
    print(f"[PIPELINE] COMPLETE — {final_video_url}")

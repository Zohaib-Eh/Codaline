from __future__ import annotations

import os
import aiosqlite
from dotenv import load_dotenv

load_dotenv()

DATABASE_URL = os.getenv("DATABASE_URL", "./codaline.db")


def _connect():
    return aiosqlite.connect(DATABASE_URL, timeout=30)

_CREATE_TABLES = """
CREATE TABLE IF NOT EXISTS images (
    id TEXT PRIMARY KEY,
    path TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS objects (
    id TEXT PRIMARY KEY,
    image_id TEXT,
    tag TEXT NOT NULL,
    description TEXT,
    masked_png_path TEXT NOT NULL,
    clayified_png_path TEXT,
    thumbnail_b64 TEXT,
    subject_type TEXT DEFAULT 'object',
    is_clayified BOOLEAN DEFAULT FALSE,
    is_demo BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    story_prompt TEXT NOT NULL,
    tone TEXT NOT NULL,
    film_brief_json TEXT,
    status TEXT NOT NULL,
    current_stage TEXT,
    final_video_url TEXT,
    error TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS scenes (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    scene_number INTEGER NOT NULL,
    setting TEXT,
    motion_prompt TEXT,
    mood TEXT,
    duration INTEGER,
    background_sky_path TEXT,
    background_mid_path TEXT,
    background_fore_path TEXT,
    composite_path TEXT,
    video_url TEXT,
    status TEXT DEFAULT 'pending',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
"""


async def init_db() -> None:
    async with _connect() as db:
        await db.execute("PRAGMA journal_mode=WAL")
        await db.executescript(_CREATE_TABLES)
        # Migrate: add description column if missing (safe on existing DBs)
        try:
            await db.execute("ALTER TABLE objects ADD COLUMN description TEXT")
            await db.commit()
        except Exception:
            pass  # column already exists
        await db.commit()


# ---------------------------------------------------------------------------
# Images
# ---------------------------------------------------------------------------

async def insert_image(image_id: str, path: str) -> None:
    async with _connect() as db:
        await db.execute(
            "INSERT INTO images (id, path) VALUES (?, ?)",
            (image_id, path),
        )
        await db.commit()


async def get_image(image_id: str) -> dict | None:
    async with _connect() as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(
            "SELECT * FROM images WHERE id = ?", (image_id,)
        ) as cursor:
            row = await cursor.fetchone()
            return dict(row) if row else None


# ---------------------------------------------------------------------------
# Objects
# ---------------------------------------------------------------------------

async def insert_object(
    object_id: str,
    image_id: str | None,
    tag: str,
    masked_png_path: str,
    thumbnail_b64: str | None,
    subject_type: str,
    is_demo: bool = False,
    description: str | None = None,
) -> None:
    async with _connect() as db:
        await db.execute(
            """INSERT INTO objects
               (id, image_id, tag, description, masked_png_path, thumbnail_b64, subject_type, is_demo)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
            (object_id, image_id, tag, description, masked_png_path, thumbnail_b64, subject_type, is_demo),
        )
        await db.commit()


async def get_object(object_id: str) -> dict | None:
    async with _connect() as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(
            "SELECT * FROM objects WHERE id = ?", (object_id,)
        ) as cursor:
            row = await cursor.fetchone()
            return dict(row) if row else None


async def get_objects_by_ids(object_ids: list[str]) -> list[dict]:
    placeholders = ",".join("?" * len(object_ids))
    async with _connect() as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(
            f"SELECT * FROM objects WHERE id IN ({placeholders})", object_ids
        ) as cursor:
            rows = await cursor.fetchall()
            return [dict(r) for r in rows]


async def get_all_objects() -> list[dict]:
    async with _connect() as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(
            "SELECT * FROM objects ORDER BY created_at DESC"
        ) as cursor:
            rows = await cursor.fetchall()
            return [dict(r) for r in rows]


async def update_object_tag(object_id: str, tag: str, subject_type: str, description: str | None = None) -> None:
    async with _connect() as db:
        await db.execute(
            "UPDATE objects SET tag = ?, subject_type = ?, description = ? WHERE id = ?",
            (tag, subject_type, description, object_id),
        )
        await db.commit()


async def delete_object(object_id: str) -> None:
    async with _connect() as db:
        await db.execute("DELETE FROM objects WHERE id = ?", (object_id,))
        await db.commit()


async def update_object_clayified(
    object_id: str, clayified_png_path: str, thumbnail_b64: str | None = None
) -> None:
    async with _connect() as db:
        await db.execute(
            """UPDATE objects
               SET is_clayified = TRUE, clayified_png_path = ?, thumbnail_b64 = COALESCE(?, thumbnail_b64)
               WHERE id = ?""",
            (clayified_png_path, thumbnail_b64, object_id),
        )
        await db.commit()


# ---------------------------------------------------------------------------
# Projects
# ---------------------------------------------------------------------------

async def insert_project(
    project_id: str, story_prompt: str, tone: str, status: str
) -> None:
    async with _connect() as db:
        await db.execute(
            """INSERT INTO projects (id, story_prompt, tone, status)
               VALUES (?, ?, ?, ?)""",
            (project_id, story_prompt, tone, status),
        )
        await db.commit()


async def get_project(project_id: str) -> dict | None:
    async with _connect() as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(
            "SELECT * FROM projects WHERE id = ?", (project_id,)
        ) as cursor:
            row = await cursor.fetchone()
            return dict(row) if row else None


async def update_project(project_id: str, **fields) -> None:
    if not fields:
        return
    set_clause = ", ".join(f"{k} = ?" for k in fields)
    values = list(fields.values()) + [project_id]
    async with _connect() as db:
        await db.execute(
            f"UPDATE projects SET {set_clause}, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
            values,
        )
        await db.commit()


# ---------------------------------------------------------------------------
# Scenes
# ---------------------------------------------------------------------------

async def insert_scene(
    scene_id: str,
    project_id: str,
    scene_number: int,
    setting: str,
    motion_prompt: str,
    mood: str,
    duration: int,
) -> None:
    async with _connect() as db:
        await db.execute(
            """INSERT INTO scenes
               (id, project_id, scene_number, setting, motion_prompt, mood, duration)
               VALUES (?, ?, ?, ?, ?, ?, ?)""",
            (scene_id, project_id, scene_number, setting, motion_prompt, mood, duration),
        )
        await db.commit()


async def get_scenes_for_project(project_id: str) -> list[dict]:
    async with _connect() as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(
            "SELECT * FROM scenes WHERE project_id = ? ORDER BY scene_number",
            (project_id,),
        ) as cursor:
            rows = await cursor.fetchall()
            return [dict(r) for r in rows]


async def update_scene(scene_id: str, **fields) -> None:
    if not fields:
        return
    set_clause = ", ".join(f"{k} = ?" for k in fields)
    values = list(fields.values()) + [scene_id]
    async with _connect() as db:
        await db.execute(
            f"UPDATE scenes SET {set_clause} WHERE id = ?", values
        )
        await db.commit()

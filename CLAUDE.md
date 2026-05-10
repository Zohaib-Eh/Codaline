# Codaline

## What it is
One-click claymation film studio. User extracts objects from photos (the cast),
types a story prompt referencing their objects, picks a tone — and gets back
a short claymation film with layered backgrounds, animated scenes, and a
scored soundtrack. Inspired by the stop motion tradition of Coraline and
Wallace & Gromit.

The user is the author. Claude is the director. The objects are the cast.

## Stack
- FastAPI, Python 3.11
- SAM2 (sam2-hiera-small) running locally on RTX 4070
- PIL for compositing
- httpx for async external API calls
- SQLite via aiosqlite for storage
- Runware for background generation (text2img) + animation (img2video)
- Claude API for story → film brief + scene transcript for audio
- ElevenLabs for full film score + sound design
- FFmpeg for scene stitching + crossfade transitions

## The full user flow

```
1. Upload photos → click to extract objects (cast members)
   - Each object gets a name/tag e.g. @bear, @cup, @me
   - Objects shown as chips in the UI

2. Type story prompt referencing cast:
   "@bear tries to find @cup before the sun sets"

3. Pick tone: warm / dark / whimsical / dramatic

4. Hit "Make Film"

5. Claude reads story + cast → writes film brief (JSON):
   - 3-5 scenes
   - Each scene: cast members present, setting, mood, motion prompt, duration

6. For each scene (in parallel):
   a. Runware text2img → 3 background layers (sky, midground, foreground)
   b. Clayify each cast member (if not already done)
   c. Compositor places clayified objects on layered background
   d. Runware img2video → animates scene with motion prompt
      (stop motion params: 8-12fps, frame hold, intentional jank)

7. Claude analyses all scenes → writes full film sound transcript
   (what sounds/music should happen across the whole film)

8. ElevenLabs → generates full film score + sound design from transcript

9. FFmpeg → stitches scenes with crossfade transitions + audio

10. User gets final mp4
```

## Architecture

### Module map
```
codaline/
├── main.py
├── db.py
├── models.py
├── sam2_loader.py
├── services/
│   ├── segmentation.py
│   ├── clayify.py
│   ├── background.py
│   ├── compositor.py
│   ├── director.py         ← Claude writes film brief from story + cast
│   ├── runware.py
│   ├── scorer.py           ← Claude writes sound transcript for whole film
│   ├── elevenlabs.py
│   └── merger.py
├── static/
│   ├── demo_objects/       ← pre-extracted clayified objects for demo
│   └── outputs/            ← final films
├── .env
└── CLAUDE.md
```

### Request flow

```
--- CAST BUILDING ---

POST /upload
  ← image file
  → image_id, stored in SQLite

POST /segment/click
  ← image_id, x, y, tag (e.g. "bear")
  → object_id, masked PNG base64, subject_type
  → saved to SQLite objects table

POST /segment/box
  ← image_id, x1, y1, x2, y2, tag
  → object_id, masked PNG base64
  → saved to SQLite objects table

POST /clayify/{object_id}
  → triggers clayification for one object
  → returns clayified PNG base64
  → updates SQLite

GET /objects
  → all saved objects (id, tag, thumbnail, subject_type, is_clayified)

--- FILM GENERATION ---

POST /generate
  ← story_prompt, tone, object_ids[]
  → project_id immediately, generation begins in background

  Background pipeline:
    1. BRIEFING     → director.py: Claude writes film brief JSON from story + cast
    2. For each scene (in parallel):
       BACKGROUNDS  → background.py: Runware generates sky/mid/fore layers
       COMPOSITING  → compositor.py: stacks layers + places cast members
       ANIMATING    → runware.py: img2video with scene motion prompt
    3. SCORING      → scorer.py: Claude writes full film sound transcript
    4. AUDIO        → elevenlabs.py: generates full film score from transcript
    5. MERGING      → merger.py: FFmpeg stitches scenes + crossfades + audio
    6. COMPLETE     → project updated in SQLite

GET /status/{project_id}
  → status, current_stage, scene_progress[], final_video_url
```

### Film brief JSON (Claude → pipeline)
```json
{
  "title": "The Search",
  "total_duration": 90,
  "scenes": [
    {
      "scene_number": 1,
      "setting": "a quiet sunny meadow at dawn",
      "cast": ["bear"],
      "motion_prompt": "bear sits alone looking around slowly",
      "mood": "lonely, warm",
      "duration": 20
    },
    {
      "scene_number": 2,
      "setting": "a winding forest path",
      "cast": ["bear"],
      "motion_prompt": "bear walks forward searching, looks left and right",
      "mood": "hopeful, adventurous",
      "duration": 30
    },
    {
      "scene_number": 3,
      "setting": "a cosy kitchen at golden hour",
      "cast": ["bear", "cup"],
      "motion_prompt": "bear spots cup on a table, runs towards it",
      "mood": "joyful, warm",
      "duration": 40
    }
  ]
}
```

### Story prompt format
User references cast members with @ tags:
```
"@bear tries to find @cup before the sun sets"
"@me and @bear go on an adventure through the forest"
```
Cast tags are resolved to object_ids before sending to Claude.

### SQLite schema
```sql
CREATE TABLE images (
  id TEXT PRIMARY KEY,
  path TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE objects (
  id TEXT PRIMARY KEY,
  image_id TEXT,
  tag TEXT NOT NULL,
  masked_png_path TEXT NOT NULL,
  clayified_png_path TEXT,
  thumbnail_b64 TEXT,
  subject_type TEXT DEFAULT 'object',
  is_clayified BOOLEAN DEFAULT FALSE,
  is_demo BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE projects (
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

CREATE TABLE scenes (
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
```

### Module responsibilities

**sam2_loader.py**
- Loads sam2-hiera-small ONCE on startup, keeps in memory as global
- predict_from_click(image, x, y) → mask
- predict_from_box(image, x1, y1, x2, y2) → mask

**services/segmentation.py**
- Uses sam2_loader to get mask
- Applies mask to image via PIL → transparent PNG
- Detects subject_type (person or object) — user can override via toggle
- Saves masked PNG to disk, stores in SQLite with tag
- Returns object_id + masked PNG base64 + subject_type

**services/clayify.py**
- clayify(masked_png_path, subject_type) → clayified PNG via Runware img2img
- For objects: "claymation style, clay texture, stop motion animation, soft handcrafted material, warm studio lighting"
- For persons: "claymation character, clay human figure, expressive face, soft clay texture, stop motion animation, handcrafted feel"
- Unifies cast from different environments into one visual world
- Saves clayified PNG, updates SQLite

**services/director.py**
- generate_film_brief(story_prompt, tone, cast[]) → film brief JSON
- Calls Claude API with cast descriptions + story
- Claude returns structured JSON: title, scenes[], each with setting/cast/motion_prompt/mood/duration
- Validates JSON, saves to project in SQLite
- Claude prompt enforces: only use provided cast members, stay true to story, max 5 min total

**services/background.py**
- generate_layers(setting, tone) → {sky, midground, foreground} image paths
- Three separate Runware text2img calls with layer-specific prompts:
  Sky: wide establishing shot, atmospheric, consistent lighting
  Midground: environment details, depth elements
  Foreground: ground plane, immediate surroundings, slight blur
- All three match the same setting + tone for visual coherence

**services/compositor.py**
- composite_scene(scene, cast_positions) → single scene image
- Stacks sky/mid/fore background layers using PIL
- Places clayified cast PNGs by position, scale, z_index
- Cast positions inferred from scene motion_prompt by Claude in director.py
- Returns composited image for Runware animation

**services/runware.py**
- generate_video(composite_image, motion_prompt, tone, duration) → video_url
- Stop motion params: 8-12fps, frame hold, intentional jank — non-negotiable
- Also handles text2img calls for background.py
- Async, polls until complete

**services/scorer.py**
- generate_sound_transcript(film_brief, scenes[]) → sound transcript string
- Calls Claude with full film brief + all scene descriptions
- Claude writes two things:
    1. Moment-by-moment sound design (ambient sounds, effects, music tone, transition swells)
    2. Narration script — a warm storyteller voice reading the story over the film
       e.g. "Once upon a time, a bear set out to find his friend..."
- Transcript references timestamps matching scene durations

**services/elevenlabs.py**
- generate_narration(narration_script) → narration_audio_url (Voice Generation API)
- generate_score(sound_transcript, total_duration) → score_audio_url (Music Generation + Sound Effects API)
- merge_narration_and_score(narration_url, score_url) → final_audio_url
- Narration sits on top of the score — voice clear, music underneath
- Final audio matched exactly to total film duration

**services/merger.py**
- merge_film(scene_video_urls[], audio_url) → final_video_path
- FFmpeg crossfade between scenes (1 second fade)
- Overlays full film audio track
- Exports final mp4 to static/outputs/
- Fallback: if only one scene generated, still produces valid mp4

**db.py**
- aiosqlite connection
- CRUD for images, objects, projects, scenes
- init_db() on startup

**models.py**
- CastMember, StoryRequest, FilmBrief, Scene, Project, ProjectStatus
- ToneEnum: warm, dark, whimsical, dramatic
- StageEnum: briefing, backgrounds, compositing, animating, scoring, audio, merging, complete, failed
- All request/response Pydantic shapes

**main.py**
- FastAPI app init
- SAM2 loaded on startup via lifespan event
- CORS for localhost:3000
- All routes
- Background pipeline runner using asyncio
- Scene generation runs in parallel across scenes
- Single scene fallback if multi-scene pipeline fails

## Stop motion feel (non-negotiable)
- 8-12fps generation
- Frame hold effect
- Slight motion jank — this is the aesthetic, not a bug

## Tone options
warm, dark, whimsical, dramatic

## Fallback strategy
- If multi-scene pipeline fails → fall back to single scene from scene 1
- If clayification fails → use masked PNG without style transfer
- If audio fails → deliver silent video rather than blocking delivery
- Always deliver something to the user

## Demo setup
- Pre-extract 5-6 demo objects in static/demo_objects/ (marked is_demo=TRUE)
- Demo objects are already clayified
- Demo flow:
    1. Show pre-loaded clay objects as cast chips in UI
    2. Take live photo of yourself at the venue → click to extract → clayify live
    3. Type: "@me and @bear go on an adventure"
    4. Pick tone: whimsical
    5. Hit Make Film → watch scene progress update in real time
    6. Film plays — you as a clay character in an animated world
- The live self-clayification is the hero moment — lead with it

## Build order for Claude Code
1. models.py
2. db.py
3. sam2_loader.py
4. services/segmentation.py
5. services/clayify.py
6. services/background.py
7. services/compositor.py
8. services/director.py
9. services/runware.py
10. services/scorer.py
11. services/elevenlabs.py
12. services/merger.py
13. main.py

## Environment variables
RUNWARE_API_KEY=
ANTHROPIC_API_KEY=
ELEVENLABS_API_KEY=
DATABASE_URL=./codaline.db
SAM2_CHECKPOINT=./checkpoints/sam2_hiera_small.pt
SAM2_CONFIG=sam2_hiera_s.yaml

## Rules
- Never use sync calls for external APIs, always async
- All API keys via .env, never hardcoded
- Pydantic models for everything in/out
- One responsibility per service file
- ProjectStatus + SceneStatus updated at every stage
- SAM2 loaded ONCE on startup, never per request
- ffmpeg assumed installed on system
- Store files on disk, store paths in SQLite (not blobs)
- Scene generation runs in parallel where possible
- Always have a fallback — never leave user with nothing
- Stop motion feel is non-negotiable

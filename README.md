# Codaline

**One-click claymation film studio.** Upload photos of objects, write a story prompt, pick a tone — and get back a short claymation film with animated scenes, layered backgrounds, and a scored soundtrack. Inspired by the stop-motion tradition of Coraline and Wallace & Gromit.

> The user is the author. Claude is the director. The objects are the cast.

---

## Demo

1. Extract objects from photos — teddy bear, toy car, a mug
2. Write: `@bear and @giffy go on a road trip in @reddy`
3. Pick a tone: **Warm / Dark / Whimsical / Dramatic**
4. Hit **Make Film** — watch it generate scene by scene
5. A fully scored, narrated claymation film plays back in your browser

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        Browser (Next.js)                     │
│  Upload photo → click to extract cast → write story → watch │
└────────────────────────────┬────────────────────────────────┘
                             │ REST API
┌────────────────────────────▼────────────────────────────────┐
│                      FastAPI Backend                         │
│                                                              │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌───────────┐   │
│  │   SAM2   │  │  Claude  │  │ Runware  │  │ElevenLabs │   │
│  │ segment  │  │ director │  │bg+video  │  │  audio    │   │
│  └──────────┘  └──────────┘  └──────────┘  └───────────┘   │
│                                                              │
│  SQLite ── static files (objects, backgrounds, videos)       │
└─────────────────────────────────────────────────────────────┘
```

### Pipeline — Briefing to Screening

| Stage | What happens |
|---|---|
| **Briefing** | Claude reads your story + cast, writes a 3–5 scene film brief with settings, motion prompts, moods, and character placements |
| **Backgrounds** | Runware text-to-image generates a painted clay-world background for each scene in parallel |
| **Compositing** | PIL places your clayified characters onto the background at Claude's chosen positions |
| **Animating** | Kling (via Runware) animates each starting frame into a 5–10s video clip |
| **Scoring** | Claude writes a timestamped narration script and sound design transcript for the whole film |
| **Audio** | ElevenLabs voices the narration (scene-synced) and generates an ambient score, mixed together |
| **Merging** | FFmpeg stitches all scene clips with crossfade transitions and overlays the audio track |
| **Rendering** | Final MP4 is packaged and saved |
| **Screening** | Your claymation film is ready to watch and download |

### Key Services

| File | Responsibility |
|---|---|
| `services/segmentation.py` | SAM2 click/box segmentation → masked PNG + Claude vision auto-description |
| `services/clayify.py` | Runware img2img → transforms masked objects into clay-textured characters |
| `services/director.py` | Claude API → film brief JSON (scenes, placements, motion prompts) |
| `services/background.py` | Runware text2img → clay-world scene backgrounds |
| `services/compositor.py` | PIL → stacks background layers, places cast at correct positions/scale |
| `services/runware.py` | Kling img2video → animates composite scenes into video clips |
| `services/scorer.py` | Claude API → per-scene narration + sound design transcript |
| `services/elevenlabs.py` | ElevenLabs TTS + sound generation → scene-synced narration + score |
| `services/merger.py` | FFmpeg → crossfade stitch + audio overlay → final MP4 |

---

## Stack

**Backend**
- Python 3.11, FastAPI, aiosqlite (SQLite)
- SAM2 (`sam2-hiera-small`) — local segmentation model, runs on GPU
- PIL — compositing
- FFmpeg — video/audio stitching

**Frontend**
- Next.js 16, React 19, TypeScript
- Tailwind CSS, Framer Motion

**APIs**
- [Anthropic Claude](https://anthropic.com) — story direction + scoring
- [Runware](https://runware.ai) — background generation (SDXL) + animation (Kling 1.6 Pro)
- [ElevenLabs](https://elevenlabs.io) — TTS narration + sound generation

---

## Requirements

- Python 3.11+
- Node.js 18+
- **GPU recommended** — SAM2 runs on CPU but is very slow (~30s per click vs ~1s on GPU)
- FFmpeg installed on system
- ~2GB disk for the SAM2 model checkpoint

---

## Setup

### 1. Clone

```bash
git clone https://github.com/your-username/codaline.git
cd codaline
```

### 2. API Keys

Get keys from:
- [console.anthropic.com](https://console.anthropic.com) — Anthropic API key
- [runware.ai](https://runware.ai) — Runware API key
- [elevenlabs.io](https://elevenlabs.io) — ElevenLabs API key (Creator plan or above for TTS)

```bash
cp backend/.env.example backend/.env
# Edit backend/.env and fill in your keys
```

`.env` contents:
```env
ANTHROPIC_API_KEY=sk-ant-...
RUNWARE_API_KEY=...
ELEVENLABS_API_KEY=...
DATABASE_URL=./codaline.db
SAM2_CHECKPOINT=./checkpoints/sam2_hiera_small.pt
SAM2_CONFIG=sam2_hiera_s.yaml
CLAUDE_MODEL=claude-sonnet-4-6
```

### 3. FFmpeg

**macOS**
```bash
brew install ffmpeg
```

**Ubuntu / Debian**
```bash
sudo apt update && sudo apt install ffmpeg
```

**Windows**
Download from [ffmpeg.org/download.html](https://ffmpeg.org/download.html), extract, and add the `bin/` folder to your system PATH.

### 4. Backend

**macOS / Linux**
```bash
cd backend
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt
```

**Windows**
```powershell
cd backend
python -m venv venv
venv\Scripts\activate
pip install -r requirements.txt
```

#### Install SAM2 model checkpoint (~180MB)

**macOS / Linux**
```bash
mkdir -p checkpoints
cd checkpoints
wget https://dl.fbaipublicfiles.com/segment_anything_2/072824/sam2_hiera_small.pt
cd ..
```

**Windows (PowerShell)**
```powershell
New-Item -ItemType Directory -Force checkpoints
Invoke-WebRequest -Uri "https://dl.fbaipublicfiles.com/segment_anything_2/072824/sam2_hiera_small.pt" -OutFile "checkpoints\sam2_hiera_small.pt"
```

#### PyTorch — GPU support

For NVIDIA GPU (recommended):
```bash
pip install torch torchvision --index-url https://download.pytorch.org/whl/cu121
```

For CPU only (slow):
```bash
pip install torch torchvision
```

For Apple Silicon (MPS):
```bash
pip install torch torchvision
```

#### Run the backend

```bash
uvicorn main:app --reload --port 8000
```

### 5. Frontend

```bash
cd frontend
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

---

## Project Structure

```
codaline/
├── backend/
│   ├── main.py                 # FastAPI app, routes, pipeline runner
│   ├── db.py                   # SQLite CRUD via aiosqlite
│   ├── models.py               # Pydantic models + enums
│   ├── sam2_loader.py          # SAM2 loaded once on startup
│   ├── services/
│   │   ├── segmentation.py     # SAM2 click/box → masked PNG
│   │   ├── clayify.py          # Runware img2img → clay texture
│   │   ├── director.py         # Claude → film brief
│   │   ├── background.py       # Runware text2img → backgrounds
│   │   ├── compositor.py       # PIL compositing
│   │   ├── runware.py          # Kling img2video → animation
│   │   ├── scorer.py           # Claude → narration + sound transcript
│   │   ├── elevenlabs.py       # ElevenLabs TTS + score
│   │   └── merger.py           # FFmpeg → final MP4
│   ├── static/                 # Generated files (gitignored)
│   │   ├── uploads/
│   │   ├── objects/
│   │   ├── backgrounds/
│   │   ├── composites/
│   │   ├── audio/
│   │   └── outputs/
│   ├── checkpoints/            # SAM2 model weights (gitignored)
│   └── requirements.txt
├── frontend/
│   ├── app/
│   │   ├── studio/page.tsx     # Main studio UI
│   │   └── film/[projectId]/   # Film progress + playback
│   └── package.json
├── .gitignore
└── README.md
```

---

## How Object Extraction Works

1. Upload a photo
2. Click on any object (or drag a box around it)
3. SAM2 segments it out — transparent PNG, cropped to bbox
4. Claude vision automatically describes it: `"blue Xbox game controller"`
5. You give it a name tag: `@controller`
6. Clayification runs automatically — Runware img2img applies plasticine texture

The description is used later to give Kling explicit ground truth in the motion prompt, reducing hallucination.

---

## Tone Options

| Tone | Feel |
|---|---|
| **Warm** | Cosy, golden, gentle movement |
| **Dark** | Dramatic shadows, ominous atmosphere |
| **Whimsical** | Bouncy, bright, magical |
| **Dramatic** | Cinematic, high contrast, intense |

---


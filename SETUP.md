# Codaline — Setup & Claude Code Guide

## 1. Create your project folder

```bash
mkdir codaline
cd codaline
```

## 2. Drop these files in
- CLAUDE.md         ← architecture, Claude Code reads this automatically
- SETUP.md          ← this file
- .env.example      ← copy to .env and fill in your API keys
- requirements.txt  ← all Python dependencies

```bash
cp .env.example .env
# open .env and add your API keys
```

## 3. Create folder structure

```bash
mkdir -p services static/demo_objects static/outputs static/uploads checkpoints
touch services/__init__.py
```

## 4. Set up Python environment

```bash
python -m venv venv
source venv/bin/activate       # Mac/Linux
# venv\Scripts\activate        # Windows

pip install -r requirements.txt
```

## 5. Download SAM2 checkpoint (~2GB, start this first)

```bash
cd checkpoints
wget https://dl.fbaipublicfiles.com/segment_anything_2/072824/sam2_hiera_small.pt
cd ..
```

## 6. Install FFmpeg (if not already installed)

```bash
# Mac
brew install ffmpeg

# Ubuntu/Debian
sudo apt install ffmpeg

# Windows — download from ffmpeg.org
```

## 7. Install Claude Code

```bash
npm install -g @anthropic/claude-code
```

## 8. Get your API keys
- **ANTHROPIC_API_KEY** — claude.ai → settings → API keys
- **RUNWARE_API_KEY** — runware.io → use hackathon code: BIGSCREENHACK26
- **ELEVENLABS_API_KEY** — elevenlabs.io/?coupon=BigScreenHack

---

## How to use Claude Code

### Start it
```bash
cd codaline
claude
```

### The golden rule
One module per session. Always start by telling it to read CLAUDE.md.

### Every session starts with
```
Read CLAUDE.md fully before doing anything.
```

### Then one job at a time
```
Now build models.py only. Follow CLAUDE.md exactly. Nothing else.
```

### Build order — do these in sequence
1.  models.py
2.  db.py
3.  sam2_loader.py
4.  services/segmentation.py
5.  services/clayify.py
6.  services/background.py
7.  services/compositor.py
8.  services/director.py
9.  services/runware.py
10. services/scorer.py
11. services/elevenlabs.py
12. services/merger.py
13. main.py

### After each module — test before moving on
```bash
# models.py
python -c "from models import StoryRequest; print('models OK')"

# db.py
python -c "import asyncio; from db import init_db; asyncio.run(init_db()); print('db OK')"

# sam2_loader.py — takes ~10s to load
python -c "from sam2_loader import load_model; load_model(); print('SAM2 OK')"
```

### Useful Claude Code commands
- `/clear` — reset context when it goes off track
- Keep prompts short and directive
- If it edits multiple files: "Stop. Only edit [filename]."
- If it goes wrong: `/clear` then restart that module

### When you hit an error
```
Getting this error in [filename]. Fix only this file:
[paste full traceback]
```

---

## When backend is done
Come back and we'll design the Next.js frontend —
same process: architecture first, then Claude Code module by module.

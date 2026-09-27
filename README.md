# Jarvis

Merging OpenJarvis + adewaskar/jarvis to try and make better Jarvis.

OpenJarvis is the brain. adewaskar/jarvis is the holographic face. A small
bridge connects the face to the OpenJarvis brain.

## Layout

| Folder | What it is | From |
| --- | --- | --- |
| `brain/` | OpenJarvis (Python): agents, local models, server and API | [open-jarvis/OpenJarvis](https://github.com/open-jarvis/OpenJarvis) |
| `face/` | Holographic "Iron Man" UI (React + Three.js) and its Node bridge | [adewaskar/jarvis](https://github.com/adewaskar/jarvis) |
| `LICENSES/` | The original license text of both projects | |

See `UPSTREAM.md` for the exact upstream versions and the list of files we changed.

## Run it: the face with the OpenJarvis brain

You need three things running. Use three terminals.

1. **A model.** For example, install [Ollama](https://ollama.com) and pull a model:

   ```bash
   ollama pull qwen3:8b
   ```

2. **The brain** (OpenJarvis):

   ```bash
   cd brain
   uv sync --extra server
   uv run jarvis serve -e ollama -m qwen3:8b
   ```

   It listens on `http://127.0.0.1:8000`.

3. **The face**, pointed at OpenJarvis:

   ```bash
   cd face
   npm install
   JARVIS_BRAIN=openjarvis npm start
   ```

   Open http://localhost:5173 in Chrome. Click **INITIALISE**. Say **"Hey Jarvis"**.

The bridge prints `[jarvis] OpenJarvis ready, model ...` when it can reach the brain.

Leave out `JARVIS_BRAIN=openjarvis` to use Claude Code as the brain, like the original project.

What works now: questions, spoken answers, conversation memory, and interrupting.
What does not work yet: OpenJarvis cannot change the face (colours, effects, panels). That is Phase 3.

## Credits and licenses

- **OpenJarvis** — Apache License 2.0. See `LICENSES/OpenJarvis-Apache-2.0.txt`.
- **adewaskar/jarvis** — MIT License, Copyright (c) 2026 Aditya Dewaskar. See `LICENSES/adewaskar-jarvis-MIT.txt`.
- The audio files in `face/public/audio/` are cleared for demo use only. See `face/public/audio/CREDITS.md`. Do not use them in anything you sell.

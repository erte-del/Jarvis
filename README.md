# Jarvis

Merging OpenJarvis + adewaskar/jarvis to try and make better Jarvis.

OpenJarvis is the brain. adewaskar/jarvis is the holographic face. A small
bridge connects the face to the OpenJarvis brain.

## Layout

| Folder | What it is | From |
| --- | --- | --- |
| `brain/` | OpenJarvis (Python): agents, local models, server and API | [open-jarvis/OpenJarvis](https://github.com/open-jarvis/OpenJarvis) |
| `face/` | Holographic "Iron Man" UI (React + Three.js) and its Node bridge | [adewaskar/jarvis](https://github.com/adewaskar/jarvis) |
| `config/` | Settings that connect OpenJarvis to the face's tools | |
| `LICENSES/` | The original license text of both projects | |

See `UPSTREAM.md` for the exact upstream versions and the list of files we changed.

## Run it: the face with the OpenJarvis brain

You need three things running: a model, the face, and the brain.
Start them in this order. OpenJarvis looks for the face's tools only when it starts.

1. **A model.** Install [Ollama](https://ollama.com) and pull a model:

   ```bash
   ollama pull qwen3:8b
   ```

2. **The face** (terminal 1):

   ```bash
   cd face
   npm install
   JARVIS_BRAIN=openjarvis npm start
   ```

   It prints `OpenJarvis not reachable` now. That is expected: the brain is not running yet.

3. **The brain** (terminal 2):

   ```bash
   cd brain
   uv sync --extra server
   OPENJARVIS_CONFIG=../config/openjarvis.toml uv run jarvis serve -e ollama -m qwen3:8b
   ```

   `config/openjarvis.toml` connects OpenJarvis to the face's tools.

4. Open http://localhost:5173 in Chrome. Click **INITIALISE**. Say **"Hey Jarvis"**.
   Try: "Hey Jarvis, turn yourself red."

If you restart the brain, you do not need to restart the face.
If you restart the face, the brain keeps working. Only start the face before the brain the first time.

Leave out `JARVIS_BRAIN=openjarvis` to use Claude Code as the brain, like the original project.

What works: questions, spoken answers, conversation memory, interrupting, and the
face controls (`ui_theme`, `ui_reactor`, `ui_orbit`, `ui_chrome`, `ui_effect`,
`ui_screen`, `ui_reset`, `blade`).
Not connected: `display` and `probe_url` (off by default, see `config/openjarvis.toml`),
Chrome control, and the camera.

## Credits and licenses

- **OpenJarvis** — Apache License 2.0. See `LICENSES/OpenJarvis-Apache-2.0.txt`.
- **adewaskar/jarvis** — MIT License, Copyright (c) 2026 Aditya Dewaskar. See `LICENSES/adewaskar-jarvis-MIT.txt`.
- The audio files in `face/public/audio/` are cleared for demo use only. See `face/public/audio/CREDITS.md`. Do not use them in anything you sell.

# Jarvis

Merging OpenJarvis + adewaskar/jarvis to try and make better Jarvis.

OpenJarvis is the brain. adewaskar/jarvis is the holographic face. A small
bridge connects the face to the OpenJarvis brain.

**Results:** how a local model (qwen3:8b) compares with Claude behind the same
face, measured over 38 questions: see [RESULTS.md](RESULTS.md).

## Layout

| Folder | What it is | From |
| --- | --- | --- |
| `brain/` | OpenJarvis (Python): agents, local models, server and API | [open-jarvis/OpenJarvis](https://github.com/open-jarvis/OpenJarvis) |
| `face/` | Holographic "Iron Man" UI (React + Three.js) and its Node bridge | [adewaskar/jarvis](https://github.com/adewaskar/jarvis) |
| `config/` | Settings that connect OpenJarvis to the face's tools | |
| `bench/` | Tests that compare the two brains | |
| `LICENSES/` | The original license text of both projects | |

See `UPSTREAM.md` for the exact upstream versions and the list of files we changed.

## Run it: the face with the OpenJarvis brain

You need three things running: a model, the face, and the brain.
Start them in this order. OpenJarvis looks for the face's tools only when it starts.

1. **A model.** Install [Ollama](https://ollama.com) and pull a model:

   ```bash
   ollama pull qwen3:8b
   ```

   Keep the Ollama app running (on a Mac, the llama icon in the menu bar).

2. **The face** (terminal 1):

   ```bash
   cd ~/Documents/GitHub/Jarvis   # the folder you cloned the project into
   cd face
   npm install
   JARVIS_BRAIN=openjarvis npm start
   ```

   It prints `OpenJarvis not reachable` now. That is expected: the brain is not running yet.

3. **The brain** (terminal 2):

   ```bash
   cd ~/Documents/GitHub/Jarvis   # the folder you cloned the project into
   cd brain
   uv sync --extra server
   OPENJARVIS_CONFIG=../config/openjarvis.toml uv run jarvis serve -e ollama -m qwen3:8b
   ```

   `config/openjarvis.toml` connects OpenJarvis to the face's tools.
   Wait for `Uvicorn running` before you open the page.

   To let qwen think before it answers, put `OPENJARVIS_THINK=1 ` at the start of the last line.
   It gets more reasoning questions right, but answers take about 13 seconds instead of 1
   (see [RESULTS.md](RESULTS.md)).

   `npm install` and `uv sync --extra server` are safe to run every time. They only install
   what is missing, so they are quick after the first run. Run them again after every pull.

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

## Compare the two brains

`bench/` asks each brain the same 38 questions through the face bridge and compares them:
facts, multi-step reasoning, strict instructions, conversation, and face commands.
It grades two things separately. **Correct**: did it do what was asked? **Style**: does it
sound like JARVIS speaking (numbers as words, no filler, short, no face changes nobody asked for)?
It also measures time to the first word, time to the full answer, and cost.
The questions are in `bench/questions.json`, the checks in `bench/checks.mjs`.
The report grades saved answers again with the current checks.

1. **OpenJarvis.** Start the face and the brain as above. In a third terminal:

   ```bash
   node bench/run.mjs --runs 3
   ```

2. **Claude Code.** Stop both. Install and log in to Claude Code once:
   `npm install -g @anthropic-ai/claude-code`, then `claude`. Then start the face
   without `JARVIS_BRAIN` (in `face/`: `npm start`) and run:

   ```bash
   node bench/run.mjs --runs 3
   ```

   The Claude runs use your Claude plan.

   To compare setups of one brain, give each run a name with `--tag`, for example
   `node bench/run.mjs --runs 3 --tag thinking`. Each name gets its own column.
   To let qwen think before it answers, start the brain with `OPENJARVIS_THINK=1` in front.

3. Make the report:

   ```bash
   node bench/report.mjs
   ```

   It writes `bench/results/report.md`, with a summary table and every answer side by side.

Close the Jarvis page in Chrome while a test runs. Face changes from the test also show on an open page.

## Credits and licenses

- **OpenJarvis** — Apache License 2.0. See `LICENSES/OpenJarvis-Apache-2.0.txt`.
- **adewaskar/jarvis** — MIT License, Copyright (c) 2026 Aditya Dewaskar. See `LICENSES/adewaskar-jarvis-MIT.txt`.
- The audio files in `face/public/audio/` are cleared for demo use only. See `face/public/audio/CREDITS.md`. Do not use them in anything you sell.

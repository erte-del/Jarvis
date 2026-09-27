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

## Credits and licenses

- **OpenJarvis** — Apache License 2.0. See `LICENSES/OpenJarvis-Apache-2.0.txt`.
- **adewaskar/jarvis** — MIT License, Copyright (c) 2026 Aditya Dewaskar. See `LICENSES/adewaskar-jarvis-MIT.txt`.
- The audio files in `face/public/audio/` are cleared for demo use only. See `face/public/audio/CREDITS.md`. Do not use them in anything you sell.

# Upstream sources

Both projects are copied (vendored) into this repo. They do not update
automatically.

| Folder | Upstream | Commit | Copied on |
| --- | --- | --- | --- |
| `brain/` | https://github.com/open-jarvis/OpenJarvis | `8acafed23dc25073af4ba08b21310f4dee7e4e1d` | 2026-09-27 |
| `face/` | https://github.com/adewaskar/jarvis | `1c4016afdf86f7043efc6882ceffef84ad0d8783` | 2026-09-27 |

## Left out of the copy

- `brain/desktop/src-tauri/binaries/ollama-aarch64-apple-darwin` (77 MB).
  It is a prebuilt Ollama binary for the OpenJarvis desktop app. GitHub
  warns about files this big, and we do not use the desktop app.

## Files we changed

Apache 2.0 asks us to mark changed files. Add a line here for each change.

| File | Change |
| --- | --- |
| `face/bridge/openjarvis.mjs` | New file. Sends questions to a local OpenJarvis server instead of Claude Code. |
| `face/bridge/server.mjs` | Added the `JARVIS_BRAIN` switch. `openjarvis` hands each browser connection to `openjarvis.mjs`. |
| `face/.env.example` | Documented `JARVIS_BRAIN` and the `OPENJARVIS_*` settings. |
| `face/bridge/openjarvis.mjs` | Serves the existing `ui_*` and `display`/`blade` tools over MCP at `/mcp/ui` and `/mcp/display`, for OpenJarvis. |
| `face/bridge/server.mjs` | Routes `/mcp/ui` and `/mcp/display` to `openjarvis.mjs` in OpenJarvis mode. |
| `face/bridge/ui.mjs` | Added a `keepChanges` option. With it, `ui_theme` and `ui_reset` tell the model to keep changes until the user undoes them. The Claude path does not use it. |
| `brain/src/openjarvis/server/routes.py` | `/v1/info` also reports whether `OPENJARVIS_THINK` turned thinking on, so the benchmark can record it. |
| `brain/src/openjarvis/engine/ollama.py` | Thinking stays off by default, but `OPENJARVIS_THINK=1` turns it on, for the benchmark. |
| `face/src/lib/voice.ts` | Chrome speech path: words sent while still interim are not sent again when Chrome finalises them. Before, one sentence could be sent twice ("look at my Gmail" twice) or garbled ("what is the what is the weather"). |
| `face/package.json`, `face/package-lock.json` | Added `@modelcontextprotocol/sdk` as a direct dependency. It was already installed through the Claude Agent SDK. |

# Making the Claude brain faster

Notes for the next project: the same face, with Claude as the brain.

Right now the Claude brain takes about 4.5 seconds per answer, and about
3.8 seconds before the first word (see [RESULTS.md](RESULTS.md)). Most of that
time comes from three settings.

## What slows it down now

1. **A big model.** The face uses `claude-opus-5`. It is the smartest model and
   also the slowest.
2. **High effort.** Effort is how long Claude thinks before it answers. The face
   sets it to `high` (`face/bridge/server.mjs`, `JARVIS_EFFORT`).
3. **Many tools.** Every connected tool adds a description that Claude reads on
   every question. More tools make each answer slower.

## Test it in this repo (no code change)

```bash
cd ~/Documents/GitHub/Jarvis/face
JARVIS_MODEL=claude-sonnet-5 JARVIS_EFFORT=low npm start
```

This uses a faster model and less thinking. It should answer much faster. Hard
questions may get a little worse. To measure it, run the benchmark with a tag:

```bash
node bench/run.mjs --runs 3 --tag sonnet-low
node bench/report.mjs
```

## For the new repo

1. **Pick the model per question.** Send easy questions to a fast model
   (Haiku 4.5 or Sonnet 5). Send only hard ones to Opus.
2. **Call the Claude API directly.** The face runs Claude Code in the
   background (through the Claude Agent SDK), which adds extra steps. A direct
   API call has fewer steps. The downside: the API is billed separately, not
   from a Claude plan.
3. **Load only the tools you need.** Turn a connector on only when a question
   needs it.
4. **Keep the start of the prompt the same every time.** Claude can then reuse
   it (prompt caching), so each answer starts sooner. Put things that change,
   like the time or the face's state, at the end.
5. **Start talking early.** Speak the first sentence while the rest is still
   being written. The face already does this. Keep it.

## Fastest, but hardest to build

Let a local model (like qwen3:8b through Ollama) answer simple questions in
under a second, and send only hard ones to Claude. In this project, qwen was
right on every fact, conversation, and strict-instruction question, but missed
some reasoning questions (see [RESULTS.md](RESULTS.md)). The hard part is
deciding quickly which questions are "simple".

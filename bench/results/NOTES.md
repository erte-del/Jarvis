# Notes on the result files

What each file is, and what to keep in mind when reading it. All runs are on
the same Apple M5 laptop with 24 GB of memory.

| File | Setup | Notes |
| --- | --- | --- |
| `claude-2026-09-27-15-27-21.json` | Claude Code, first question set (20) | |
| `claude-2026-09-27-17-04-19.json` | Claude Code, harder set (38) | One turn hung after "Four" (face-stays, run 3). |
| `openjarvis-2026-09-27-15-08-45.json`, `-15-13-22` | qwen3:8b, first set | Before the face-status note was hidden: some answers read it aloud. |
| `openjarvis-2026-09-27-15-20-49.json` | qwen3:8b, first set | |
| `openjarvis-2026-09-27-15-44-57.json`, `-17-22-57`, `-17-30-58` | qwen3:8b, harder set, original instructions | Three repeats of the same setup: 102, 103 and 103 of 114 correct. This is the run-to-run spread. |
| `openjarvis-improved-2026-09-27-17-41-26.json` | qwen3:8b, first rewrite of the instructions | **Not a fair test.** The number examples in the instructions were answers to four test questions (391, 5:15, 1989, $33), and the face-command examples read like a to-do list: once, qwen ran them all on a maths question. |
| `openjarvis-thinking-2026-09-27-18-45-06.json` | Same instructions, thinking on | Same unfair instructions. Thinking also used up the 1,024-token budget on some questions and returned nothing. |

Later runs use instructions checked for overlap with the test questions, and a
4,096-token budget.

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

| `openjarvis-improved2-2026-09-28-04-40-48.json` | qwen3:8b, second rewrite (789fa76) | Fair. Style much better than the original (91 v. 70 of 114 answers with no style problem). Two questions got worse: fifteen percent of 240 (0 of 3, was 9 of 9 over three baseline runs) and lemon backwards (1 of 3, was 9 of 9). Likely cause: the new "give the answer first" rule stops qwen working the answer out. That rule was removed afterwards. |
| `openjarvis-thinking2-2026-09-28-04-43-45.json` | Meant as thinking on, 789fa76 | **Thinking was not on**: the brain was not restarted with `OPENJARVIS_THINK=1`. Same speed as improved2 (0.8 s). Treat it as one more improved2 run. Runs since record thinking on or off, and a run tagged for thinking refuses to start with it off. |

| `openjarvis-final-2026-09-28-05-56-12.json` | qwen3:8b, final instructions (52bcfe3), thinking off | The final setup. 105 of 114 correct, 92 of 114 with no style problem. Dropping "give the answer first" brought back fifteen percent of 240 and lemon backwards (3 of 3 each). Still wrong every run: Sally's sisters, the r's in strawberry, and "blue and hide the transcript" (qwen puts the transcript setting inside the colour tool, then says both are done). |
| `openjarvis-final-thinking-2026-09-28-06-12-29.json` | Same, thinking on (recorded) | One run only. 37 of 38 correct: it solved all three questions the final setup misses. The one miss was an empty answer after 48 seconds of thinking. Median answer time 13.1 s, against 0.9 s without thinking. |

The final comparison (`report.md`) uses: Claude, the original qwen setup (`-17-30-58`), improved2, final, and final-thinking.

Instructions from 789fa76 on are checked for overlap with the test questions, and ask for a
4,096-token budget.

# Results: a local brain against Claude, behind the same face

This project puts two open-source projects together: a holographic voice
interface ([adewaskar/jarvis](https://github.com/adewaskar/jarvis)) and a local
AI framework ([OpenJarvis](https://github.com/open-jarvis/OpenJarvis)). The face
was built for Claude Code as its brain. A small bridge lets it use OpenJarvis
instead, running the model **qwen3:8b** on a laptop.

The question: how does a free local model compare with Claude when it has to
act as JARVIS? It has to answer questions, sound right when read aloud, and
control its own face.

**Short answer.** After three rounds of changes, the local model was right
92% of the time, against Claude's 99%. It answered in under a second, against
4.5 seconds, and cost nothing. It still sounded less like JARVIS (81% against
100%), and it still sometimes said it had done something it had not. With
"thinking" turned on, it got 97% right, but took 13 seconds per answer.

## Final numbers

38 questions, each asked 3 times (thinking: once), on one Apple M5 laptop with
24 GB of memory. Every question goes through the face's bridge, the same way the
browser asks it.

| | qwen3:8b, original | qwen3:8b, final | qwen3:8b, final + thinking | Claude (claude-opus-5) |
| --- | --- | --- | --- | --- |
| **Correct** | 103 / 114 (90%) | 105 / 114 (92%) | 37 / 38 (97%) | 113 / 114 (99%) |
| Reasoning questions | 32 / 39 | 33 / 39 | 12 / 13 | 39 / 39 |
| Face commands | 21 / 24 | 21 / 24 | 8 / 8 | 23 / 24 |
| **Sounds like JARVIS** (no style problem) | 70 / 114 (61%) | 92 / 114 (81%) | 28 / 38 (74%) | 114 / 114 (100%) |
| Median answer length | 9 words | 6 words | 6 words | 3 words |
| **Median time to answer** | 0.9 s | 0.9 s | 13.1 s | 4.5 s |
| **Cost per answer** | $0 | $0 | $0 | $0.035 |

The full comparison, with every answer, is in
[`bench/results/report.md`](bench/results/report.md). The raw data for each run
is in [`bench/results/`](bench/results/), and
[`bench/results/NOTES.md`](bench/results/NOTES.md) says what each file is.

## How it was measured

The benchmark ([`bench/`](bench/)) sends each question to the face's bridge
over the same WebSocket the browser uses. It measures the whole system as a user
meets it, not the model alone. The questions are in five groups:

- **Facts:** "Who was the first woman to win a Nobel Prize?"
- **Reasoning:** "Sally has three brothers. Each of her brothers has two sisters. How many sisters does Sally have?"
- **Instructions:** "Reply with only yes or no: is the Pacific the largest ocean on Earth?"
- **Conversation:** greetings, a joke, remembering something said one message earlier.
- **Face commands:** "Make yourself blue and hide the transcript."

Each answer gets two separate grades ([`bench/checks.mjs`](bench/checks.mjs)):

- **Correct:** the right fact or number, the right face change actually sent
  to the screen, and any length the question asked for.
- **Style:** what a listener would notice. Numbers written as words ("five
  fifteen", not "5:15"), no filler ("let me know if…"), short enough to say, no
  markdown, and no face changes nobody asked for.

The checks are automatic, so they can be wrong. The report shows every answer
next to its grade, and the grading was corrected three times after reading the
answers (see below).

## What changed between runs

1. **Original setup.** Three repeat runs gave 102, 103 and 103 correct out of
   114. So a difference of one or two answers between runs is noise.
2. **The model read out a private note.** The bridge tells the model how its
   face looks right now. qwen3:8b started some answers by reading that note
   aloud. The bridge now removes the note from every reply.
3. **First rewrite of the instructions: not a fair test.** The number examples
   in the new instructions were, by accident, answers to four test questions.
   The list of face commands also read like a to-do list: once, the model ran
   all of them in answer to a maths question. That run is kept but not used.
4. **Second rewrite (fair).** Style improved from 70 to 91 clean answers. But
   two questions that had been right in all nine earlier tries went wrong:
   "What is fifteen percent of two hundred and forty?" (0 of 3) and "Spell the
   word lemon backwards" (1 of 3). The likely cause was a new rule, "give the
   answer first": the model had to answer before working it out.
5. **Final.** Without that rule, both questions were right again (3 of 3
   each), and style stayed at 92 clean answers.
6. **Final with thinking.** One run with the model allowed to think before it
   answers.

## Findings

- **Instructions change how a small model sounds, a lot.** Clean answers went
  from 61% to 81%. Filler phrases fell from 12 to 3, and changes to the face
  that nobody asked for from 3 to 0.
- **Instructions can also make a small model less accurate.** "Give the answer
  first" sounds like a style rule, but it cost correct answers, and removing it
  brought them back.
- **Three questions were beyond the local model without thinking,** in every
  run: Sally's sisters (it says two), the r's in "strawberry" (it says two), and
  "blue and hide the transcript".
- **The local model can say it did something it did not.** On "blue and hide
  the transcript", it put the transcript setting inside the colour tool, so the
  transcript stayed visible, and then said both were done. For a voice
  assistant this is worse than a wrong fact, because the user trusts the report.
- **Thinking fixed all three, at a large cost in time.** With thinking on, the
  model got 37 of 38 right, including the three above. But the median answer
  took 13.1 seconds instead of 0.9, and once it thought for 48 seconds and gave
  no answer at all.
- **Claude was the most accurate and sounded most like JARVIS, but it was
  slower and less steady.** Its median answer took 4.5 seconds. Six answers
  took more than 15 seconds, and once it stopped halfway through a turn and
  never finished. The Claude Agent SDK reported $4.00 for 114 answers. On a
  Claude subscription this comes out of the plan, not as a separate bill.

## Mistakes found along the way

The benchmark was checked against the answers it graded. These are the
problems that turned up:

- **The grading was wrong three times.** It checked only the last sentence
  (and failed Claude's "Thirty-three dollars, sir. Thirty off, plus three in
  tax."). The first fix let a wrong conclusion pass ("…left to face east. You
  are now facing west."). And it counted the title "1984" as a style problem.
  All three were fixed, and all saved answers were graded again.
- **Two runs ran on old code** because they started before a `git pull`. The
  benchmark now records the code version of every run.
- **One "thinking" run had thinking off,** which only its speed gave away. The
  brain now reports whether thinking is on, and a run tagged for thinking
  refuses to start without it.
- **An early theory was wrong.** A loop guard in OpenJarvis looked like the
  cause of some failing face commands. A test showed it only warns in this
  setup, so the change was undone.

## Limits

- **Small sample.** 38 questions, and one run with thinking. The questions are
  simple, and some groups have only four.
- **Different instructions.** Claude uses the original, long JARVIS persona.
  qwen3:8b uses a shorter one written for a small model. Some of the style gap
  may come from that, not from the model.
- **Speed depends on the answer's shape.** Claude sends its answer word by
  word, and OpenJarvis sends it all at once. For long answers, Claude would
  start speaking sooner than these numbers suggest.
- **Voice is not tested.** The questions go in as text.
- **One machine.** Other hardware would give other times.

## Run it yourself

The README explains how to start the face and the brain. Then:

```bash
node bench/run.mjs --runs 3 --tag mytest   # with the face and the brain running
node bench/report.mjs                      # writes bench/results/report.md
```

## How this was built

The code and the benchmark were written with help from Claude Code, an AI
coding assistant. Every test run was done on the laptop described above, and
the numbers here come from the saved results in `bench/results/`.

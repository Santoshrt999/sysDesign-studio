# Per-problem quiz: design

**Status:** approved in chat on 2026-11-09 ("yes, go ahead, also only 5 questions should be asked at a time").

## Why
Reading a journey is passive. A short quiz on the *reasoning* (what breaks next, why an option lost, what a number implies, sync call or queue) turns it into active recall and points back to the exact place to reread when an answer is wrong.

## Goals
- A quiz per problem, **5 questions per attempt**.
- **Locked until the reader has read Stage 5 (Flows)**, shown with 🔒 and how far they are. When it unlocks, a toast appears: "🔓 Quiz unlocked for <problem>".
- **Each attempt is at least 35% new:** at least `ceil(0.35 × 5) = 2` of the 5 questions were not in the previous attempt at that level.
- Questions you got wrong come back (light spaced repetition); never-seen questions come next; answer options are shuffled on every attempt.
- Every answer explains why each option wins or loses and links to the stage/step/flow it came from.

## Non-goals / anti-goals
- No definition questions ("what is a CDN?"). The quiz is about reasoning.
- No AI generation, no backend. Questions are hand-written content.
- No hard gate: a "Peek anyway" link opens a locked quiz (revising the night before must not be blocked).

## Levels
| Level | Unlocks after | Draws on |
|---|---|---|
| Core | Stage 5 (Flows) read | Size, Start simple (incl. sync vs queue), Evolve, Flows |
| Interviewer round | Stage 7 (Defend) read | Deep dives, trade-offs, follow-ups: interviewer pushback |

"Read" uses the existing rule (`completedStages`: forward navigation, or reaching the bottom after 8 s).

## Content
`Problem.quiz?: QuizQuestion[]` (optional, so problems without a quiz show no quiz UI).
```ts
interface QuizQuestion {
  id: string;                 // stable; progress refers to it
  level: "core" | "interviewer";
  kind: "numbers" | "decision" | "what-breaks" | "failure" | "sync-or-queue" | "pushback";
  prompt: string;
  options: { text: string; why: string }[];  // 3–4 options, each with why it wins/loses
  answer: number;             // index into options as written
  explanation: string;        // the takeaway, one or two sentences
  ref: { stage: number; evolveStep?: number; flowId?: string };  // 0-based stage, like Position
}
```
Pool sizes: ~15 core and ~8 interviewer per problem, enough that the 35% rule never runs dry. URL Shortener is written first for review; the other six follow.

## Picking (pure function, `src/lib/quiz/logic.ts`)
1. Filter the pool by level. Rank: previously wrong → never seen → the rest; random within a rank.
2. Take the top 5.
3. If fewer than 2 are new relative to the last attempt at this level, swap the lowest-ranked repeats for the highest-ranked new ones.
4. Shuffle question order; shuffle each question's options.

## Progress
`ProblemProgress.quiz?: { attempts: {at, level, ids, correct}[]; seen: string[]; wrong: string[] }` (last 30 attempts kept). Optional field, so existing profiles and backups stay valid. Without a profile the quiz still works; history lives in memory for the session.

## UI
- Problem page header: **Quiz** button (🔒 while locked). Opens a dialog: level cards (lock state, progress toward unlock, best score, attempts) → 5 questions (pick, check, see why, "Reread: Stage 5 · Flow …") → results with "New quiz".
- On and after Stage 5, a "Test yourself" card at the bottom when unlocked.
- Profile cards: "Quiz best 4/5" / "🔓 Quiz ready" / "🔒 Quiz after Stage 5".
- Home Continue chip: "🔓 Quiz ready: <problem>" for an unlocked, never-taken quiz.

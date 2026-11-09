/**
 * Pure quiz logic: unlock rules, picking 5 questions with at least 35% new each attempt, recording results.
 * No React, no I/O. Randomness is injectable so the picker can be checked deterministically.
 */
import type { ProblemProgress, QuizAttempt, QuizLevel, QuizProgress } from "@/lib/progress/types";

export const QUIZ_SIZE = 5;
/** Share of each attempt that must be new relative to the previous attempt at the same level. */
export const FRESH_SHARE = 0.35;
/** 0-based stage that must be read to unlock each level: Stage 5 (Flows) and Stage 7 (Defend). */
export const UNLOCK_STAGE: Record<QuizLevel, number> = { core: 4, interviewer: 6 };
export const LEVEL_NAMES: Record<QuizLevel, string> = { core: "Core quiz", interviewer: "Interviewer round" };
const MAX_ATTEMPTS = 30;

export function isUnlocked(p: ProblemProgress | undefined, level: QuizLevel): boolean {
  return !!p?.completedStages.includes(UNLOCK_STAGE[level]);
}

/** How many of the stages up to and including the unlock stage have been read, e.g. 3 of 5. */
export function unlockProgress(p: ProblemProgress | undefined, level: QuizLevel): { done: number; needed: number } {
  const needed = UNLOCK_STAGE[level] + 1;
  const done = p ? p.completedStages.filter((s) => s < needed).length : 0;
  return { done, needed };
}

export function lastAttempt(q: QuizProgress | undefined, level: QuizLevel): QuizAttempt | undefined {
  if (!q) return undefined;
  for (let i = q.attempts.length - 1; i >= 0; i--) if (q.attempts[i].level === level) return q.attempts[i];
  return undefined;
}

export function attemptsAt(q: QuizProgress | undefined, level: QuizLevel): QuizAttempt[] {
  return q ? q.attempts.filter((a) => a.level === level) : [];
}

export function bestScore(q: QuizProgress | undefined, level: QuizLevel): number | null {
  const a = attemptsAt(q, level);
  return a.length ? Math.max(...a.map((x) => x.correct.length)) : null;
}

export function shuffle<T>(items: readonly T[], rand: () => number = Math.random): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Pick up to QUIZ_SIZE ids from `poolIds` (already filtered to one level).
 * Ranked: previously wrong → never seen → the rest (random within a rank). Then at least
 * ceil(FRESH_SHARE × n) picks must not have been in `previous` (the last attempt at this level),
 * as long as the pool has that many. Returned in random order.
 */
export function pickQuiz(
  poolIds: readonly string[],
  history: QuizProgress | undefined,
  previous: readonly string[],
  rand: () => number = Math.random,
): string[] {
  const n = Math.min(QUIZ_SIZE, poolIds.length);
  const seen = new Set(history?.seen);
  const wrong = new Set(history?.wrong);
  const prev = new Set(previous);
  const rank = (id: string) => (wrong.has(id) ? 0 : !seen.has(id) ? 1 : 2);
  // shuffle first so the stable sort leaves each rank in random order
  const ranked = shuffle(poolIds, rand).sort((a, b) => rank(a) - rank(b));

  const picked = ranked.slice(0, n);
  const rest = ranked.slice(n);
  const freshAvailable = poolIds.filter((id) => !prev.has(id)).length;
  const needFresh = Math.min(Math.ceil(FRESH_SHARE * n), freshAvailable);
  let fresh = picked.filter((id) => !prev.has(id)).length;
  while (fresh < needFresh) {
    // drop the lowest-ranked repeat, add the highest-ranked new one
    let out = -1;
    for (let i = picked.length - 1; i >= 0; i--) if (prev.has(picked[i])) { out = i; break; }
    const inIdx = rest.findIndex((id) => !prev.has(id));
    if (out < 0 || inIdx < 0) break;
    picked[out] = rest.splice(inIdx, 1)[0];
    fresh++;
  }
  return shuffle(picked, rand);
}

export function recordAttempt(q: QuizProgress | undefined, attempt: QuizAttempt): QuizProgress {
  const base: QuizProgress = q ?? { attempts: [], seen: [], wrong: [] };
  const correct = new Set(attempt.correct);
  const seen = [...new Set([...base.seen, ...attempt.ids])];
  const wrong = [
    ...base.wrong.filter((id) => !attempt.ids.includes(id)),
    ...attempt.ids.filter((id) => !correct.has(id)),
  ];
  return { attempts: [...base.attempts, attempt].slice(-MAX_ATTEMPTS), seen, wrong };
}

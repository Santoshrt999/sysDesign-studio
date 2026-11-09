"use client";
import Link from "next/link";
import { useState } from "react";
import { buildRecap, clampPosition, daysAgo, isCompleted, percent, quizHref, resumeHref, type ProblemOutline } from "@/lib/progress/logic";
import { QUIZ_SIZE, UNLOCK_STAGE, bestScore, isUnlocked } from "@/lib/quiz/logic";
import type { ProblemProgress } from "@/lib/progress/types";
import { ProgressBar } from "./ProgressBar";

function ago(n: number) {
  return n === 0 ? "today" : n === 1 ? "yesterday" : `${n} days ago`;
}

/** The Netflix-style "continue where you left off" panel. */
export function ContinueHero({ problem, progress, today }: { problem: ProblemOutline; progress: ProblemProgress; today: string }) {
  const [expanded, setExpanded] = useState(false);
  const recap = buildRecap(problem, progress);
  const done = isCompleted(progress);
  const href = done ? `/problems/${problem.slug}#stage-1` : resumeHref(problem.slug, clampPosition(problem, progress.position));
  const last = recap.covered[recap.covered.length - 1];

  return (
    <section className="relative overflow-hidden rounded-3xl border border-indigo-200 bg-gradient-to-br from-indigo-100 via-white to-stone-100 p-6 sm:p-8 dark:border-indigo-900/60 dark:from-indigo-950 dark:via-stone-900 dark:to-stone-950">
      <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-indigo-700 dark:text-indigo-300">
        {done ? "Finished · review it" : "Continue where you left off"} · last read {ago(daysAgo(progress.lastVisited, today))}
      </div>
      <h2 className="mt-2 text-3xl font-semibold tracking-tight text-stone-900 sm:text-4xl dark:text-stone-50">{problem.title}</h2>
      <p className="mt-1 text-stone-600 dark:text-stone-300">
        <span className="font-medium text-stone-800 dark:text-stone-100">Next:</span> {recap.next}
      </p>
      <div className="mt-4 flex max-w-md items-center gap-3">
        <ProgressBar value={percent(progress)} done={done} />
        <span className="shrink-0 text-xs text-stone-500 dark:text-stone-400">{progress.completedStages.length}/7 stages</span>
      </div>

      {(last || progress.note) && (
        <div className="mt-5 max-w-2xl space-y-2 rounded-xl bg-white/70 p-4 text-sm text-stone-700 ring-1 ring-stone-200 dark:bg-stone-900/70 dark:text-stone-300 dark:ring-stone-800">
          {last && !expanded && <p><span className="font-semibold text-stone-900 dark:text-stone-100">Last time:</span> {last}</p>}
          {expanded && (
            <ul className="space-y-1.5">
              {recap.covered.map((c) => (
                <li key={c} className="flex gap-2"><span className="text-indigo-500 dark:text-indigo-300">✓</span><span>{c}</span></li>
              ))}
            </ul>
          )}
          {progress.note && (
            <p className="whitespace-pre-line border-t border-stone-200 pt-2 italic text-amber-800 dark:border-stone-800 dark:text-amber-300">
              <span className="not-italic font-semibold">Your note:</span> {progress.note}
            </p>
          )}
        </div>
      )}

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <Link href={href} className="inline-flex items-center gap-2 rounded-lg bg-stone-900 px-6 py-2.5 font-semibold text-white hover:bg-stone-700 dark:bg-stone-50 dark:text-stone-900 dark:hover:bg-white">
          ▶ {done ? "Review" : "Resume"}
        </Link>
        {problem.quiz && (isUnlocked(progress, "core") ? (
          <Link
            href={quizHref(problem.slug, clampPosition(problem, progress.position))}
            className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-5 py-2.5 font-semibold text-white hover:bg-indigo-700 dark:bg-indigo-500 dark:hover:bg-indigo-400"
          >
            🔓 Quiz
            {(() => {
              const best = bestScore(progress.quiz, "core");
              return best !== null ? <span className="text-xs font-medium text-indigo-200 dark:text-indigo-100">best {best}/{QUIZ_SIZE}</span> : null;
            })()}
          </Link>
        ) : (
          <span
            aria-disabled="true"
            title={`Unlocks after Stage ${UNLOCK_STAGE.core + 1} (Flows)`}
            className="inline-flex cursor-not-allowed items-center gap-2 rounded-lg px-5 py-2.5 font-semibold text-stone-400 ring-1 ring-stone-300 dark:text-stone-500 dark:ring-stone-700"
          >
            🔒 Quiz <span className="text-xs font-medium">after Stage {UNLOCK_STAGE.core + 1}</span>
          </span>
        ))}
        {recap.covered.length > 1 && (
          <button onClick={() => setExpanded((v) => !v)} className="rounded-lg px-4 py-2.5 text-sm font-medium text-stone-700 ring-1 ring-stone-300 hover:bg-white/60 dark:text-stone-200 dark:ring-stone-700 dark:hover:bg-stone-800">
            {expanded ? "Hide recap" : "Recap first"}
          </button>
        )}
      </div>
    </section>
  );
}

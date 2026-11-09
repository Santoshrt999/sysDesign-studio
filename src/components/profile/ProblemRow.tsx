"use client";
import Link from "next/link";
import { useState } from "react";
import { clampPosition, daysAgo, isCompleted, percent, resumeHref, type ProblemOutline } from "@/lib/progress/logic";
import type { ProblemProgress } from "@/lib/progress/types";
import { ProgressBar } from "./ProgressBar";

export interface RowItem {
  problem: ProblemOutline;
  progress?: ProblemProgress;
}

/** A Netflix-style row of problem cards. */
export function ProblemRow({ title, items, today, onReset }: { title: string; items: RowItem[]; today: string; onReset(slug: string): void }) {
  if (!items.length) return null;
  return (
    <section className="mt-10">
      <h3 className="mb-3 text-xs font-semibold uppercase tracking-[0.18em] text-stone-500 dark:text-stone-400">{title}</h3>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((it) => <ProblemCard key={it.problem.slug} {...it} today={today} onReset={onReset} />)}
      </div>
    </section>
  );
}

function ProblemCard({ problem, progress, today, onReset }: RowItem & { today: string; onReset(slug: string): void }) {
  const [menu, setMenu] = useState(false);
  const done = progress ? isCompleted(progress) : false;
  const href = !progress
    ? `/problems/${problem.slug}`
    : done
      ? `/problems/${problem.slug}#stage-1`
      : resumeHref(problem.slug, clampPosition(problem, progress.position));
  const n = progress ? daysAgo(progress.lastVisited, today) : 0;

  return (
    <div className="group relative rounded-xl border border-stone-200 bg-white p-4 transition hover:border-indigo-300 hover:shadow-md dark:border-stone-800 dark:bg-stone-900 dark:hover:border-indigo-700">
      <Link href={href} className="block">
        <div className="flex items-start justify-between gap-2 pr-6">
          <span className="font-semibold text-stone-900 group-hover:text-indigo-700 dark:text-stone-100 dark:group-hover:text-indigo-300">
            {problem.title}{done && " ✓"}
          </span>
          <span className="shrink-0 text-xs text-stone-400">{problem.difficulty}</span>
        </div>
        <p className="mt-1 line-clamp-2 text-sm text-stone-500 dark:text-stone-400">{problem.tagline}</p>
        {progress && (
          <>
            <ProgressBar value={percent(progress)} done={done} className="mt-3" />
            <div className="mt-1.5 flex justify-between text-xs text-stone-500 dark:text-stone-400">
              <span>{done ? "Done · review?" : `${progress.completedStages.length}/7 stages`}</span>
              <span>{n === 0 ? "today" : n === 1 ? "yesterday" : `${n} days ago`}</span>
            </div>
            {progress.note && <p className="mt-2 truncate text-xs italic text-amber-700 dark:text-amber-300">✎ {progress.note}</p>}
          </>
        )}
      </Link>
      {progress && (
        <div className="absolute right-2 top-2">
          <button onClick={() => setMenu((v) => !v)} aria-label="More actions" className="rounded px-1.5 text-stone-400 hover:bg-stone-100 hover:text-stone-700 dark:hover:bg-stone-800 dark:hover:text-stone-200">⋯</button>
          {menu && (
            <div className="absolute right-0 z-10 mt-1 w-40 rounded-lg border border-stone-200 bg-white py-1 text-sm shadow-lg dark:border-stone-700 dark:bg-stone-900">
              <button
                onClick={() => {
                  setMenu(false);
                  if (window.confirm(`Reset your progress and note for ${problem.title}?`)) onReset(problem.slug);
                }}
                className="block w-full px-3 py-1.5 text-left text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/40"
              >
                Reset progress
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

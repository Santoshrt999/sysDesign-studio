"use client";
import Link from "next/link";
import { useProgress } from "@/lib/progress/ProgressProvider";
import { STAGE_NAMES, isCompleted, nextStage, resumeHref } from "@/lib/progress/logic";
import { isUnlocked } from "@/lib/quiz/logic";

/**
 * For returning readers: one click back to where they left off. Renders nothing for first-time visitors.
 * The problem page clamps the position on load, so a stale step/flow can't break the link.
 */
export function ContinueChip({ titles, quizSlugs = [] }: { titles: Record<string, string>; quizSlugs?: string[] }) {
  const { file } = useProgress();
  if (!file) return null;
  const quizReady = quizSlugs
    .filter((slug) => titles[slug] && isUnlocked(file.problems[slug], "core") && !file.problems[slug]?.quiz?.attempts.length)
    .sort((a, b) => file.problems[b].lastVisited.localeCompare(file.problems[a].lastVisited))[0];
  return (
    <div className="flex flex-wrap gap-2">
      <ResumeChip titles={titles} />
      {quizReady && (
        <Link
          href={`/problems/${quizReady}?quiz=1#stage-5`}
          className="inline-flex items-center gap-2 rounded-full bg-amber-400/10 px-4 py-2 text-sm text-amber-100 ring-1 ring-amber-300/30 transition hover:bg-amber-400/20"
        >
          <span aria-hidden>🔓</span> Quiz ready: {titles[quizReady]} <span aria-hidden>→</span>
        </Link>
      )}
    </div>
  );
}

function ResumeChip({ titles }: { titles: Record<string, string> }) {
  const { file } = useProgress();
  if (!file) return null;
  const latest = Object.entries(file.problems)
    .filter(([slug, p]) => titles[slug] && !isCompleted(p))
    .sort((a, b) => b[1].lastVisited.localeCompare(a[1].lastVisited))[0];
  if (!latest) return null;
  const [slug, p] = latest;
  const s = nextStage(p);
  return (
    <Link
      href={resumeHref(slug, p.position)}
      className="inline-flex items-center gap-2 rounded-full bg-indigo-500/15 px-4 py-2 text-sm text-indigo-100 ring-1 ring-indigo-400/30 transition hover:bg-indigo-500/25"
    >
      <span className="text-indigo-300" aria-hidden>↻</span>
      Continue {titles[slug]} · Stage {s + 1}, {STAGE_NAMES[s]}
      <span aria-hidden>→</span>
    </Link>
  );
}

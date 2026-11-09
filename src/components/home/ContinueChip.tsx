"use client";
import Link from "next/link";
import { useProgress } from "@/lib/progress/ProgressProvider";
import { STAGE_NAMES, isCompleted, nextStage, resumeHref } from "@/lib/progress/logic";

/**
 * For returning readers: one click back to where they left off. Renders nothing for first-time visitors.
 * The problem page clamps the position on load, so a stale step/flow can't break the link.
 */
export function ContinueChip({ titles }: { titles: Record<string, string> }) {
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

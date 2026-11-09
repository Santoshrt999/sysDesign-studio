"use client";
// Author: Santosh Goteti
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Problem } from "@/content/types";
import { useProgress } from "@/lib/progress/ProgressProvider";
import { clampPosition, resumeHref } from "@/lib/progress/logic";
import type { Position, QuizLevel } from "@/lib/progress/types";
import { LEVEL_NAMES, isUnlocked } from "@/lib/quiz/logic";
import { QuizDialog } from "@/components/quiz/QuizDialog";
import { StageUnderstand } from "./StageUnderstand";
import { StageSize } from "./StageSize";
import { StageStartSimple } from "./StageStartSimple";
import { StageEvolve } from "./StageEvolve";
import { StageFlows } from "./StageFlows";
import { StageDeepDives } from "./StageDeepDives";
import { StageDefend } from "./StageDefend";
import { JourneyPositionContext, type JourneyPositionValue } from "./JourneyPosition";
import { NotesPanel } from "./NotesPanel";

const STAGES = [
  { short: "Understand", C: StageUnderstand },
  { short: "Size", C: StageSize },
  { short: "Start simple", C: StageStartSimple },
  { short: "Evolve", C: StageEvolve },
  { short: "Flows", C: StageFlows },
  { short: "Deep dives", C: StageDeepDives },
  { short: "Defend", C: StageDefend },
];

/** A stage counts as read by scrolling to its end only after it has been open this long. */
const MIN_READ_MS = 8000;

export function JourneyViewer({ problem }: { problem: Problem }) {
  const slug = problem.slug;
  const { status, file, trackPosition, markStageRead } = useProgress();
  const [stage, setStage] = useState(0);
  const [ready, setReady] = useState(false);
  // Opening a problem without an explicit #stage link (e.g. from the home page) is browsing:
  // it must not overwrite a saved position until the reader actually moves.
  const [explicitStage, setExplicitStage] = useState(false);
  const hasProgress = !!file?.problems[slug];
  const [evolveStep, setEvolveStep] = useState<number | undefined>(undefined);
  const [flowId, setFlowId] = useState<string | undefined>(undefined);
  const [quizOpen, setQuizOpen] = useState(false);

  // Keep the stage in the URL hash (#stage-4) so a refresh / shared link lands in the same place.
  // A resume link also carries ?step=N&flow=id, restoring the exact evolution step and flow.
  useEffect(() => {
    const m = window.location.hash.match(/stage-(\d)/);
    const q = new URLSearchParams(window.location.search);
    const raw = {
      stage: m ? Number(m[1]) - 1 : 0,
      evolveStep: q.has("step") ? Number(q.get("step")) : undefined,
      flowId: q.get("flow") ?? undefined,
    };
    const pos = clampPosition(problem, raw);
    setStage(pos.stage);
    setEvolveStep(pos.evolveStep);
    setFlowId(pos.flowId);
    setExplicitStage(!!m);
    if (q.get("quiz") === "1" && problem.quiz?.length) {
      setQuizOpen(true);
      q.delete("quiz");
      const qs = q.toString();
      window.history.replaceState(null, "", `${window.location.pathname}${qs ? `?${qs}` : ""}${window.location.hash}`);
    }
    setReady(true);
  }, [problem]);

  // Record where the reader is (no-op without a profile). A first visit always creates the entry;
  // an existing position is only overwritten when the stage came from the URL or the reader moved.
  useEffect(() => {
    if (!ready || status !== "ready") return;
    if (hasProgress && !explicitStage) return;
    trackPosition(slug, { stage });
  }, [ready, status, slug, stage, explicitStage, hasProgress, trackPosition]);

  // ── Quiz: locked until Stage 5 is read; a toast announces the unlock while the reader is here.
  const hasQuiz = !!problem.quiz?.length;
  const progress = file?.problems[slug];
  const coreUnlocked = isUnlocked(progress, "core");
  const [toast, setToast] = useState<QuizLevel | null>(null);
  const seenUnlock = useRef<Record<QuizLevel, boolean> | null>(null);
  useEffect(() => {
    if (!hasQuiz || status !== "ready") return;
    const now = { core: isUnlocked(progress, "core"), interviewer: isUnlocked(progress, "interviewer") };
    const before = seenUnlock.current;
    seenUnlock.current = now;
    if (!before) return; // first observation after load: not an unlock event
    const level = (["interviewer", "core"] as const).find((l) => now[l] && !before[l]);
    if (!level || !problem.quiz?.some((q) => q.level === level)) return;
    setToast(level);
  }, [hasQuiz, status, progress, problem.quiz]);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 9000);
    return () => clearTimeout(t);
  }, [toast]);

  // "Reread" from the quiz: go straight to the stage/step/flow a question came from.
  const [navKey, setNavKey] = useState(0);
  const jump = useCallback((ref: Position) => {
    const pos = clampPosition(problem, ref);
    setStage(pos.stage);
    setEvolveStep(pos.evolveStep);
    setFlowId(pos.flowId);
    setExplicitStage(true);
    setNavKey((k) => k + 1);
    window.history.replaceState(null, "", resumeHref(slug, pos));
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, [problem, slug]);

  const go = (i: number) => {
    if (i > stage) markStageRead(slug, stage); // leaving a stage forwards counts as reading it
    setExplicitStage(true);
    setStage(i);
    window.history.replaceState(null, "", `${window.location.pathname}#stage-${i + 1}`);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  // Reaching the bottom of a stage also counts, once it has been open for MIN_READ_MS.
  const sentinel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!ready || status !== "ready" || !sentinel.current) return;
    const openedAt = Date.now();
    let visible = false;
    let t: ReturnType<typeof setTimeout> | null = null;
    const io = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      if (!visible) return;
      const wait = MIN_READ_MS - (Date.now() - openedAt);
      if (wait <= 0) markStageRead(slug, stage);
      else if (!t) t = setTimeout(() => { t = null; if (visible) markStageRead(slug, stage); }, wait);
    });
    io.observe(sentinel.current);
    return () => { io.disconnect(); if (t) clearTimeout(t); };
  }, [ready, status, slug, stage, markStageRead]);

  const onEvolveStep = useCallback((n: number) => {
    setEvolveStep(n);
    trackPosition(slug, { evolveStep: n });
  }, [slug, trackPosition]);
  const onFlow = useCallback((id: string) => {
    setFlowId(id);
    trackPosition(slug, { flowId: id });
  }, [slug, trackPosition]);
  const position = useMemo<JourneyPositionValue>(() => ({ evolveStep, flowId, onEvolveStep, onFlow }), [evolveStep, flowId, onEvolveStep, onFlow]);

  const { C } = STAGES[stage];

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-20 border-b border-stone-200 bg-stone-50/90 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center gap-4 px-6 py-3">
          <Link href="/" className="text-sm text-stone-500 hover:text-stone-900">← Problems</Link>
          <div className="font-semibold text-stone-900">{problem.title}</div>
          <nav className="ml-auto flex gap-1 overflow-x-auto">
            {STAGES.map((s, i) => (
              <button
                key={s.short}
                onClick={() => go(i)}
                className={`flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1 text-sm transition ${i === stage ? "bg-stone-900 text-white" : "text-stone-600 hover:bg-stone-200"}`}
              >
                <span className={`text-xs ${i === stage ? "text-stone-400" : "text-stone-400"}`}>{i + 1}</span>
                {s.short}
              </button>
            ))}
          </nav>
          {hasQuiz && (
            <button
              onClick={() => setQuizOpen(true)}
              title={coreUnlocked ? "Take the quiz" : "Unlocks after Stage 5 (Flows)"}
              className={`relative shrink-0 rounded-full px-3 py-1 text-sm font-medium transition ${coreUnlocked ? "bg-indigo-600 text-white hover:bg-indigo-700" : "text-stone-500 ring-1 ring-stone-300 hover:bg-stone-100"}`}
            >
              {coreUnlocked ? "Quiz" : "🔒 Quiz"}
              {coreUnlocked && !progress?.quiz?.attempts.length && (
                <span className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full bg-amber-400 ring-2 ring-stone-50" aria-label="new" />
              )}
            </button>
          )}
          <NotesPanel slug={slug} />
          <Link href="/profile" className="shrink-0 text-sm text-stone-500 hover:text-indigo-700">Profile</Link>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-6 py-8">
        <JourneyPositionContext.Provider value={position}>
          {/* Remount once the URL has been read, so Evolve/Flows pick up a restored step/flow. */}
          <C key={ready ? `restored-${navKey}` : "initial"} problem={problem} />
        </JourneyPositionContext.Provider>
        {hasQuiz && coreUnlocked && stage >= 4 && (
          <div className="mt-12 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-indigo-200 bg-gradient-to-r from-indigo-50 to-white p-5">
            <div>
              <div className="font-semibold text-stone-900">Test yourself: 5 questions</div>
              <p className="text-sm text-stone-600">What breaks, why an option lost, what the numbers imply. Each answer links back here.</p>
            </div>
            <button onClick={() => setQuizOpen(true)} className="rounded-lg bg-indigo-600 px-5 py-2 text-sm font-semibold text-white hover:bg-indigo-700">
              {progress?.quiz?.attempts.length ? "New quiz" : "Start the quiz"}
            </button>
          </div>
        )}
        <div ref={sentinel} aria-hidden className="h-px" />
        <div className="mt-12 flex justify-between border-t border-stone-200 pt-6">
          {stage > 0 ? (
            <button onClick={() => go(stage - 1)} className="text-stone-600 hover:text-stone-900">← {STAGES[stage - 1].short}</button>
          ) : <span />}
          {stage < STAGES.length - 1 && (
            <button onClick={() => go(stage + 1)} className="rounded-lg bg-stone-900 px-5 py-2 text-white">Next: {STAGES[stage + 1].short} →</button>
          )}
        </div>
      </main>

      {toast && (
        <div role="status" className="fixed bottom-5 left-1/2 z-40 flex -translate-x-1/2 items-center gap-3 rounded-full bg-stone-900 py-2 pl-5 pr-2 text-sm text-white shadow-xl">
          <span>🔓 {LEVEL_NAMES[toast]} unlocked for {problem.title}</span>
          <button onClick={() => { setToast(null); setQuizOpen(true); }} className="rounded-full bg-indigo-500 px-3 py-1 font-medium hover:bg-indigo-400">Take it</button>
          <button onClick={() => setToast(null)} aria-label="Dismiss" className="px-2 text-stone-400 hover:text-white">×</button>
        </div>
      )}
      {quizOpen && <QuizDialog problem={problem} onClose={() => setQuizOpen(false)} onJump={jump} />}
    </div>
  );
}

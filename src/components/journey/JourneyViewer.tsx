"use client";
// Author: Santosh Goteti
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Problem } from "@/content/types";
import { useProgress } from "@/lib/progress/ProgressProvider";
import { clampPosition } from "@/lib/progress/logic";
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
    setReady(true);
  }, [problem]);

  // Record where the reader is (no-op without a profile). A first visit always creates the entry;
  // an existing position is only overwritten when the stage came from the URL or the reader moved.
  useEffect(() => {
    if (!ready || status !== "ready") return;
    if (hasProgress && !explicitStage) return;
    trackPosition(slug, { stage });
  }, [ready, status, slug, stage, explicitStage, hasProgress, trackPosition]);

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
          <NotesPanel slug={slug} />
          <Link href="/profile" className="shrink-0 text-sm text-stone-500 hover:text-indigo-700">Profile</Link>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-6 py-8">
        <JourneyPositionContext.Provider value={position}>
          {/* Remount once the URL has been read, so Evolve/Flows pick up a restored step/flow. */}
          <C key={ready ? "restored" : "initial"} problem={problem} />
        </JourneyPositionContext.Provider>
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
    </div>
  );
}

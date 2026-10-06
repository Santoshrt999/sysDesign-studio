"use client";
// Author: Santosh Goteti
import Link from "next/link";
import { useEffect, useState } from "react";
import type { Problem } from "@/content/types";
import { StageUnderstand } from "./StageUnderstand";
import { StageSize } from "./StageSize";
import { StageStartSimple } from "./StageStartSimple";
import { StageEvolve } from "./StageEvolve";
import { StageFlows } from "./StageFlows";
import { StageDeepDives } from "./StageDeepDives";
import { StageDefend } from "./StageDefend";

const STAGES = [
  { short: "Understand", C: StageUnderstand },
  { short: "Size", C: StageSize },
  { short: "Start simple", C: StageStartSimple },
  { short: "Evolve", C: StageEvolve },
  { short: "Flows", C: StageFlows },
  { short: "Deep dives", C: StageDeepDives },
  { short: "Defend", C: StageDefend },
];

export function JourneyViewer({ problem }: { problem: Problem }) {
  const [stage, setStage] = useState(0);

  // Keep the stage in the URL hash (#stage-4) so a refresh / shared link lands in the same place.
  useEffect(() => {
    const m = window.location.hash.match(/stage-(\d)/);
    if (m) setStage(Math.min(STAGES.length - 1, Number(m[1]) - 1));
  }, []);
  const go = (i: number) => {
    setStage(i);
    window.history.replaceState(null, "", `#stage-${i + 1}`);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };
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
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-6 py-8">
        <C problem={problem} />
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

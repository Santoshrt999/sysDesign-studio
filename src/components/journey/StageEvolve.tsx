"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import type { Problem } from "@/content/types";
import { diagramAt } from "@/lib/diagram";
import { ArchDiagram, type EdgeState, type NodeState } from "../diagram/ArchDiagram";
import { Label, OptionCard, SayIt, StageHeader } from "../ui/primitives";

export function StageEvolve({ problem }: { problem: Problem }) {
  const total = problem.evolution.length;
  const [step, setStep] = useState(1); // number of evolution steps applied; 0 = v1
  const state = useMemo(() => diagramAt(problem, step), [problem, step]);
  const current = step > 0 ? problem.evolution[step - 1] : undefined;

  const go = useCallback((n: number) => setStep(Math.max(0, Math.min(total, n))), [total]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") go(step + 1);
      if (e.key === "ArrowLeft") go(step - 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go, step]);

  const nodeState = useCallback(
    (id: string): NodeState => (state.addedNodes.has(id) ? "added" : state.updatedNodes.has(id) ? "updated" : "normal"),
    [state],
  );
  const edgeState = useCallback((id: string): EdgeState => (state.addedEdges.has(id) ? "added" : "normal"), [state]);

  return (
    <div>
      <StageHeader n={4} title="Evolve the design" question="Each step: a concrete problem → options → decision → the new risk it creates." />

      {/* Timeline scrubber */}
      <div className="mb-4 rounded-xl border border-stone-200 bg-white p-4">
        <div className="flex items-center gap-2 overflow-x-auto pb-1">
          {["v1", ...problem.evolution.map((e) => e.version)].map((v, i) => (
            <button
              key={v}
              onClick={() => go(i)}
              className={`shrink-0 rounded-full px-3 py-1 text-sm font-medium transition ${
                i === step ? "bg-indigo-600 text-white" : i < step ? "bg-indigo-100 text-indigo-700" : "bg-stone-100 text-stone-500"
              }`}
              title={i === 0 ? problem.v1.title : problem.evolution[i - 1].title}
            >
              {v}
            </button>
          ))}
          <div className="ml-auto flex shrink-0 gap-2">
            <button onClick={() => go(step - 1)} disabled={step === 0} className="rounded-md border border-stone-200 px-3 py-1 text-sm disabled:opacity-40">← Back</button>
            <button onClick={() => go(step + 1)} disabled={step === total} className="rounded-md bg-stone-900 px-3 py-1 text-sm text-white disabled:opacity-40">Next →</button>
          </div>
        </div>
        <input type="range" min={0} max={total} value={step} onChange={(e) => go(Number(e.target.value))} className="mt-3 w-full accent-indigo-600" />
        <div className="mt-1 text-xs text-stone-400">Tip: use ← → arrow keys to scrub. Green = added in this step, amber = changed.</div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.25fr_1fr]">
        <div className="lg:sticky lg:top-4 lg:self-start">
          <ArchDiagram nodes={state.nodes} edges={state.edges} nodeState={nodeState} edgeState={edgeState} height={520} />
          {state.removedNodes.length > 0 && (
            <div className="mt-2 text-sm text-red-600">Removed in this step: {state.removedNodes.map((n) => n.label).join(", ")}</div>
          )}
        </div>

        <AnimatePresence mode="wait">
          <motion.div key={step} initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -12 }} transition={{ duration: 0.2 }} className="space-y-5">
            {!current ? (
              <>
                <h3 className="text-xl font-semibold">{problem.v1.title}</h3>
                <ul className="space-y-2 text-stone-700">{problem.v1.description.map((d) => <li key={d}>{d}</li>)}</ul>
                <div className="rounded-lg bg-red-50 p-4">
                  <Label tone="red">What breaks first?</Label>
                  <ol className="list-decimal space-y-1 pl-5 text-sm text-stone-700">{problem.v1.whatBreaksFirst.map((w) => <li key={w}>{w}</li>)}</ol>
                </div>
              </>
            ) : (
              <>
                <div>
                  <div className="text-sm font-semibold text-indigo-600">{current.version}</div>
                  <h3 className="text-xl font-semibold text-stone-900">{current.title}</h3>
                </div>
                <div className="rounded-lg border-l-4 border-red-400 bg-red-50 px-4 py-3">
                  <Label tone="red">Problem</Label>
                  <p className="text-stone-800">{current.problem}</p>
                  <p className="mt-2 font-mono text-xs text-stone-500">Evidence: {current.evidence}</p>
                </div>
                <div>
                  <Label>Options considered</Label>
                  <div className="space-y-2">{current.options.map((o) => <OptionCard key={o.name} option={o} />)}</div>
                </div>
                <div className="rounded-lg border-l-4 border-emerald-500 bg-emerald-50 px-4 py-3">
                  <Label tone="green">Decision</Label>
                  <p className="text-stone-800">{current.decision}</p>
                </div>
                <div>
                  <Label tone="amber">New risks introduced → how we handle them</Label>
                  <div className="space-y-2">
                    {current.newRisks.map((r) => (
                      <div key={r.risk} className="rounded-lg border border-amber-200 bg-amber-50/60 p-3 text-sm">
                        <div className="font-medium text-amber-900">⚠ {r.risk}</div>
                        <div className="mt-1 text-stone-700">→ {r.mitigation}</div>
                      </div>
                    ))}
                  </div>
                </div>
                <SayIt>{current.sayIt}</SayIt>
                {step < total && (
                  <button onClick={() => go(step + 1)} className="w-full rounded-lg border border-dashed border-stone-300 py-2 text-sm text-stone-500 hover:bg-stone-100">
                    What breaks next? → {problem.evolution[step].title}
                  </button>
                )}
              </>
            )}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}

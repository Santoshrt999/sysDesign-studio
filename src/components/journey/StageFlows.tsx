"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Flow, Problem } from "@/content/types";
import { diagramAt, edgeForHop } from "@/lib/diagram";
import { flowToSequence } from "@/lib/mermaid";
import { ArchDiagram, type EdgeState, type NodeState } from "../diagram/ArchDiagram";
import { Label, StageHeader } from "../ui/primitives";
import { MermaidView } from "./MermaidView";

const KIND_TONE: Record<Flow["kind"], string> = {
  write: "bg-violet-100 text-violet-700",
  read: "bg-sky-100 text-sky-700",
  failure: "bg-red-100 text-red-700",
};

export function StageFlows({ problem }: { problem: Problem }) {
  const final = useMemo(() => diagramAt(problem, problem.evolution.length), [problem]);
  const [flowId, setFlowId] = useState(problem.flows[0]?.id);
  const flow = problem.flows.find((f) => f.id === flowId) ?? problem.flows[0];
  const [hop, setHop] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [view, setView] = useState<"diagram" | "sequence">("diagram");
  const listRef = useRef<HTMLOListElement>(null);

  useEffect(() => { setHop(0); setPlaying(false); }, [flowId]);
  useEffect(() => {
    if (!playing) return;
    if (hop >= flow.hops.length - 1) { setPlaying(false); return; }
    const t = setTimeout(() => setHop((h) => h + 1), 2600);
    return () => clearTimeout(t);
  }, [playing, hop, flow.hops.length]);
  useEffect(() => {
    listRef.current?.querySelector(`[data-hop="${hop}"]`)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [hop]);

  const current = flow.hops[hop];
  const involved = useMemo(() => new Set(flow.hops.flatMap((h) => (h.to ? [h.from, h.to] : [h.from]))), [flow]);
  const involvedEdges = useMemo(
    () => new Set(flow.hops.map((h) => edgeForHop(final.edges, h.from, h.to)?.edge.id).filter(Boolean) as string[]),
    [flow, final.edges],
  );
  const activeEdge = edgeForHop(final.edges, current.from, current.to);

  const nodeState = useCallback(
    (id: string): NodeState => {
      if (current.failure && (id === current.to || (!current.to && id === current.from))) return "failed";
      if (id === current.from || id === current.to) return "active";
      return involved.has(id) ? "normal" : "dim";
    },
    [current, involved],
  );
  const edgeState = useCallback(
    (id: string): EdgeState => {
      if (activeEdge?.edge.id === id) return current.failure ? "failed" : "active";
      return involvedEdges.has(id) ? "normal" : "dim";
    },
    [activeEdge, current.failure, involvedEdges],
  );

  const sequence = useMemo(() => flowToSequence(flow, final.nodes), [flow, final.nodes]);
  const missingEdge = current.to && !activeEdge;

  return (
    <div>
      <StageHeader n={5} title="Walk the flows" question="Follow a request hop by hop: what happens, and why it's designed this way." />

      <div className="mb-4 flex flex-wrap gap-2">
        {problem.flows.map((f) => (
          <button
            key={f.id}
            onClick={() => setFlowId(f.id)}
            className={`rounded-lg border px-3 py-1.5 text-sm transition ${f.id === flow.id ? "border-stone-900 bg-stone-900 text-white" : "border-stone-200 bg-white text-stone-700 hover:bg-stone-50"}`}
          >
            <span className={`mr-2 rounded px-1.5 py-0.5 text-[10px] font-bold uppercase ${KIND_TONE[f.kind]}`}>{f.kind}</span>
            {f.name.replace(/^(Write path|Read path|Failure): /, "")}
          </button>
        ))}
      </div>

      <p className="mb-3 text-stone-600">{flow.summary}</p>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <button onClick={() => setHop(Math.max(0, hop - 1))} disabled={hop === 0} className="rounded-md border border-stone-200 bg-white px-3 py-1 text-sm disabled:opacity-40">← Prev</button>
        <button
          onClick={() => { if (hop >= flow.hops.length - 1) setHop(0); setPlaying(!playing); }}
          className="rounded-md bg-indigo-600 px-4 py-1 text-sm font-medium text-white"
        >
          {playing ? "❚❚ Pause" : hop >= flow.hops.length - 1 ? "↺ Replay" : "▶ Play"}
        </button>
        <button onClick={() => setHop(Math.min(flow.hops.length - 1, hop + 1))} disabled={hop === flow.hops.length - 1} className="rounded-md border border-stone-200 bg-white px-3 py-1 text-sm disabled:opacity-40">Next →</button>
        <span className="text-sm text-stone-500">Hop {hop + 1} / {flow.hops.length}</span>
        <div className="ml-auto flex overflow-hidden rounded-md border border-stone-200 text-sm">
          {(["diagram", "sequence"] as const).map((v) => (
            <button key={v} onClick={() => setView(v)} className={`px-3 py-1 capitalize ${view === v ? "bg-stone-900 text-white" : "bg-white text-stone-600"}`}>{v}</button>
          ))}
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <div>
          {view === "diagram" ? (
            <ArchDiagram
              nodes={final.nodes}
              edges={final.edges}
              nodeState={nodeState}
              edgeState={edgeState}
              packet={activeEdge ? { edgeId: activeEdge.edge.id, reverse: activeEdge.reverse, failure: current.failure } : undefined}
              height={520}
            />
          ) : (
            <MermaidView code={sequence} />
          )}
          {missingEdge && <div className="mt-2 text-xs text-red-600">Content warning: no edge between “{current.from}” and “{current.to}” in the final diagram.</div>}
          <div className={`mt-4 rounded-xl border p-4 ${current.failure ? "border-red-200 bg-red-50" : "border-indigo-200 bg-indigo-50/60"}`}>
            <div className="font-mono text-xs text-stone-500">
              {current.from}{current.to ? ` → ${current.to}` : " (local)"} {current.async && "· async"}
            </div>
            <div className="mt-1 font-semibold text-stone-900">{current.label}</div>
            <p className="mt-1 text-stone-700">{current.narration}</p>
            {current.why && (
              <p className="mt-2 text-sm text-stone-600"><span className="font-semibold text-emerald-700">Why: </span>{current.why}</p>
            )}
          </div>
        </div>

        <div>
          <Label>Narration</Label>
          <ol ref={listRef} className="max-h-[560px] space-y-1 overflow-y-auto pr-1">
            {flow.hops.map((h, i) => (
              <li key={i} data-hop={i}>
                <button
                  onClick={() => { setHop(i); setPlaying(false); }}
                  className={`w-full rounded-lg px-3 py-2 text-left text-sm transition ${
                    i === hop ? (h.failure ? "bg-red-100" : "bg-indigo-100") : i < hop ? "text-stone-500 hover:bg-stone-100" : "text-stone-700 hover:bg-stone-100"
                  }`}
                >
                  <span className="mr-2 font-mono text-xs text-stone-400">{String(i + 1).padStart(2, "0")}</span>
                  {h.failure && <span className="mr-1 text-red-600">✗</span>}
                  <span className="font-medium">{h.label}</span>
                  {i === hop && <div className="mt-1 text-stone-600">{h.narration}</div>}
                </button>
              </li>
            ))}
          </ol>
          <div className="mt-4 rounded-lg bg-stone-900 p-4 text-sm text-stone-100">
            <Label tone="amber">Takeaway</Label>
            {flow.takeaway}
          </div>
        </div>
      </div>
    </div>
  );
}

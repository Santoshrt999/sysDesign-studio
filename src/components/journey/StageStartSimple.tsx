"use client";
import type { Problem } from "@/content/types";
import { ArchDiagram } from "../diagram/ArchDiagram";
import { Card, Label, StageHeader } from "../ui/primitives";

export function StageStartSimple({ problem }: { problem: Problem }) {
  const { v1 } = problem;
  return (
    <div>
      <StageHeader n={3} title="Start simple" question="What's the simplest design that works for 1,000 users?" />
      <div className="grid gap-6 lg:grid-cols-[1.2fr_1fr]">
        <ArchDiagram nodes={v1.diagram.nodes} edges={v1.diagram.edges} height={320} />
        <Card>
          <Label tone="indigo">{v1.title}</Label>
          <ul className="space-y-2 text-sm text-stone-700">{v1.description.map((d) => <li key={d}>{d}</li>)}</ul>
        </Card>
      </div>

      <h3 className="mb-3 mt-8 font-semibold text-stone-800">API</h3>
      <div className="grid gap-4 md:grid-cols-2">
        {problem.api.map((a) => (
          <Card key={a.method + a.path}>
            <div className="font-mono text-sm"><span className="mr-2 rounded bg-indigo-100 px-1.5 py-0.5 font-semibold text-indigo-700">{a.method}</span>{a.path}</div>
            {a.request && <pre className="mt-3 overflow-x-auto rounded bg-stone-50 p-2 text-xs text-stone-700">{a.request}</pre>}
            <pre className="mt-2 overflow-x-auto rounded bg-stone-50 p-2 text-xs text-stone-700">{a.response}</pre>
            <p className="mt-2 text-sm text-stone-500">{a.notes}</p>
          </Card>
        ))}
      </div>

      <h3 className="mb-3 mt-8 font-semibold text-stone-800">Data model</h3>
      {problem.dataModel.map((m) => (
        <Card key={m.entity}>
          <div className="grid gap-6 md:grid-cols-2">
            <div>
              <div className="mb-2 font-mono text-sm font-semibold">{m.entity}</div>
              <table className="w-full font-mono text-xs">
                <tbody>
                  {m.fields.map((f) => (
                    <tr key={f.name} className="border-t border-stone-100">
                      <td className="py-1 pr-2 text-stone-800">{f.name}</td>
                      <td className="py-1 pr-2 text-stone-500">{f.type}</td>
                      <td className="py-1 font-sans text-stone-400">{f.note}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div>
              <Label>Access patterns</Label>
              <ul className="mb-3 list-disc pl-4 text-sm text-stone-700">{m.accessPatterns.map((p) => <li key={p}>{p}</li>)}</ul>
              <Label tone="green">Insight</Label>
              <p className="text-sm text-stone-700">{m.insight}</p>
            </div>
          </div>
        </Card>
      ))}

      <div className="mt-8 rounded-xl border-2 border-dashed border-red-300 bg-red-50/50 p-5">
        <div className="mb-2 text-lg font-semibold text-red-700">What breaks first as we grow?</div>
        <ol className="list-decimal space-y-1 pl-5 text-stone-700">{v1.whatBreaksFirst.map((w) => <li key={w}>{w}</li>)}</ol>
      </div>
    </div>
  );
}

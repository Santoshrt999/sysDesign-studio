"use client";
import { useState } from "react";
import type { Problem } from "@/content/types";
import { Card, Label, StageHeader } from "../ui/primitives";

export function StageDefend({ problem }: { problem: Problem }) {
  const [revealed, setRevealed] = useState<Set<number>>(new Set());
  const toggle = (i: number) => setRevealed((s) => { const n = new Set(s); if (n.has(i)) n.delete(i); else n.add(i); return n; });
  return (
    <div>
      <StageHeader n={7} title="Defend the design" question="Trade-offs, weak points, follow-ups, and the mistakes interviewers watch for." />

      <h3 className="mb-3 font-semibold text-stone-800">Trade-off table</h3>
      <div className="mb-10 overflow-x-auto rounded-xl border border-stone-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-stone-50 text-left text-[11px] uppercase tracking-wider text-stone-500">
            <tr><th className="p-3">Decision</th><th className="p-3">Alternative</th><th className="p-3">Why we chose this</th><th className="p-3">When we'd switch</th></tr>
          </thead>
          <tbody>
            {problem.tradeOffs.map((t) => (
              <tr key={t.decision} className="border-t border-stone-100 align-top">
                <td className="p-3 font-medium text-stone-900">{t.decision}</td>
                <td className="p-3 text-stone-500">{t.alternative}</td>
                <td className="p-3 text-stone-700">{t.why}</td>
                <td className="p-3 text-stone-600">{t.whenToSwitch}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h3 className="mb-3 font-semibold text-stone-800">Bottlenecks & single points of failure</h3>
      <div className="mb-10 grid gap-3 md:grid-cols-2">
        {problem.bottlenecks.map((b) => (
          <Card key={b.item} className="!p-4">
            <div className="font-medium text-amber-800">⚠ {b.item}</div>
            <div className="mt-1 text-sm text-stone-600">→ {b.mitigation}</div>
          </Card>
        ))}
      </div>

      <h3 className="mb-1 font-semibold text-stone-800">Interviewer follow-ups</h3>
      <p className="mb-3 text-sm text-stone-500">Think of your answer first, then reveal the model answer.</p>
      <div className="mb-10 space-y-2">
        {problem.followUps.map((f, i) => (
          <div key={f.question} className="rounded-xl border border-stone-200 bg-white">
            <button onClick={() => toggle(i)} className="flex w-full items-center justify-between px-5 py-3 text-left">
              <span className="font-medium text-stone-800">“{f.question}”</span>
              <span className="ml-4 shrink-0 text-sm text-indigo-600">{revealed.has(i) ? "Hide" : "Reveal answer"}</span>
            </button>
            {revealed.has(i) && (
              <ul className="list-disc space-y-1 border-t border-stone-100 px-5 py-3 pl-9 text-sm text-stone-700">{f.answer.map((a) => <li key={a}>{a}</li>)}</ul>
            )}
          </div>
        ))}
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <Label tone="amber">Common candidate mistakes</Label>
          <ul className="list-disc space-y-1 pl-5 text-sm text-stone-700">{problem.mistakes.map((m) => <li key={m}>{m}</li>)}</ul>
        </Card>
        <Card>
          <Label tone="red">Red flags interviewers notice</Label>
          <ul className="list-disc space-y-1 pl-5 text-sm text-stone-700">{problem.redFlags.map((m) => <li key={m}>{m}</li>)}</ul>
        </Card>
      </div>
    </div>
  );
}

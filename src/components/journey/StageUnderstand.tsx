"use client";
import { useState } from "react";
import type { Problem } from "@/content/types";
import { Card, Label, StageHeader } from "../ui/primitives";

export function StageUnderstand({ problem }: { problem: Problem }) {
  const [open, setOpen] = useState<number | null>(0);
  const r = problem.requirements;
  return (
    <div>
      <StageHeader n={1} title="Understand the problem" question="What exactly are we building, and what would change the design?" />

      <div className="mb-8 rounded-xl bg-stone-900 p-6 text-stone-100">
        <Label tone="amber">Interviewer</Label>
        <p className="text-lg leading-relaxed">“{problem.interviewQuestion}”</p>
      </div>

      <h3 className="mb-3 font-semibold text-stone-800">Clarifying questions a strong candidate asks</h3>
      <div className="mb-10 space-y-2">
        {problem.clarifyingQuestions.map((q, i) => (
          <div key={q.question} className="overflow-hidden rounded-xl border border-stone-200 bg-white">
            <button onClick={() => setOpen(open === i ? null : i)} className="flex w-full items-center gap-3 px-5 py-3 text-left hover:bg-stone-50">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-indigo-100 text-xs font-semibold text-indigo-700">{i + 1}</span>
              <span className="flex-1 font-medium text-stone-800">{q.question}</span>
              <span className="text-stone-400">{open === i ? "−" : "+"}</span>
            </button>
            {open === i && (
              <div className="grid gap-4 border-t border-stone-100 px-5 py-4 md:grid-cols-3">
                <div><Label>Why it matters</Label><p className="text-sm text-stone-600">{q.whyItMatters}</p></div>
                <div><Label tone="amber">Interviewer answers</Label><p className="text-sm text-stone-700">{q.answer}</p></div>
                <div><Label tone="green">How it changes the design</Label><p className="text-sm text-stone-700">{q.designImpact}</p></div>
              </div>
            )}
          </div>
        ))}
      </div>

      <h3 className="mb-3 font-semibold text-stone-800">Agreed scope</h3>
      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <Label tone="indigo">Functional</Label>
          <ul className="list-disc space-y-1 pl-4 text-sm text-stone-700">{r.functional.map((f) => <li key={f}>{f}</li>)}</ul>
        </Card>
        <Card className="lg:col-span-2">
          <Label tone="indigo">Non-functional</Label>
          <table className="w-full text-sm">
            <tbody>
              {r.nonFunctional.map((n) => (
                <tr key={n.name} className="border-t border-stone-100 align-top first:border-0">
                  <td className="py-1.5 pr-3 font-medium text-stone-800">{n.name}</td>
                  <td className="py-1.5 pr-3 text-stone-700">{n.target}</td>
                  <td className="py-1.5 text-stone-500">{n.why}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
        <Card className="lg:col-span-3">
          <Label tone="red">Explicitly out of scope</Label>
          <div className="flex flex-wrap gap-2">{r.outOfScope.map((o) => <span key={o} className="rounded-full bg-stone-100 px-3 py-1 text-sm text-stone-600">{o}</span>)}</div>
        </Card>
      </div>
    </div>
  );
}

"use client";
import { useState } from "react";
import type { Problem } from "@/content/types";
import { Card, Label, OptionCard, SayIt, StageHeader } from "../ui/primitives";

export function StageDeepDives({ problem }: { problem: Problem }) {
  const [active, setActive] = useState(problem.deepDives[0]?.id);
  const d = problem.deepDives.find((x) => x.id === active) ?? problem.deepDives[0];
  return (
    <div>
      <StageHeader n={6} title="Deep dives" question="The components an interviewer will drill into." />
      <div className="mb-6 flex flex-wrap gap-2">
        {problem.deepDives.map((x) => (
          <button key={x.id} onClick={() => setActive(x.id)} className={`rounded-lg border px-4 py-2 text-sm ${x.id === d.id ? "border-stone-900 bg-stone-900 text-white" : "border-stone-200 bg-white text-stone-700"}`}>
            {x.title}
          </button>
        ))}
      </div>
      <div className="space-y-5">
        <div className="rounded-xl bg-stone-900 p-5 text-stone-100">
          <Label tone="amber">Interviewer drills in</Label>
          <p className="text-lg">“{d.question}”</p>
        </div>
        <Card>
          <Label>Context & constraints</Label>
          <ul className="list-disc space-y-1 pl-5 text-stone-700">{d.context.map((c) => <li key={c}>{c}</li>)}</ul>
        </Card>
        <div>
          <Label>Alternatives</Label>
          <div className="grid gap-3 md:grid-cols-2">{d.options.map((o) => <OptionCard key={o.name} option={o} />)}</div>
        </div>
        <div className="rounded-lg border-l-4 border-emerald-500 bg-emerald-50 px-4 py-3">
          <Label tone="green">Recommendation</Label>
          <p className="text-stone-800">{d.recommendation}</p>
        </div>
        <SayIt>{d.sayIt}</SayIt>
      </div>
    </div>
  );
}

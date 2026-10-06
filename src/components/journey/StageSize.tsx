import type { Problem } from "@/content/types";
import { Label, StageHeader } from "../ui/primitives";

export function StageSize({ problem }: { problem: Problem }) {
  return (
    <div>
      <StageHeader n={2} title="Size the problem" question="Which numbers force which design decisions?" />
      <div className="grid gap-4 md:grid-cols-2">
        {problem.estimates.map((e) => (
          <div key={e.title} className="flex flex-col rounded-xl border border-stone-200 bg-white">
            <div className="px-5 pt-4">
              <Label>{e.title}</Label>
              <div className="space-y-1 font-mono text-[13px] text-stone-600">
                {e.reasoning.map((r) => <div key={r}>→ {r}</div>)}
              </div>
              <div className="mt-3 text-lg font-semibold text-stone-900">{e.result}</div>
            </div>
            <div className="mt-4 flex-1 rounded-b-xl border-t border-emerald-100 bg-emerald-50/60 px-5 py-3">
              <Label tone="green">So what?</Label>
              <p className="text-sm text-stone-700">{e.soWhat}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

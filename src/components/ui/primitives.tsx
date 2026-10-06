import type { ReactNode } from "react";
import type { Option } from "@/content/types";

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-xl border border-stone-200 bg-white p-5 ${className}`}>{children}</div>;
}

export function Label({ children, tone = "stone" }: { children: ReactNode; tone?: "stone" | "red" | "green" | "amber" | "indigo" }) {
  const tones = {
    stone: "text-stone-500",
    red: "text-red-600",
    green: "text-emerald-700",
    amber: "text-amber-700",
    indigo: "text-indigo-600",
  };
  return <div className={`mb-1 text-[11px] font-semibold uppercase tracking-wider ${tones[tone]}`}>{children}</div>;
}

export function StageHeader({ n, title, question }: { n: number; title: string; question: string }) {
  return (
    <div className="mb-6">
      <div className="text-xs font-semibold uppercase tracking-widest text-indigo-600">Stage {n}</div>
      <h2 className="mt-1 text-2xl font-semibold text-stone-900">{title}</h2>
      <p className="mt-1 text-stone-500">{question}</p>
    </div>
  );
}

/** "What I'd say in the interview" callout */
export function SayIt({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-lg border-l-4 border-indigo-400 bg-indigo-50 px-4 py-3">
      <Label tone="indigo">Say it in the interview</Label>
      <p className="italic text-stone-700">“{children}”</p>
    </div>
  );
}

export function OptionCard({ option }: { option: Option }) {
  return (
    <div className={`rounded-lg border p-3 ${option.chosen ? "border-emerald-400 bg-emerald-50/50" : "border-stone-200 bg-white"}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="font-medium text-stone-800">{option.name}</div>
        {option.chosen && <span className="shrink-0 rounded bg-emerald-500 px-1.5 py-0.5 text-[10px] font-bold text-white">CHOSEN</span>}
      </div>
      <div className="mt-2 grid gap-2 text-sm sm:grid-cols-2">
        <ul className="space-y-0.5">
          {option.pros.map((p) => (
            <li key={p} className="text-stone-600"><span className="text-emerald-600">+ </span>{p}</li>
          ))}
        </ul>
        <ul className="space-y-0.5">
          {option.cons.map((c) => (
            <li key={c} className="text-stone-600"><span className="text-red-500">− </span>{c}</li>
          ))}
        </ul>
      </div>
      <div className={`mt-2 text-sm ${option.chosen ? "text-emerald-800" : "text-stone-500"}`}>{option.verdict}</div>
    </div>
  );
}

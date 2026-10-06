// Author: Santosh Goteti
import Link from "next/link";
import { listProblems } from "@/content/registry";

const SECTIONS = ["The Framework", "Building Blocks", "Decision Trees", "Scaling Cheat Sheet", "Practice Mode"];

export default function Home() {
  const problems = listProblems();
  return (
    <main className="mx-auto max-w-6xl px-6 py-12">
      <h1 className="text-3xl font-semibold text-stone-900">SysDesign Studio</h1>
      <p className="mt-2 max-w-2xl text-stone-600">
        Learn to <em>think</em> through system design interviews. Every problem is a design journey, and every screen answers three questions:
      </p>
      <div className="mt-4 flex flex-wrap gap-2 text-sm">
        {["What happens here?", "Why is it designed this way?", "What breaks next?"].map((q) => (
          <span key={q} className="rounded-full bg-indigo-50 px-3 py-1 text-indigo-700">{q}</span>
        ))}
      </div>

      <h2 className="mb-3 mt-10 text-sm font-semibold uppercase tracking-wider text-stone-500">Problems</h2>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {problems.map((p) =>
          p.status === "ready" ? (
            <Link key={p.slug} href={`/problems/${p.slug}`} className="group rounded-xl border border-stone-200 bg-white p-5 transition hover:border-indigo-300 hover:shadow-md">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-stone-900 group-hover:text-indigo-700">{p.title}</span>
                <span className="text-xs text-stone-400">{p.difficulty}</span>
              </div>
              <p className="mt-1 text-sm text-stone-600">{p.tagline}</p>
              <div className="mt-3 text-sm font-medium text-indigo-600">Start journey →</div>
            </Link>
          ) : (
            <div key={p.slug} className="rounded-xl border border-dashed border-stone-200 p-5 opacity-60">
              <div className="flex items-center justify-between">
                <span className="font-medium text-stone-700">{p.title}</span>
                <span className="text-[10px] uppercase tracking-wider text-stone-400">planned</span>
              </div>
              <p className="mt-1 text-sm text-stone-500">{p.tagline}</p>
            </div>
          ),
        )}
      </div>

      <h2 className="mb-3 mt-10 text-sm font-semibold uppercase tracking-wider text-stone-500">Coming next</h2>
      <div className="flex flex-wrap gap-2">
        {SECTIONS.map((s) => <span key={s} className="rounded-lg border border-dashed border-stone-300 px-3 py-1.5 text-sm text-stone-500">{s}</span>)}
      </div>
    </main>
  );
}

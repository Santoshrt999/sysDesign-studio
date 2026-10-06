// Author: Santosh Goteti
import Link from "next/link";
import { listProblems } from "@/content/registry";

const SECTIONS = ["The Framework", "Building Blocks", "Decision Trees", "Scaling Cheat Sheet", "Practice Mode"];

const ABOUT_POINTS = [
  { title: "Design reasoning", text: "Move beyond memorizing patterns and explain why a system changes as traffic, failures, and constraints evolve." },
  { title: "Trade-offs", text: "See the real decision points: scalability, consistency, cost, latency, and operational complexity." },
  { title: "Failure analysis", text: "Learn what breaks first, which assumptions fail under load, and what to do next." },
];

export default function Home() {
  const problems = listProblems();
  return (
    <main className="mx-auto max-w-6xl px-6 py-12">
      <section className="rounded-3xl border border-stone-200 bg-gradient-to-br from-indigo-50 via-white to-stone-100 p-8 shadow-sm">
        <div className="flex flex-col gap-8 lg:flex-row lg:items-center lg:justify-between">
          <div className="max-w-2xl">
            <span className="inline-flex rounded-full border border-indigo-200 bg-indigo-50 px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-indigo-700">
              System design learning platform
            </span>
            <h1 className="mt-4 text-4xl font-semibold tracking-tight text-stone-900 sm:text-5xl">SysDesign Studio</h1>
            <p className="mt-4 text-lg text-stone-600">
              Learn to think in systems: why components exist, how designs evolve, and what breaks under pressure.
            </p>
            <div className="mt-5 flex flex-wrap gap-2 text-sm">
              {["What happens here?", "Why is it designed this way?", "What breaks next?"].map((q) => (
                <span key={q} className="rounded-full bg-white px-3 py-1.5 text-indigo-700 shadow-sm ring-1 ring-stone-200">{q}</span>
              ))}
            </div>
          </div>

          <div className="w-full max-w-md rounded-2xl border border-stone-200 bg-white p-4 shadow-sm">
            <div className="rounded-xl bg-stone-900 p-4 text-left text-white">
              <div className="text-xs uppercase tracking-[0.2em] text-stone-300">Interview flow</div>
              <div className="mt-3 space-y-2 text-sm text-stone-200">
                <div>Understand → Size → Start simple</div>
                <div>Evolve → Flows → Deep dives</div>
                <div>Defend</div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="mt-12">
        <h2 className="text-sm font-semibold uppercase tracking-[0.18em] text-stone-500">About</h2>
        <div className="mt-4 grid gap-4 md:grid-cols-3">
          {ABOUT_POINTS.map((point) => (
            <div key={point.title} className="rounded-2xl border border-stone-200 bg-white p-5 shadow-sm">
              <div className="text-lg font-semibold text-stone-900">{point.title}</div>
              <p className="mt-2 text-sm leading-6 text-stone-600">{point.text}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="mt-12">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-[0.18em] text-stone-500">Problems</h2>
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
      </section>

      <section className="mt-12">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-[0.18em] text-stone-500">Coming next</h2>
        <div className="flex flex-wrap gap-2">
          {SECTIONS.map((s) => <span key={s} className="rounded-lg border border-dashed border-stone-300 px-3 py-1.5 text-sm text-stone-500">{s}</span>)}
        </div>
      </section>
    </main>
  );
}

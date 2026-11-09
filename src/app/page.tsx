// Author: Santosh Goteti
import Link from "next/link";
import { getProblem, listProblems, readySlugs } from "@/content/registry";
import { Hero, type HeroStats } from "@/components/home/Hero";

const SECTIONS = ["The Framework", "Building Blocks", "Decision Trees", "Scaling Cheat Sheet", "Practice Mode"];

const ABOUT_POINTS = [
  { title: "Design reasoning", text: "Move beyond memorizing patterns and explain why a system changes as traffic, failures, and constraints evolve." },
  { title: "Trade-offs", text: "See the real decision points: scalability, consistency, cost, latency, and operational complexity." },
  { title: "Failure analysis", text: "Learn what breaks first, which assumptions fail under load, and what to do next." },
];

const STAGES = ["Understand", "Size", "Start simple", "Evolve", "Flows", "Deep dives", "Defend"];

/** Counted from content, so the numbers grow as problems are added. */
function heroData() {
  const ready = readySlugs().flatMap((s) => getProblem(s) ?? []);
  const stats: HeroStats = {
    problems: ready.length,
    steps: ready.reduce((n, p) => n + p.evolution.length, 0),
    flows: ready.reduce((n, p) => n + p.flows.length, 0),
    failures: ready.reduce((n, p) => n + p.flows.filter((f) => f.kind === "failure").length, 0),
  };
  const titles = Object.fromEntries(ready.map((p) => [p.slug, p.title]));
  return { stats, titles, first: { slug: ready[0].slug, title: ready[0].title } };
}

export default function Home() {
  const problems = listProblems();
  const { stats, titles, first } = heroData();
  return (
    <>
      <Hero stats={stats} first={first} titles={titles} />

      <main className="mx-auto max-w-6xl px-6 py-14">
        <section id="problems" className="scroll-mt-6">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold uppercase tracking-[0.18em] text-stone-500">Problems</h2>
              <p className="mt-1 text-stone-600">Each one walks the same seven stages an interview does.</p>
            </div>
            <ol className="flex flex-wrap gap-1.5 text-xs text-stone-500">
              {STAGES.map((s, i) => (
                <li key={s} className="rounded-full bg-stone-100 px-2.5 py-1"><span className="text-stone-400">{i + 1}</span> {s}</li>
              ))}
            </ol>
          </div>
          <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {problems.map((p) =>
              p.status === "ready" ? (
                <Link key={p.slug} href={`/problems/${p.slug}`} className="reveal group rounded-xl border border-stone-200 bg-white p-5 transition hover:-translate-y-0.5 hover:border-indigo-300 hover:shadow-lg hover:shadow-indigo-100">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-stone-900 group-hover:text-indigo-700">{p.title}</span>
                    <span className="text-xs text-stone-400">{p.difficulty}</span>
                  </div>
                  <p className="mt-1 text-sm text-stone-600">{p.tagline}</p>
                  <div className="mt-3 text-sm font-medium text-indigo-600">Start journey <span className="inline-block transition group-hover:translate-x-1">→</span></div>
                </Link>
              ) : (
                <div key={p.slug} className="reveal rounded-xl border border-dashed border-stone-200 p-5 opacity-60">
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

        <section className="mt-16">
          <h2 className="text-sm font-semibold uppercase tracking-[0.18em] text-stone-500">About</h2>
          <div className="mt-4 grid gap-4 md:grid-cols-3">
            {ABOUT_POINTS.map((point) => (
              <div key={point.title} className="reveal rounded-2xl border border-stone-200 bg-white p-5 shadow-sm">
                <div className="text-lg font-semibold text-stone-900">{point.title}</div>
                <p className="mt-2 text-sm leading-6 text-stone-600">{point.text}</p>
              </div>
            ))}
          </div>
          <Link href="/about" className="mt-4 inline-block text-sm font-medium text-indigo-600 hover:text-indigo-800">
            More about the project and its author →
          </Link>
        </section>

        <section className="mt-12">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-[0.18em] text-stone-500">Coming next</h2>
          <div className="flex flex-wrap gap-2">
            {SECTIONS.map((s) => <span key={s} className="rounded-lg border border-dashed border-stone-300 px-3 py-1.5 text-sm text-stone-500">{s}</span>)}
          </div>
        </section>
      </main>
    </>
  );
}

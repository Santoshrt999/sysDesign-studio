// Author: Santosh Goteti
import type { Metadata } from "next";
import Link from "next/link";
import { listProblems } from "@/content/registry";

export const metadata: Metadata = {
  title: "About · SysDesign Studio",
  description: "Who built SysDesign Studio, why, and how it teaches system design reasoning.",
};

const REPO_URL = "https://github.com/Santoshrt999/sysDesign-studio";
const LINKEDIN_URL = "https://www.linkedin.com/in/santoshgoteti/";

const STAGES = [
  { name: "Understand", text: "Pin down requirements and scope before drawing anything." },
  { name: "Size", text: "Back-of-envelope numbers, each ending in a design implication." },
  { name: "Start simple", text: "The smallest design that works, and how its parts talk to each other." },
  { name: "Evolve", text: "Problem → evidence → options → decision → new risks, one step at a time." },
  { name: "Flows", text: "Animated write, read and failure paths over the final diagram." },
  { name: "Deep dives", text: "The two or three parts an interviewer will push on." },
  { name: "Defend", text: "Trade-offs, follow-up questions and common mistakes." },
];

const PRINCIPLES = [
  "Every component is justified by a stated problem with numbers behind it.",
  "Every decision lists the alternatives and why each one lost or won.",
  "Every design is shown evolving from a simple start, not as a finished picture.",
  "Failure paths (node death, stampedes, region loss, duplicates) are first-class, not an afterthought.",
];

const STACK = ["Next.js 15", "React 19", "TypeScript", "Tailwind CSS", "React Flow", "Framer Motion", "Mermaid"];

export default function AboutPage() {
  const problems = listProblems();
  const ready = problems.filter((p) => p.status === "ready").length;

  return (
    <main className="mx-auto max-w-4xl px-6 py-12">
      <Link href="/" className="text-sm text-stone-500 hover:text-indigo-700">← Back to problems</Link>

      <section className="mt-6 rounded-3xl border border-stone-200 bg-gradient-to-br from-indigo-50 via-white to-stone-100 p-8 shadow-sm">
        <span className="inline-flex rounded-full border border-indigo-200 bg-indigo-50 px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-indigo-700">
          About
        </span>
        <h1 className="mt-4 text-4xl font-semibold tracking-tight text-stone-900">SysDesign Studio</h1>
        <p className="mt-4 max-w-2xl text-lg text-stone-600">
          A learning app for system design interviews that teaches the reasoning behind a design: why each component
          exists, how the design evolves under load, and what breaks next.
        </p>
      </section>

      <section className="mt-10 rounded-2xl border border-stone-200 bg-white p-6 shadow-sm">
        <h2 className="text-sm font-semibold uppercase tracking-[0.18em] text-stone-500">Designed &amp; built by</h2>
        <div className="mt-3 text-2xl font-semibold text-stone-900">Santosh Goteti</div>
        <p className="mt-2 text-sm leading-6 text-stone-600">
          SysDesign Studio is designed, written and maintained by Santosh Goteti. The content, problem walkthroughs and
          interface are all part of the same project.
        </p>
        <div className="mt-4 flex flex-wrap gap-3 text-sm">
          <a
            href={REPO_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-lg border border-stone-200 px-3 py-1.5 font-medium text-indigo-700 hover:border-indigo-300 hover:bg-indigo-50"
          >
            Source on GitHub →
          </a>
          <a
            href={LINKEDIN_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-lg border border-stone-200 px-3 py-1.5 font-medium text-indigo-700 hover:border-indigo-300 hover:bg-indigo-50"
          >
            Connect on LinkedIn →
          </a>
        </div>
      </section>

      <section className="mt-10">
        <h2 className="text-sm font-semibold uppercase tracking-[0.18em] text-stone-500">Why it exists</h2>
        <p className="mt-3 leading-7 text-stone-700">
          System design interviews aren&apos;t won by drawing a big diagram. They&apos;re won by explaining why each box
          is there, what you considered instead, and what fails first as traffic grows. Most prep material shows the
          finished architecture. This app walks through how you get there, one justified decision at a time.
        </p>
        <ul className="mt-4 space-y-2">
          {PRINCIPLES.map((p) => (
            <li key={p} className="flex gap-3 text-sm leading-6 text-stone-700">
              <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-indigo-500" />
              {p}
            </li>
          ))}
        </ul>
      </section>

      <section className="mt-10">
        <h2 className="text-sm font-semibold uppercase tracking-[0.18em] text-stone-500">How each problem is taught</h2>
        <ol className="mt-4 grid gap-3 sm:grid-cols-2">
          {STAGES.map((s, i) => (
            <li key={s.name} className="rounded-xl border border-stone-200 bg-white p-4">
              <div className="text-xs font-semibold uppercase tracking-widest text-indigo-600">Stage {i + 1}</div>
              <div className="mt-1 font-semibold text-stone-900">{s.name}</div>
              <p className="mt-1 text-sm text-stone-600">{s.text}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="mt-10 grid gap-4 sm:grid-cols-2">
        <div className="rounded-xl border border-stone-200 bg-white p-5">
          <h2 className="text-sm font-semibold uppercase tracking-[0.18em] text-stone-500">Status</h2>
          <p className="mt-3 text-sm leading-6 text-stone-700">
            {ready} of {problems.length} problems are fully written. More problems, a framework page, building blocks and
            a practice mode are on the way.
          </p>
        </div>
        <div className="rounded-xl border border-stone-200 bg-white p-5">
          <h2 className="text-sm font-semibold uppercase tracking-[0.18em] text-stone-500">Built with</h2>
          <div className="mt-3 flex flex-wrap gap-2">
            {STACK.map((t) => (
              <span key={t} className="rounded-md bg-stone-100 px-2 py-1 text-xs text-stone-700">{t}</span>
            ))}
          </div>
        </div>
      </section>

      <p className="mt-10 text-xs text-stone-500">© 2026 Santosh Goteti. Released under the MIT License.</p>
    </main>
  );
}

"use client";
import Link from "next/link";
import { useState } from "react";
import { daysUntil, isCompleted, localDay, streak, type ProblemOutline } from "@/lib/progress/logic";
import { useProgress } from "@/lib/progress/ProgressProvider";
import { ContinueHero } from "./ContinueHero";
import { ProblemRow, type RowItem } from "./ProblemRow";
import { ProfileSetup } from "./ProfileSetup";
import { ThemeToggle } from "./ThemeToggle";
import { BackupControls } from "./BackupControls";

/** Netflix-style profile. The ☀️/🌙 theme applies to this page only (a .dark wrapper; the rest of the app stays light). */
export function ProfileView({ problems }: { problems: ProblemOutline[] }) {
  const { status, mode, file, saveProfile, resetProblem, setTheme } = useProgress();
  const [editing, setEditing] = useState(false);
  const dark = (file?.profile.theme ?? "dark") === "dark";

  let body: React.ReactNode;
  if (status === "loading") {
    body = <div className="py-24 text-center text-stone-400">Loading your profile…</div>;
  } else if (status === "offline") {
    body = (
      <div className="mx-auto max-w-md py-24 text-center text-stone-600 dark:text-stone-300">
        {mode === "file" ? (
          <>Your profile is saved by the local server. Start the app with <code className="rounded bg-stone-200 px-1 dark:bg-stone-800">npm run dev</code> and reload this page.</>
        ) : (
          <>This browser is blocking site storage (private browsing, or cookies and site data turned off), so progress can&apos;t be saved here. Allow site data for this site and reload.</>
        )}
      </div>
    );
  } else if (!file || editing) {
    body = (
      <div className="py-16">
        <ProfileSetup
          initial={file ? file.profile : undefined}
          onSave={(v) => { saveProfile(v); setEditing(false); }}
          onCancel={file ? () => setEditing(false) : undefined}
        />
      </div>
    );
  } else {
    const today = localDay(new Date());
    // Only registered, ready problems; progress for unknown slugs is ignored.
    const items: Required<RowItem>[] = problems
      .filter((p) => file.problems[p.slug])
      .map((p) => ({ problem: p, progress: file.problems[p.slug] }))
      .sort((a, b) => b.progress.lastVisited.localeCompare(a.progress.lastVisited));
    const inProgress = items.filter((i) => !isCompleted(i.progress));
    const completed = items.filter((i) => isCompleted(i.progress));
    const notStarted: RowItem[] = problems.filter((p) => !file.problems[p.slug]).map((p) => ({ problem: p }));
    const hero = inProgress[0] ?? completed[0];
    const days = streak(file.activityDays, today);
    const until = daysUntil(file.profile.interviewDate, today);

    body = (
      <>
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight text-stone-900 dark:text-stone-50">Welcome back, {file.profile.name}</h1>
            <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm text-stone-500 dark:text-stone-400">
              {file.profile.role && <span>{file.profile.role}</span>}
              {days > 0 && <span>🔥 {days}-day streak</span>}
              {until !== null && <span>🎯 {until === 0 ? "Interview today" : `Interview in ${until} day${until === 1 ? "" : "s"}`}</span>}
              <span>{completed.length} of {problems.length} problems done</span>
            </div>
          </div>
          <button onClick={() => setEditing(true)} className="text-sm text-stone-500 hover:text-stone-900 dark:text-stone-400 dark:hover:text-stone-100">Edit profile</button>
        </div>

        <div className="mt-6">
          {hero ? (
            <ContinueHero problem={hero.problem} progress={hero.progress} today={today} />
          ) : (
            <section className="rounded-3xl border border-indigo-200 bg-gradient-to-br from-indigo-100 via-white to-stone-100 p-8 dark:border-indigo-900/60 dark:from-indigo-950 dark:via-stone-900 dark:to-stone-950">
              <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-indigo-700 dark:text-indigo-300">Your first problem</div>
              <h2 className="mt-2 text-3xl font-semibold text-stone-900 dark:text-stone-50">{problems[0]?.title}</h2>
              <p className="mt-1 text-stone-600 dark:text-stone-300">{problems[0]?.tagline}</p>
              {problems[0] && (
                <Link href={`/problems/${problems[0].slug}`} className="mt-6 inline-flex rounded-lg bg-stone-900 px-6 py-2.5 font-semibold text-white hover:bg-stone-700 dark:bg-stone-50 dark:text-stone-900">
                  ▶ Start with {problems[0].title}
                </Link>
              )}
            </section>
          )}
        </div>

        <ProblemRow title="Continue learning" items={inProgress} today={today} onReset={resetProblem} />
        <ProblemRow title="Completed" items={completed} today={today} onReset={resetProblem} />
        <ProblemRow title="Not started" items={notStarted} today={today} onReset={resetProblem} />

        <section className="mt-12 rounded-xl border border-stone-200 p-4 dark:border-stone-800">
          <h3 className="text-xs font-semibold uppercase tracking-[0.18em] text-stone-500 dark:text-stone-400">Your data</h3>
          <p className="mt-1 text-sm text-stone-600 dark:text-stone-300">
            {mode === "browser"
              ? "Your progress is saved only in this browser, never on a server. Export a backup to keep it safe, or to move it to another device or browser."
              : "Your progress is saved to data/profile.json on this machine."}
          </p>
          <div className="mt-3"><BackupControls /></div>
        </section>
      </>
    );
  }

  return (
    <div className={dark ? "dark" : ""}>
      <div className="min-h-screen bg-stone-50 text-stone-900 dark:bg-stone-950 dark:text-stone-100">
        <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
          <nav className="mb-6 flex items-center justify-between text-sm">
            <Link href="/" className="text-stone-500 hover:text-stone-900 dark:text-stone-400 dark:hover:text-stone-100">← Problems</Link>
            {file && status === "ready" && <ThemeToggle theme={file.profile.theme} onChange={setTheme} />}
          </nav>
          {body}
        </div>
      </div>
    </div>
  );
}

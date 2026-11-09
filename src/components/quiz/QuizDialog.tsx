"use client";
// The quiz: pick a level → 5 questions (choose, check, see why each option wins or loses) → results.
import { useEffect, useMemo, useState } from "react";
import type { Problem, QuizQuestion } from "@/content/types";
import { useProgress } from "@/lib/progress/ProgressProvider";
import { STAGE_NAMES } from "@/lib/progress/logic";
import type { Position, QuizLevel, QuizProgress } from "@/lib/progress/types";
import {
  LEVEL_NAMES, QUIZ_SIZE, UNLOCK_STAGE, attemptsAt, bestScore, isUnlocked, lastAttempt, pickQuiz, recordAttempt, shuffle, unlockProgress,
} from "@/lib/quiz/logic";

/** Without a profile, history lives here for the session, so "New quiz" still rotates questions. */
const sessionHistory = new Map<string, QuizProgress>();

const LEVELS: QuizLevel[] = ["core", "interviewer"];
const LEVEL_BLURB: Record<QuizLevel, string> = {
  core: "Numbers, decisions, sync vs queue, and what breaks in the flows.",
  interviewer: "Pushback from the deep dives and trade-offs: defend your choices.",
};

interface Session {
  level: QuizLevel;
  questions: QuizQuestion[];
  /** Per question: option indexes in display order */
  order: number[][];
}

export function refLabel(problem: Problem, ref: Position): string {
  const base = `Stage ${ref.stage + 1}, ${STAGE_NAMES[ref.stage] ?? ""}`;
  if (ref.evolveStep) {
    const s = problem.evolution[ref.evolveStep - 1];
    if (s) return `${base}: ${s.version} ${s.title}`;
  }
  if (ref.flowId) {
    const f = problem.flows.find((x) => x.id === ref.flowId);
    if (f) return `${base}: ${f.name}`;
  }
  return base;
}

export function QuizDialog({ problem, onClose, onJump }: { problem: Problem; onClose(): void; onJump(ref: Position): void }) {
  const { status, file, recordQuiz } = useProgress();
  const slug = problem.slug;
  const progress = file?.problems[slug];
  const [localHistory, setLocalHistory] = useState<QuizProgress | undefined>(() => sessionHistory.get(slug));
  const history = file ? progress?.quiz : localHistory;
  const pool = useMemo(() => problem.quiz ?? [], [problem.quiz]);

  const [session, setSession] = useState<Session | null>(null);
  const [idx, setIdx] = useState(0);
  const [selected, setSelected] = useState<number | null>(null);
  const [checked, setChecked] = useState(false);
  const [results, setResults] = useState<boolean[]>([]);
  const finished = !!session && results.length === session.questions.length && idx >= session.questions.length;

  const start = (level: QuizLevel) => {
    const levelPool = pool.filter((q) => q.level === level);
    const ids = pickQuiz(levelPool.map((q) => q.id), history, lastAttempt(history, level)?.ids ?? []);
    const questions = ids.map((id) => levelPool.find((q) => q.id === id)!);
    setSession({ level, questions, order: questions.map((q) => shuffle(q.options.map((_, i) => i))) });
    setIdx(0);
    setSelected(null);
    setChecked(false);
    setResults([]);
  };

  const finish = (all: boolean[]) => {
    if (!session) return;
    const ids = session.questions.map((q) => q.id);
    const attempt = { at: new Date().toISOString(), level: session.level, ids, correct: ids.filter((_, i) => all[i]) };
    if (file) recordQuiz(slug, attempt);
    else {
      const next = recordAttempt(localHistory, attempt);
      sessionHistory.set(slug, next);
      setLocalHistory(next);
    }
  };

  const check = () => {
    if (!session || selected === null || checked) return;
    setChecked(true);
    setResults((r) => [...r, selected === session.questions[idx].answer]);
  };
  const next = () => {
    if (!session) return;
    if (idx === session.questions.length - 1) finish(results);
    setIdx((i) => i + 1);
    setSelected(null);
    setChecked(false);
  };

  // Keyboard: Esc closes, 1–4 choose, Enter checks / continues.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { onClose(); return; }
      if (!session || finished) return;
      const n = Number(e.key);
      if (!checked && n >= 1 && n <= session.order[idx].length) setSelected(session.order[idx][n - 1]);
      if (e.key === "Enter") { e.preventDefault(); if (checked) next(); else check(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // Lock page scroll behind the dialog.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, []);

  const jump = (ref: Position) => { onClose(); onJump(ref); };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-stone-950/50 p-4 backdrop-blur-sm sm:items-center" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`${problem.title} quiz`}
        className="relative w-full max-w-2xl rounded-2xl border border-stone-200 bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-stone-200 px-5 py-3">
          <div className="text-sm font-semibold text-stone-900">
            {problem.title} · {session ? LEVEL_NAMES[session.level] : "Quiz"}
          </div>
          <button onClick={onClose} aria-label="Close quiz" className="rounded px-2 text-lg text-stone-400 hover:bg-stone-100 hover:text-stone-700">×</button>
        </div>

        {!session && (
          <div className="space-y-3 p-5">
            <p className="text-sm text-stone-600">
              {QUIZ_SIZE} questions per attempt. Each new attempt has at least 2 questions you didn&apos;t get last time, and the ones you missed come back.
            </p>
            {LEVELS.map((level) => {
              const count = pool.filter((q) => q.level === level).length;
              if (!count) return null;
              const unlocked = isUnlocked(progress, level);
              const { done, needed } = unlockProgress(progress, level);
              const best = bestScore(history, level);
              const tries = attemptsAt(history, level).length;
              return (
                <div key={level} className={`rounded-xl border p-4 ${unlocked ? "border-indigo-200 bg-indigo-50/40" : "border-stone-200 bg-stone-50"}`}>
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="font-semibold text-stone-900">{unlocked ? "🔓" : "🔒"} {LEVEL_NAMES[level]}</div>
                      <p className="mt-0.5 text-sm text-stone-600">{LEVEL_BLURB[level]}</p>
                      <p className="mt-1 text-xs text-stone-500">
                        {count} questions in the pool
                        {best !== null && ` · best ${best}/${QUIZ_SIZE} · ${tries} attempt${tries === 1 ? "" : "s"}`}
                      </p>
                    </div>
                    {unlocked && (
                      <button onClick={() => start(level)} className="shrink-0 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700">
                        {tries ? "New quiz" : "Start"}
                      </button>
                    )}
                  </div>
                  {!unlocked && (
                    <div className="mt-3">
                      <div className="flex items-center justify-between text-xs text-stone-500">
                        <span>
                          Read through Stage {UNLOCK_STAGE[level] + 1} ({STAGE_NAMES[UNLOCK_STAGE[level]]}) to unlock
                          {status === "ready" && !file && " (needs a profile to track your reading)"}
                        </span>
                        <span>{done}/{needed} stages</span>
                      </div>
                      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-stone-200">
                        <div className="h-full rounded-full bg-indigo-400" style={{ width: `${(done / needed) * 100}%` }} />
                      </div>
                      <button onClick={() => start(level)} className="mt-2 text-xs font-medium text-stone-500 underline-offset-2 hover:text-indigo-700 hover:underline">
                        Peek anyway
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {session && !finished && (() => {
          const q = session.questions[idx];
          const order = session.order[idx];
          return (
            <div className="p-5">
              <div className="flex items-center gap-1.5">
                {session.questions.map((_, i) => (
                  <span
                    key={i}
                    className={`h-1.5 flex-1 rounded-full ${i < results.length ? (results[i] ? "bg-emerald-500" : "bg-rose-500") : i === idx ? "bg-indigo-500" : "bg-stone-200"}`}
                  />
                ))}
              </div>
              <div className="mt-4 text-xs font-medium uppercase tracking-wider text-stone-400">
                Question {idx + 1} of {session.questions.length} · {q.kind.replace(/-/g, " ")}
              </div>
              <p className="mt-1.5 text-[15px] font-medium leading-relaxed text-stone-900">{q.prompt}</p>

              <div className="mt-4 space-y-2">
                {order.map((oi, k) => {
                  const o = q.options[oi];
                  const isAnswer = oi === q.answer;
                  const isPicked = oi === selected;
                  const tone = !checked
                    ? isPicked ? "border-indigo-500 bg-indigo-50 ring-1 ring-indigo-500" : "border-stone-200 hover:border-stone-300 hover:bg-stone-50"
                    : isAnswer ? "border-emerald-500 bg-emerald-50" : isPicked ? "border-rose-400 bg-rose-50" : "border-stone-200 opacity-80";
                  return (
                    <button
                      key={oi}
                      type="button"
                      disabled={checked}
                      onClick={() => setSelected(oi)}
                      className={`block w-full rounded-xl border px-4 py-3 text-left text-sm transition ${tone}`}
                    >
                      <div className="flex gap-3">
                        <span className="mt-px font-mono text-xs text-stone-400">{k + 1}</span>
                        <div className="flex-1">
                          <div className="text-stone-800">
                            {checked && (isAnswer ? "✓ " : isPicked ? "✗ " : "")}{o.text}
                          </div>
                          {checked && (isAnswer || isPicked) && <div className={`mt-1 text-xs leading-relaxed ${isAnswer ? "text-emerald-800" : "text-rose-800"}`}>{o.why}</div>}
                          {checked && !isAnswer && !isPicked && <div className="mt-1 text-xs leading-relaxed text-stone-500">{o.why}</div>}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>

              {checked && (
                <div className="mt-4 rounded-xl bg-stone-50 p-4 text-sm">
                  <div className="font-semibold text-stone-900">{selected === q.answer ? "Right." : "Not quite."}</div>
                  <p className="mt-1 leading-relaxed text-stone-700">{q.explanation}</p>
                  <button onClick={() => jump(q.ref)} className="mt-2 text-xs font-medium text-indigo-600 hover:text-indigo-800">
                    Reread: {refLabel(problem, q.ref)} →
                  </button>
                </div>
              )}

              <div className="mt-5 flex items-center justify-between">
                <span className="text-xs text-stone-400">Keys: 1–4 to choose, Enter to {checked ? "continue" : "check"}</span>
                {!checked ? (
                  <button onClick={check} disabled={selected === null} className="rounded-lg bg-stone-900 px-5 py-2 text-sm font-semibold text-white disabled:opacity-30">
                    Check
                  </button>
                ) : (
                  <button onClick={next} className="rounded-lg bg-stone-900 px-5 py-2 text-sm font-semibold text-white">
                    {idx === session.questions.length - 1 ? "See results" : "Next question →"}
                  </button>
                )}
              </div>
            </div>
          );
        })()}

        {finished && session && (() => {
          const score = results.filter(Boolean).length;
          const total = session.questions.length;
          return (
            <div className="p-5">
              <div className="text-center">
                <div className="font-mono text-5xl font-semibold text-stone-900">{score}/{total}</div>
                <p className="mt-2 text-sm text-stone-600">
                  {score === total ? "Clean sweep. Try the next attempt; it rotates in new questions." : score >= total - 1 ? "Strong. The one you missed comes back next time." : "The ones you missed come back next time. Reread them first."}
                </p>
              </div>
              <ul className="mt-5 divide-y divide-stone-100 rounded-xl border border-stone-200">
                {session.questions.map((q, i) => (
                  <li key={q.id} className="flex items-start gap-3 px-4 py-3 text-sm">
                    <span className={results[i] ? "text-emerald-600" : "text-rose-600"}>{results[i] ? "✓" : "✗"}</span>
                    <div className="flex-1">
                      <div className="text-stone-800">{q.prompt}</div>
                      {!results[i] && (
                        <button onClick={() => jump(q.ref)} className="mt-1 text-xs font-medium text-indigo-600 hover:text-indigo-800">
                          Reread: {refLabel(problem, q.ref)} →
                        </button>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
              <div className="mt-5 flex flex-wrap justify-end gap-2">
                <button onClick={() => setSession(null)} className="rounded-lg px-4 py-2 text-sm text-stone-600 hover:bg-stone-100">All levels</button>
                <button onClick={() => start(session.level)} className="rounded-lg bg-indigo-600 px-5 py-2 text-sm font-semibold text-white hover:bg-indigo-700">New quiz</button>
              </div>
            </div>
          );
        })()}
      </div>
    </div>
  );
}

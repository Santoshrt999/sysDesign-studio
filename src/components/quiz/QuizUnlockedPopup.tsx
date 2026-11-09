"use client";
// Shown the moment a quiz level unlocks while the reader is on the page (e.g. on leaving Stage 5).
import { motion, useReducedMotion } from "framer-motion";
import { useEffect } from "react";
import type { QuizLevel } from "@/lib/progress/types";
import { LEVEL_NAMES, QUIZ_SIZE, UNLOCK_STAGE } from "@/lib/quiz/logic";
import { STAGE_NAMES } from "@/lib/progress/logic";

const BODY: Record<QuizLevel, string> = {
  core: "what breaks next, why an option lost, what the numbers imply, and sync call or queue",
  interviewer: "the pushback an interviewer gives on your deep dives and trade-offs",
};

export function QuizUnlockedPopup({ level, title, onTake, onClose }: { level: QuizLevel; title: string; onTake(): void; onClose(): void }) {
  const reduce = useReducedMotion();
  const stage = UNLOCK_STAGE[level];

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-stone-950/40 p-4 backdrop-blur-sm" onClick={onClose}>
      <motion.div
        role="dialog"
        aria-modal="true"
        aria-labelledby="quiz-unlocked-title"
        initial={reduce ? false : { opacity: 0, scale: 0.9, y: 16 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ type: "spring", stiffness: 320, damping: 24 }}
        onClick={(e) => e.stopPropagation()}
        className="relative w-full max-w-md overflow-hidden rounded-3xl bg-white p-7 text-center shadow-2xl ring-1 ring-indigo-100"
      >
        <div aria-hidden className="pointer-events-none absolute inset-x-0 -top-24 h-48 bg-[radial-gradient(closest-side,rgba(129,140,248,0.35),transparent)]" />
        <motion.div
          aria-hidden
          initial={reduce ? false : { rotate: -20, scale: 0.4 }}
          animate={{ rotate: 0, scale: 1 }}
          transition={{ type: "spring", stiffness: 260, damping: 12, delay: 0.1 }}
          className="relative mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-500 to-violet-500 text-3xl shadow-lg shadow-indigo-300"
        >
          🔓
        </motion.div>
        <div className="relative mt-4 text-xs font-semibold uppercase tracking-[0.2em] text-indigo-600">{title}</div>
        <h2 id="quiz-unlocked-title" className="relative mt-1 text-2xl font-semibold tracking-tight text-stone-900">
          {LEVEL_NAMES[level]} enabled
        </h2>
        <p className="relative mt-2 text-sm leading-relaxed text-stone-600">
          You&apos;ve finished Stage {stage + 1} ({STAGE_NAMES[stage]}). Try {QUIZ_SIZE} questions on {BODY[level]}.
          Every answer links back to what to reread.
        </p>
        <div className="relative mt-6 flex flex-col gap-2 sm:flex-row sm:justify-center">
          <button autoFocus onClick={onTake} className="rounded-xl bg-indigo-600 px-6 py-2.5 font-semibold text-white shadow-sm hover:bg-indigo-700">
            Take the quiz
          </button>
          <button onClick={onClose} className="rounded-xl px-6 py-2.5 font-medium text-stone-600 ring-1 ring-stone-200 hover:bg-stone-50">
            Keep reading
          </button>
        </div>
      </motion.div>
    </div>
  );
}

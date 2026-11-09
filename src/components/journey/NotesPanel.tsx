"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useProgress } from "@/lib/progress/ProgressProvider";

/** "My notes" button + popover for one problem. Autosaves (debounced) into the local profile. */
export function NotesPanel({ slug }: { slug: string }) {
  const { file, status, setNote } = useProgress();
  const saved = file?.problems[slug]?.note ?? "";
  const [open, setOpen] = useState(false);
  const [text, setText] = useState(saved);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Pick up the saved note once the profile has loaded (or after a reset).
  useEffect(() => { if (!open) setText(saved); }, [saved, open]);

  const onChange = (v: string) => {
    setText(v);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setNote(slug, v), 600);
  };
  const close = () => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; if (text !== saved) setNote(slug, text); }
    setOpen(false);
  };

  if (status !== "ready") return null;

  return (
    <div className="relative">
      <button
        onClick={() => (open ? close() : setOpen(true))}
        className={`rounded-full px-3 py-1 text-sm transition ${saved ? "bg-amber-100 text-amber-800 hover:bg-amber-200" : "text-stone-600 hover:bg-stone-200"}`}
      >
        ✎ My notes
      </button>
      {open && (
        <div className="absolute right-0 top-10 z-30 w-[min(22rem,calc(100vw-2rem))] rounded-xl border border-stone-200 bg-white p-3 shadow-lg">
          {file ? (
            <>
              <textarea
                autoFocus
                value={text}
                onChange={(e) => onChange(e.target.value)}
                rows={6}
                placeholder="What do you want to remember about this problem?"
                className="w-full resize-y rounded-lg border border-stone-200 p-2 text-sm text-stone-800 outline-none focus:border-indigo-400"
              />
              <div className="mt-2 flex items-center justify-between text-xs text-stone-400">
                <span>Saved to your profile automatically</span>
                <button onClick={close} className="font-medium text-stone-600 hover:text-stone-900">Done</button>
              </div>
            </>
          ) : (
            <p className="text-sm text-stone-600">
              <Link href="/profile" className="font-medium text-indigo-600 hover:underline">Create a profile</Link> to keep notes and track your progress.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

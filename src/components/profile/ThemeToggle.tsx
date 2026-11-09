"use client";
import type { Theme } from "@/lib/progress/types";

/** ☀️ / 🌙 switch for the profile page only. */
export function ThemeToggle({ theme, onChange }: { theme: Theme; onChange(t: Theme): void }) {
  const dark = theme === "dark";
  return (
    <button
      onClick={() => onChange(dark ? "light" : "dark")}
      aria-label={dark ? "Switch to light theme" : "Switch to dark theme"}
      title={dark ? "Light theme" : "Dark theme"}
      className="flex h-9 w-16 items-center rounded-full border border-stone-300 bg-stone-100 p-1 transition dark:border-stone-700 dark:bg-stone-800"
    >
      <span className={`flex h-7 w-7 items-center justify-center rounded-full bg-white text-base shadow transition-transform dark:bg-stone-950 ${dark ? "translate-x-7" : "translate-x-0"}`}>
        {dark ? "🌙" : "☀️"}
      </span>
    </button>
  );
}

export function ProgressBar({ value, done = false, className = "" }: { value: number; done?: boolean; className?: string }) {
  return (
    <div className={`h-1.5 w-full overflow-hidden rounded-full bg-stone-200 dark:bg-stone-700 ${className}`}>
      <div
        className={`h-full rounded-full ${done ? "bg-emerald-500 dark:bg-emerald-400" : "bg-indigo-500 dark:bg-indigo-300"}`}
        style={{ width: `${Math.round(Math.max(0, Math.min(1, value)) * 100)}%` }}
      />
    </div>
  );
}

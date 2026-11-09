"use client";
import { useRef, useState } from "react";
import { useProgress } from "@/lib/progress/ProgressProvider";
import { isProfileFile } from "@/lib/progress/storage";
import { localDay } from "@/lib/progress/logic";

/** Export / import progress as a JSON file: the backup and "move to another device" story for browser storage. */
export function BackupControls({ importOnly = false }: { importOnly?: boolean }) {
  const { file, replaceFile } = useProgress();
  const input = useRef<HTMLInputElement>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const exportFile = () => {
    if (!file) return;
    const blob = new Blob([JSON.stringify(file, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `sysdesign-studio-progress-${localDay(new Date())}.json`;
    a.click();
    URL.revokeObjectURL(url);
    setMessage({ ok: true, text: "Progress exported." });
  };

  const importFile = async (f: File | undefined) => {
    if (!f) return;
    try {
      if (f.size > 2_000_000) throw new Error("too large");
      const parsed: unknown = JSON.parse(await f.text());
      if (!isProfileFile(parsed)) throw new Error("not a progress file");
      if (file && !window.confirm(`Replace your current progress with the backup for "${parsed.profile.name}"?`)) return;
      replaceFile(parsed);
      setMessage({ ok: true, text: `Imported progress for ${parsed.profile.name}.` });
    } catch {
      setMessage({ ok: false, text: "That file isn't a SysDesign Studio progress backup." });
    } finally {
      if (input.current) input.current.value = "";
    }
  };

  const btn = "rounded-lg px-3 py-1.5 text-sm font-medium ring-1 ring-stone-300 text-stone-700 hover:bg-stone-100 dark:text-stone-200 dark:ring-stone-700 dark:hover:bg-stone-800";

  return (
    <div className="flex flex-wrap items-center gap-2">
      {!importOnly && <button type="button" onClick={exportFile} className={btn}>⬇ Export progress</button>}
      <button type="button" onClick={() => input.current?.click()} className={btn}>⬆ {importOnly ? "Import a backup" : "Import"}</button>
      <input ref={input} type="file" accept="application/json,.json" className="hidden" onChange={(e) => importFile(e.target.files?.[0])} />
      {message && (
        <span role="status" className={`text-sm ${message.ok ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`}>{message.text}</span>
      )}
    </div>
  );
}

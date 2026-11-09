"use client";
import { useState } from "react";
import type { Profile } from "@/lib/progress/types";

interface Props {
  initial?: Pick<Profile, "name" | "role" | "interviewDate">;
  onSave(values: { name: string; role?: string; interviewDate?: string }): void;
  onCancel?(): void;
}

/** First-run setup and "Edit profile". No password: this is a local, single-user profile. */
export function ProfileSetup({ initial, onSave, onCancel }: Props) {
  const [name, setName] = useState(initial?.name ?? "");
  const [role, setRole] = useState(initial?.role ?? "");
  const [interviewDate, setInterviewDate] = useState(initial?.interviewDate ?? "");
  const editing = !!initial;

  const field = "mt-1 w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-stone-900 outline-none focus:border-indigo-500 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-100";

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!name.trim()) return;
        onSave({ name: name.trim(), role: role.trim() || undefined, interviewDate: interviewDate || undefined });
      }}
      className="mx-auto w-full max-w-md rounded-2xl border border-stone-200 bg-white p-6 shadow-sm dark:border-stone-800 dark:bg-stone-900"
    >
      <h1 className="text-2xl font-semibold text-stone-900 dark:text-stone-50">{editing ? "Edit profile" : "Create your profile"}</h1>
      <p className="mt-1 text-sm text-stone-500 dark:text-stone-400">
        {editing ? "Update your details." : "Stored only on this laptop. No password: it's just so the app can pick up where you left off."}
      </p>
      <label className="mt-5 block text-sm font-medium text-stone-700 dark:text-stone-300">
        Name
        <input autoFocus required value={name} onChange={(e) => setName(e.target.value)} className={field} placeholder="Santosh" />
      </label>
      <label className="mt-4 block text-sm font-medium text-stone-700 dark:text-stone-300">
        Target role <span className="font-normal text-stone-400">(optional)</span>
        <input value={role} onChange={(e) => setRole(e.target.value)} className={field} placeholder="Senior Backend Engineer" />
      </label>
      <label className="mt-4 block text-sm font-medium text-stone-700 dark:text-stone-300">
        Interview date <span className="font-normal text-stone-400">(optional)</span>
        <input type="date" value={interviewDate} onChange={(e) => setInterviewDate(e.target.value)} className={field} />
      </label>
      <div className="mt-6 flex items-center gap-3">
        <button type="submit" disabled={!name.trim()} className="rounded-lg bg-indigo-600 px-5 py-2 font-medium text-white hover:bg-indigo-700 disabled:opacity-40">
          {editing ? "Save" : "Create profile"}
        </button>
        {onCancel && <button type="button" onClick={onCancel} className="text-sm text-stone-500 hover:text-stone-800 dark:hover:text-stone-200">Cancel</button>}
      </div>
    </form>
  );
}

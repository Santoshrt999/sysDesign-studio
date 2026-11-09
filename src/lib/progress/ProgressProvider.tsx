"use client";
// Client-side store for the local profile + reading progress. Loads data/profile.json once (via /api/profile),
// applies updates in memory, and saves with a short debounce plus a flush when the page is hidden.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { completeStage, emptyProgress, localDay, recordActivity, recordPosition } from "./logic";
import type { Position, Profile, ProfileFile, ProblemProgress, Theme } from "./types";

type Status = "loading" | "ready" | "offline";

interface ProgressApi {
  status: Status;
  file: ProfileFile | null;
  saveProfile(profile: Omit<Profile, "createdAt" | "theme"> & Partial<Pick<Profile, "theme">>): void;
  trackPosition(slug: string, pos: Partial<Position>): void;
  markStageRead(slug: string, stage: number): void;
  setNote(slug: string, note: string): void;
  resetProblem(slug: string): void;
  setTheme(theme: Theme): void;
}

const Ctx = createContext<ProgressApi | null>(null);
const SAVE_DEBOUNCE_MS = 800;

export function ProgressProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>("loading");
  const [file, setFile] = useState<ProfileFile | null>(null);
  const latest = useRef<ProfileFile | null>(null);
  const dirty = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flush = useCallback((keepalive = false) => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    if (!dirty.current || !latest.current) return;
    dirty.current = false;
    fetch("/api/profile", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(latest.current),
      keepalive,
    }).catch(() => { dirty.current = true; });
  }, []);

  useEffect(() => {
    let cancelled = false;
    const load = (initial: boolean) =>
      fetch("/api/profile", { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
        .then((d: { file: ProfileFile | null }) => {
          // Never clobber unsaved local changes with what's on disk.
          if (cancelled || dirty.current) return;
          latest.current = d.file;
          setFile(d.file);
          setStatus("ready");
        })
        .catch(() => { if (!cancelled && initial) setStatus("offline"); });
    load(true);
    // Another tab may have saved since this one loaded: re-read when this tab becomes visible,
    // so a stale tab never writes old progress over newer progress.
    const onVisible = () => { if (document.visibilityState === "visible") load(false); else flush(true); };
    const onHide = () => flush(true);
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("pagehide", onHide);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("pagehide", onHide);
    };
  }, [flush]);

  /** Apply a change to the loaded file. No-op without a profile (never creates one implicitly). */
  const update = useCallback((fn: (f: ProfileFile) => ProfileFile) => {
    const current = latest.current;
    if (!current) return;
    const next = fn(current);
    const withActivity = { ...next, activityDays: recordActivity(next.activityDays, localDay(new Date())) };
    latest.current = withActivity;
    setFile(withActivity);
    dirty.current = true;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => flush(), SAVE_DEBOUNCE_MS);
  }, [flush]);

  const updateProblem = useCallback((slug: string, fn: (p: ProblemProgress, now: string) => ProblemProgress) => {
    update((f) => {
      const now = new Date().toISOString();
      const p = f.problems[slug] ?? emptyProgress(now);
      return { ...f, problems: { ...f.problems, [slug]: fn(p, now) } };
    });
  }, [update]);

  // Mutators have stable identities so effects that call them don't re-run on every save.
  const saveProfile = useCallback<ProgressApi["saveProfile"]>((profile) => {
    const now = new Date().toISOString();
    const prev = latest.current;
    const next: ProfileFile = prev
      ? { ...prev, profile: { ...prev.profile, ...profile } }
      : { version: 1, profile: { theme: "dark", createdAt: now, ...profile }, activityDays: [localDay(new Date())], problems: {} };
    latest.current = next;
    setFile(next);
    dirty.current = true;
    flush();
  }, [flush]);
  const trackPosition = useCallback<ProgressApi["trackPosition"]>(
    (slug, pos) => updateProblem(slug, (p, now) => recordPosition(p, pos, now)), [updateProblem]);
  const markStageRead = useCallback<ProgressApi["markStageRead"]>(
    (slug, stage) => updateProblem(slug, (p, now) => completeStage(p, stage, now)), [updateProblem]);
  const setNote = useCallback<ProgressApi["setNote"]>(
    (slug, note) => updateProblem(slug, (p, now) => ({ ...p, note, lastVisited: now })), [updateProblem]);
  const resetProblem = useCallback<ProgressApi["resetProblem"]>((slug) => update((f) => {
    const problems = { ...f.problems };
    delete problems[slug];
    return { ...f, problems };
  }), [update]);
  const setTheme = useCallback<ProgressApi["setTheme"]>(
    (theme) => update((f) => ({ ...f, profile: { ...f.profile, theme } })), [update]);

  const api = useMemo<ProgressApi>(
    () => ({ status, file, saveProfile, trackPosition, markStageRead, setNote, resetProblem, setTheme }),
    [status, file, saveProfile, trackPosition, markStageRead, setNote, resetProblem, setTheme],
  );

  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}

export function useProgress(): ProgressApi {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useProgress must be used inside <ProgressProvider>");
  return ctx;
}

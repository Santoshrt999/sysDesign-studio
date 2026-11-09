/**
 * Where progress lives.
 *  - "file":    data/profile.json via /api/profile. One profile for the whole server, so only for running locally.
 *  - "browser": localStorage in each visitor's browser. Private per visitor; what a hosted (public) site must use.
 * Default: "file" under `next dev`, "browser" for production builds. Override with NEXT_PUBLIC_PROGRESS_STORAGE=file|browser
 * (e.g. NEXT_PUBLIC_PROGRESS_STORAGE=file npm start to keep using the file with a local production build).
 * NEXT_PUBLIC_* and NODE_ENV are inlined at build time, so client and server always agree.
 */
import type { ProfileFile } from "./types";

export type StorageMode = "file" | "browser";

const configured = process.env.NEXT_PUBLIC_PROGRESS_STORAGE;
export const STORAGE_MODE: StorageMode =
  configured === "file" || configured === "browser" ? configured : process.env.NODE_ENV === "development" ? "file" : "browser";

export function isProfileFile(x: unknown): x is ProfileFile {
  const f = x as ProfileFile;
  return (
    !!f &&
    typeof f === "object" &&
    f.version === 1 &&
    typeof f.profile?.name === "string" &&
    f.profile.name.trim().length > 0 &&
    Array.isArray(f.activityDays) &&
    typeof f.problems === "object" &&
    f.problems !== null &&
    !Array.isArray(f.problems)
  );
}

export interface ProgressStorage {
  mode: StorageMode;
  /** null = no profile yet. Throws if storage is unavailable. */
  load(): Promise<ProfileFile | null>;
  save(file: ProfileFile, opts?: { keepalive?: boolean }): Promise<void>;
}

const fileStorage: ProgressStorage = {
  mode: "file",
  async load() {
    const r = await fetch("/api/profile", { cache: "no-store" });
    if (!r.ok) throw new Error(`GET /api/profile ${r.status}`);
    const d = (await r.json()) as { file: ProfileFile | null };
    return d.file;
  },
  async save(file, opts) {
    const r = await fetch("/api/profile", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(file),
      keepalive: opts?.keepalive,
    });
    if (!r.ok) throw new Error(`PUT /api/profile ${r.status}`);
  },
};

export const BROWSER_KEY = "sysdesign-studio:profile:v1";

const browserStorage: ProgressStorage = {
  mode: "browser",
  async load() {
    const raw = window.localStorage.getItem(BROWSER_KEY); // throws if storage is blocked
    if (!raw) return null;
    try {
      const parsed: unknown = JSON.parse(raw);
      return isProfileFile(parsed) ? parsed : null;
    } catch {
      return null;
    }
  },
  async save(file) {
    window.localStorage.setItem(BROWSER_KEY, JSON.stringify(file));
  },
};

export const progressStorage: ProgressStorage = STORAGE_MODE === "file" ? fileStorage : browserStorage;

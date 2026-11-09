# Profile & Reading Progress Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A password-free local profile with a Netflix-style `/profile` page that tracks reading progress per problem and resumes at the exact stage, evolution step and flow.

**Architecture:** Pure progress logic in `src/lib/progress/` (no React, no I/O) so it can be checked with a node script. A route handler persists one JSON file at `data/profile.json`. A client `ProgressProvider` in the root layout loads the file once, applies updates, and saves debounced. `JourneyViewer` reports position and completion through it; `StageEvolve`/`StageFlows` read and report their position through a small `JourneyPosition` context, so no stage props change.

**Tech Stack:** Next.js 15 App Router, React 19, TypeScript, Tailwind v4. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-11-09-profile-progress-design.md`

## Global Constraints

- No auth, no passwords, single user, no cloud.
- Storage: `data/profile.json` (gitignored), written atomically (temp file + rename) via `GET`/`PUT /api/profile`.
- The dark theme applies to `/profile` only; the rest of the app stays light. Default theme `"dark"`.
- No `Problem` schema change; recap and rows derive from existing content; planned problems never appear on the profile.
- Problem pages stay statically prerendered; progress loads on the client.
- The project has no test runner: pure logic is checked with a throwaway node script compiled via `tsc` in the scratchpad; UI with `npm run typecheck` and a browser check. **Never run `npm run build` while `next dev` is running.**

## Review Focus

1. Profile file missing, unreadable or malformed JSON → the app works with tracking off and `/profile` shows setup, never an error page. (Task 2: GET returns `{ file: null }` on parse failure.)
2. Content changed since progress was saved (a stored `evolveStep` > `evolution.length`, an unknown `flowId`, a slug no longer registered) → clamp, or ignore that slug; never crash. (Task 1: `clampPosition` assertions; Task 5: unknown slugs filtered.)
3. Opening a problem page without a profile → no writes and no profile file created. (Task 3: `update` is a no-op while `file === null`.)
4. Short stage, sentinel visible immediately on open → not counted as read until the stage has been open ≥ 8 s. (Task 4.)
5. Interview date in the past or empty → countdown hidden; streak broken by more than a day → 0. (Task 1: `streak` and `daysUntil` assertions.)

---

### Task 1: Types and pure progress logic

**Files:**
- Create: `src/lib/progress/types.ts`, `src/lib/progress/logic.ts`

**Interfaces — Produces:**
- `types.ts`: `ProblemProgress`, `ProfileFile` (exactly as in the spec), `Position = ProblemProgress["position"]`, `Theme = "light" | "dark"`.
- `logic.ts`:
  - `emptyProgress(now: string): ProblemProgress`
  - `recordPosition(p: ProblemProgress, pos: Partial<Position>, now: string): ProblemProgress`. Merges pos; raises `evolveMaxStep`; adds `flowId` to `flowsViewed`; sets `lastVisited`.
  - `completeStage(p, stage: number, now): ProblemProgress`. Idempotent, sorted.
  - `isCompleted(p): boolean` (all of 0–6)
  - `percent(p): number` (completed / 7, 0–1)
  - `recordActivity(days: string[], today: string): string[]` (dedupe, keep last 60, sorted)
  - `streak(days: string[], today: string): number` (consecutive days ending today or yesterday)
  - `daysUntil(dateIso: string | undefined, today: string): number | null` (null if missing or past)
  - `clampPosition(problem: Problem, pos: Position): Position`
  - `nextStage(p): number` (first stage not completed; 6 if all completed)
  - `buildRecap(problem: Problem, p: ProblemProgress): { covered: string[]; next: string }`. Sources as in the spec, each item truncated to 90 chars with "…".
  - `resumeHref(slug: string, pos: Position): string` → `/problems/{slug}?step={n}&flow={id}#stage-{stage+1}` (omit undefined params)
  - `localDay(d: Date): string` → `YYYY-MM-DD` in local time
  - `STAGE_NAMES: readonly string[]` (Understand, Size, Start simple, Evolve, Flows, Deep dives, Defend)

- [ ] **Step 1:** Write the scratch check `scratchpad/check-progress.js` (compiled from `src/lib/progress/logic.ts` with `tsc --module commonjs`), asserting:
  - `streak(["2026-11-07","2026-11-08","2026-11-09"],"2026-11-09") === 3`; `streak(["2026-11-08"],"2026-11-09") === 1`; `streak(["2026-11-06"],"2026-11-09") === 0`
  - `daysUntil("2026-11-21","2026-11-09") === 12`; `daysUntil("2026-11-01","2026-11-09") === null`; `daysUntil(undefined, …) === null`
  - `completeStage` twice on stage 2 → `completedStages` is `[2]`
  - `clampPosition(webCrawler, {stage: 9, evolveStep: 99, flowId: "nope"})` → `{stage: 6, evolveStep: 6, flowId: undefined}`
  - `nextStage` with `[0,1,2]` → 3
  - `buildRecap(webCrawler, {completedStages:[0,1,2]…}).next` contains "Stage 4" and "Evolve"
  - `resumeHref("web-crawler",{stage:3,evolveStep:2})` === `"/problems/web-crawler?step=2#stage-4"`
- [ ] **Step 2:** Run it; expect failure (module missing).
- [ ] **Step 3:** Implement `types.ts` and `logic.ts`.
- [ ] **Step 4:** Run the check; expect all assertions to pass. `npm run typecheck` passes.
- [ ] **Step 5:** Commit `feat(progress): types and pure progress logic`.

### Task 2: Persistence API

**Files:**
- Create: `src/app/api/profile/route.ts`
- Modify: `.gitignore` (add `data/`)

**Interfaces — Produces:** `GET /api/profile` → `200 { file: ProfileFile | null }`; `PUT /api/profile` with body `ProfileFile` → `204`, or `400` if `version !== 1` or `profile.name` is not a non-empty string. `export const dynamic = "force-dynamic"`, `runtime = "nodejs"`. File: `path.join(process.cwd(), "data", "profile.json")`; mkdir recursive; write `profile.json.tmp`, then rename. A GET with missing or malformed JSON returns `{ file: null }`.

- [ ] **Step 1:** With dev running: `curl -s localhost:3000/api/profile` → `{"file":null}`; a PUT with a bad body → 400; a valid PUT → 204, then GET returns it; corrupt the file by hand → GET returns `{"file":null}`. Delete `data/profile.json` afterwards.
- [ ] **Step 2:** Commit `feat(progress): local profile persistence API`.

### Task 3: ProgressProvider (client store)

**Files:**
- Create: `src/lib/progress/ProgressProvider.tsx`
- Modify: `src/app/layout.tsx` (wrap `{children}`)

**Interfaces — Produces:** `useProgress(): { status: "loading" | "ready" | "offline"; file: ProfileFile | null; saveProfile(p: ProfileFile["profile"]): void; trackPosition(slug, pos: Partial<Position>): void; markStageRead(slug, stage): void; setNote(slug, note): void; resetProblem(slug): void; setTheme(t: Theme): void }`.
- Loads once on mount; `offline` if the fetch fails (all mutators then no-ops).
- While `file === null`, every mutator except `saveProfile` is a no-op (Review Focus 3).
- Every mutation also calls `recordActivity(localDay(new Date()))`, and is persisted with an ~800 ms debounce plus a flush on `pagehide` (`fetch` with `keepalive: true`).

- [ ] **Step 1:** Implement; `npm run typecheck` passes.
- [ ] **Step 2:** Commit `feat(progress): client progress provider`.

### Task 4: Track and restore position in the journey

**Files:**
- Create: `src/components/journey/JourneyPosition.tsx`: context `{ evolveStep?: number; flowId?: string; onEvolveStep(n): void; onFlow(id): void } | null` plus `useJourneyPosition()`
- Create: `src/components/journey/NotesPanel.tsx`: a "My notes" button and popover textarea bound to `setNote`, debounced
- Modify: `JourneyViewer.tsx`: read `step`/`flow` from `window.location.search` on mount (clamped); call `trackPosition` on stage/step/flow changes; `markStageRead(previous)` when moving forward; a bottom sentinel (IntersectionObserver) counts the stage as read only once it has been open ≥ 8 s; add NotesPanel and a "Profile" link to the header.
- Modify: `StageEvolve.tsx`, `StageFlows.tsx`: the initial state comes from `useJourneyPosition()` when present; report changes via `onEvolveStep` / `onFlow`.

- [ ] **Step 1:** Implement; typecheck passes.
- [ ] **Step 2:** Browser check: with a profile, read Web Crawler stages 1→3 with Next, go to Stage 4 step v3 → `data/profile.json` shows `completedStages [0,1,2]`, `position {stage:3, evolveStep:2}`. Opening `/problems/web-crawler?step=2#stage-4` lands on Evolve v3. Without a profile, no file is created.
- [ ] **Step 3:** Commit `feat(progress): track and restore reading position`.

### Task 5: Profile page (Netflix-style) with a profile-only theme

**Files:**
- Create: `src/app/profile/page.tsx` (client), `src/components/profile/ProfileSetup.tsx`, `ContinueHero.tsx`, `ProblemRow.tsx` (row of cards with a progress bar and a menu with Reset, using `window.confirm`), `ThemeToggle.tsx` (☀️/🌙)
- Modify: `src/app/page.tsx`: a "Profile" link in the top-right nav next to About (a client `ProfileNavLink` showing "Create profile" when `file === null`)
- Modify: `src/app/globals.css`: `@custom-variant dark (&:where(.dark, .dark *));` so `dark:` only applies inside a `.dark` wrapper (used only on `/profile`)

Behaviour exactly as the spec's "Profile page behaviour" section: setup form when there's no profile; a welcome hero with "Start with URL Shortener" when there's no progress; a continue panel with recap + note + ▶ Resume (`resumeHref`) and "Recap first" (expands in place); rows Continue learning / Completed (Review → `/problems/{slug}#stage-1`) / Not started (ready problems only; unknown slugs ignored); a header with the streak, interview countdown (`daysUntil`), Edit profile and the theme toggle.

- [ ] **Step 1:** Implement; typecheck passes.
- [ ] **Step 2:** Browser check (the spec's verification scenario), light and dark, at ~1400 px and ~390 px wide; the theme toggle persists and the home and problem pages stay light.
- [ ] **Step 3:** Update CLAUDE.md (architecture: progress + `data/profile.json` + the profile-only dark theme exception; change log), and the README's feature list.
- [ ] **Step 4:** Commit `feat(profile): Netflix-style profile page with progress, recap and theme toggle`.

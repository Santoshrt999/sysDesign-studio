# Profile & reading progress: design

**Date:** 2026-11-09 · **Status:** awaiting approval

## Intent

SysDesign Studio is a local study app used by one person (Santosh) on one laptop. Study sessions are spread over days. When he comes back, he wants a Netflix-style "continue where you left off": open the profile, see exactly which problem and stage he stopped at, get a short reminder of what he already read (and his own notes), and resume with one click. It should feel like resuming a film, not like logging into a system.

## Goals

1. **A local profile without a password.** On first use, ask for a name (required), plus a target role and interview date (both optional). After that, the app knows who he is.
2. **Automatic progress tracking.** It records which stages of each problem he has read and exactly where he was. He never clicks "mark as done".
3. **A Netflix-style profile page** (`/profile`) with:
   - A **"Continue where you left off" panel**: the last problem, the next stage to read, a progress bar, "last read N days ago", an automatic **recap** of what he already covered, his **note** for that problem, and **▶ Resume** and **Recap first** buttons.
   - Rows: **Continue learning** (problems in progress), **Completed** (with a "Review" action) and **Not started**.
   - Small header details: a **day streak** and an **interview countdown** (only if a date is set).
   - A **☀️/🌙 theme toggle**, which affects **only the profile page** and is remembered.
4. **Notes:** one free-text note per problem, editable while reading the problem and shown on the profile.
5. **Durable storage:** progress survives app restarts, browser restarts, clearing site data and switching browsers.
6. **Housekeeping:** "Edit profile", and "Reset progress" per problem.

## Non-goals

- Accounts, passwords, sign-in, sessions or cookies-based auth.
- More than one user, or switching between profiles.
- Cloud sync or any network storage.
- Dark mode anywhere except `/profile`.
- Analytics on time spent, scroll depth, quizzes or scores.

## Anti-goals (failure even if it works)

- A login screen or any extra click on every visit.
- Tracking that needs explicit "done" buttons to work.
- Losing progress because the browser cache was cleared.
- Any change to the `Problem` content schema, or any per-problem code. Adding a problem must still need no UI changes; progress, recap and rows must derive everything from existing content.
- Breaking `npm run build` or the static prerender of problem pages.

## Constraints

- Next.js 15 App Router, TypeScript, Tailwind v4. No new dependencies unless clearly justified (none are expected).
- The app is run locally with `npm run dev` or `npm start`. There is no static export (`next.config.mjs` is empty), so a Node route handler may read and write files.
- Problem pages are statically prerendered via `generateStaticParams`. Progress must be loaded on the client, so prerendering is unaffected.
- The app's palette is stone/indigo and light. The profile's dark theme uses stone-900/950 surfaces with indigo accents (see mockup A).

## Decisions (made with Santosh)

| Decision | Choice |
|---|---|
| Who uses it | Only him, one laptop |
| Auth | None: a profile, not a login |
| Profile layout | Netflix-style (mockup A): dark hero "continue" panel, rows of problems with progress bars |
| Recap + notes | Yes: an automatic recap plus his own note, both in the continue panel |
| Theme toggle | ☀️/🌙 button on the profile page only, remembered |

## Decisions made by Claude (open to change)

- **Storage:** a single JSON file at `data/profile.json` in the project root, written through a route handler (`GET`/`PUT /api/profile`). Add `data/` to `.gitignore`. If the file doesn't exist, there's no profile yet.
- **Theme preference** is stored in the same file (`profile.theme: "light" | "dark"`, default `"dark"`, since that's how mockup A looks).
- **Entry point:** a "Profile" link (or "Create profile" when none exists) in the home page's top-right nav, next to "About". Also a small link in the problem page header.
- **Streak:** the number of consecutive calendar days, ending today or yesterday, on which any progress was recorded.

## How progress works

### What is recorded per problem

```ts
interface ProblemProgress {
  completedStages: number[];     // stage indexes 0–6 that count as read
  position: {                    // exactly where he was last
    stage: number;               // 0–6
    evolveStep?: number;         // StageEvolve's `step` (0 = v1 … evolution.length)
    flowId?: string;             // StageFlows' selected flow
  };
  evolveMaxStep: number;         // furthest evolution step reached
  flowsViewed: string[];         // flow ids opened
  note: string;                  // his free-text note ('' if none)
  firstVisited: string;          // ISO timestamp
  lastVisited: string;           // ISO timestamp
}

interface ProfileFile {
  version: 1;
  profile: { name: string; role?: string; interviewDate?: string; theme: "light" | "dark"; createdAt: string };
  activityDays: string[];        // 'YYYY-MM-DD', for the streak (keep last ~60)
  problems: Record<string /* slug */, ProblemProgress>;
}
```

### When a stage counts as read

A stage is added to `completedStages` when either of these happens:
- he leaves it **forwards**: the "Next" button, or clicking a later stage in the stage nav; or
- he **reaches the bottom** of it: a sentinel at the end of the stage content becomes visible.

The second rule is the only way the last stage (Defend) gets completed. Going backwards never un-completes anything. A problem is **completed** when all 7 stages are.

### Position

The position is updated whenever the stage changes, the Evolve step changes, or the selected flow changes. That needs small, local changes:
- `JourneyViewer` already owns `stage` and keeps it in the URL hash (`#stage-4`).
- `StageEvolve` (`step`) and `StageFlows` (`flowId`) hold their state locally. They need an optional initial value and an onChange callback (or a small progress context), so they can report changes and be restored.

Writes are **debounced** (~1 s) and also flushed on `pagehide`. Last write wins, which is fine because there's only one user.

### Resume

"▶ Resume" opens the problem at `position`: the right stage, with the Evolve step and selected flow restored. If the problem's content has since changed (fewer evolution steps, a flow id that no longer exists), clamp to the nearest valid value and don't fail. The exact URL format for carrying the position is left to the builder; the existing `#stage-N` hash must keep working for shared links.

If a profile exists but this problem has no progress, opening it behaves as it does today.

"Recap first" expands the recap in place on the profile page (no navigation).

### Recap (generated from content, never hand-written)

A few short lines built from what he completed. For example, for Web Crawler after Stage 3:

> **You covered:** the question (*crawl billions of pages, politely, without duplicates*) · sizing (*~2K pages/s; politeness is the real limit*) · v1 (*a single-process crawler*).
> **Next up:** Stage 4, Evolve: *v2 Distributed fetchers pulling from a durable frontier*.

Source per stage: Understand → `interviewQuestion` (shortened); Size → up to two `estimates[].result`; Start simple → `v1.title`; Evolve → titles of steps up to `evolveMaxStep`; Flows → names of `flowsViewed`; Deep dives → `deepDives[].title`; Defend → "trade-offs and follow-ups". Long text is truncated to about 90 characters. The exact wording and format are left to the builder.

## Profile page behaviour

- **No profile yet:** `/profile` shows a short setup form (name required; role and interview date optional) and creates the file.
- **Profile but no progress:** a welcome hero with "Start with URL Shortener" (the first ready problem) instead of the continue panel.
- **Continue panel:** the in-progress problem with the latest `lastVisited`. If everything started is completed, show the most recently completed one with "Review".
- **Rows:**
  - *Continue learning:* in-progress problems, newest `lastVisited` first, each with a progress bar, "3/7" and "last read N days ago".
  - *Completed:* each with **Review** (opens stage 1, keeps progress).
  - *Not started:* every **ready** problem with no progress. Planned problems don't appear.
- Each card has a small menu with **Reset progress**, which asks for confirmation.
- Header: "Welcome back, {name}", the streak, "Interview in N days" (hidden if no date or the date has passed), **Edit profile**, and the ☀️/🌙 toggle.
- **Notes:** on the problem page, a "My notes" button in the sticky header opens a small panel with a textarea that autosaves (debounced). On the profile, the note is shown in the continue panel and, truncated, on each card.

## What's left to the builder

- Component structure, file names and whether to use a React context or a hook for progress.
- The API route's exact shape (beyond `GET`/`PUT` of the whole file), and atomic-write details (writing to a temp file and renaming is recommended).
- The URL format for carrying the resume position.
- Exact visual styling within the stone/indigo palette, following mockup A.
- What happens if `/api/profile` is unreachable: degrade quietly (tracking off, no errors in the UI).

## Verification

- `npm run typecheck` passes. **Do not run `npm run build` while `npm run dev` is running** (it corrupts `.next`); build in a copy of the repo or after stopping dev.
- Manual: create a profile, read Web Crawler to Stage 3 (and open Stage 4, step v3), restart the dev server and the browser, and confirm the continue panel shows Web Crawler with the right recap and that Resume lands on Stage 4, step v3. Check that clearing site data doesn't lose progress, and that the theme toggle persists and only affects `/profile`.
- Update CLAUDE.md: the architecture section (profile/progress, `data/profile.json`, profile-only dark theme as the exception to "Light theme only") and the change log.

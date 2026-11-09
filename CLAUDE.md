# CLAUDE.md — SysDesign Studio

Teaching app for system design interviews. It teaches design *reasoning*: why each component exists, how the design evolves, and what breaks next. It is not a coding app. The user is a senior Java/banking/microservices engineer, so content should go deep on trade-offs and failure modes and skip definitions.

## Commands
- `npm run dev`: dev server at http://localhost:3000
- `npm run build`: production build (run before claiming work is done)
- `npm run typecheck`: `tsc --noEmit`
- There is no test runner or linter. Verification is `typecheck` + `build` (the build prerenders every ready problem via `generateStaticParams`, so a malformed problem fails it).

## Stack
Next.js 15 (App Router) + TypeScript + Tailwind v4 (`@tailwindcss/postcss`, config in `src/app/globals.css`) + `@xyflow/react` v12 + framer-motion + mermaid. shadcn/ui is **not** installed. Small Tailwind primitives live in `src/components/ui/primitives.tsx`. Light theme only (stone/indigo palette), except `/profile`, which has its own ☀️/🌙 toggle (dark by default) via a `.dark` wrapper and `@custom-variant dark` in `globals.css`.

## Architecture
- **Content is pure data.** `src/content/types.ts` defines the `Problem` schema. Each problem is `src/content/problems/<slug>/index.ts` and is registered in `src/content/registry.ts`. Adding a problem must never require UI changes.
- **Diagram evolution:** `v1.diagram` is the start. Each `evolution[i].delta` adds/removes/updates nodes and edges. `lib/diagram.ts#diagramAt(problem, n)` computes the diagram after n steps and which ids changed (used for NEW/CHANGED highlighting).
- **Optional teaching sections** (both rendered only when present, so older problems still work): `overview` (plain-language primer: what it is, what it does, where it's used, the core idea; shown at the top of Stage 1) and `communication` (per-interaction verdict of sync API vs queue vs hybrid, with "if you pick the other"; shown in Stage 3 after the API list). New problems should fill both.
- **Flows** run on the final diagram. Every hop with `to` must follow an existing edge (either direction, and `edgeForHop` handles reversal). A hop without `to` is local processing at `from`. A hop with `failure: true` renders red. The UI shows a "Content warning" if an edge is missing.
- **Node positions** are hand-placed x/y in content (no auto-layout). Edges are custom "floating" straight lines between node borders (`components/diagram/ArchDiagram.tsx`), and packets animate via SVG `animateMotion`.
- **Sequence view:** `lib/mermaid.ts` generates a Mermaid sequence diagram from flow hops. It is rendered client-side in `MermaidView.tsx`.
- **Profile & progress (local, single user, no auth):** `src/lib/progress/` has `types.ts`, pure `logic.ts` (recap, streak, clamp, resume links, all derived from content, with `ProblemOutline` as the slim shape) and `ProgressProvider.tsx` (client store in the root layout: loads once, saves with a debounce, flushes on hide, re-reads when the tab becomes visible). `src/app/api/profile/route.ts` reads and writes `data/profile.json` (gitignored, atomic temp-file + rename). `JourneyViewer` records stage/step/flow and marks a stage read on forward navigation, or on reaching the bottom after it has been open 8 s; `StageEvolve`/`StageFlows` restore and report position via `JourneyPosition` context. Resume links look like `/problems/<slug>?step=N&flow=id#stage-K`. Opening a problem without `#stage` never overwrites a saved position. Spec: `docs/superpowers/specs/2026-11-09-profile-progress-design.md`.
- **Journey shell:** `components/journey/JourneyViewer.tsx` holds 7 stage components (`Stage*.tsx`). The current stage is kept in the URL hash (`#stage-4`).

## Content quality bar (enforce when writing problems)
- Every component is justified by a stated problem with evidence (numbers).
- Every decision lists alternatives, each with a verdict on why it lost or won.
- Every estimate ends with a "so what" design implication.
- Each evolution step: problem → evidence → options → decision → new risks + mitigations → "say it" line.
- Flows include write, read, and failure paths (node death, stampede, region loss, duplicate processing).
- `communication` must say, per interaction, whether it is a sync call or a queue and why. Rule used so far: if the caller is blocked on the answer, or the callee isn't ours, it's a sync call with a deadline; if work is handed to a different-speed stage, it's a queue. Say so explicitly when something that looks like a queue isn't one (e.g. the crawler's URL frontier).

## Build order & status
1. ✅ App shell + journey viewer + **URL Shortener** fully written (v1 + 6 evolution steps, `overview` + `communication` added 2026-11-09, 7 flows, 3 deep dives, trade-offs, follow-ups, mistakes). **Awaiting user review of teaching quality before continuing.**
2. ✅ Rate Limiter, Phone Directory, Web Crawler written (with `overview` + `communication`). **Awaiting user review of teaching quality and visual check of diagrams.**
2b. ✅ Video Streaming, Chat App, News Feed written (with `overview` + `communication`, 6 steps / 9 flows / 3 deep dives each). **Awaiting user review and a visual check in the browser.**
3. ⏳ Framework page, Building Blocks, Decision Trees, Scaling Cheat Sheet.
4. ⏳ Practice mode (reveal-one-stage, drag-and-drop canvas, self-review checklist).
5. ⏳ Remaining problems (already listed as "planned" in `registry.ts`).

## Change log
- **2026-10-05**: Initial scaffold. Created schema, URL Shortener content, registry, diagram/mermaid libs, all 7 stage components, home page, README. Build and typecheck pass. All URL Shortener flow hops are validated against final-diagram edges. Client-side rendering has not yet been visually verified in a browser.

- **2026-10-05 (later)**: Added optional `overview` and `communication` to the `Problem` schema and rendered them in `StageUnderstand` / `StageStartSimple`. Wrote Rate Limiter (6 steps, 7 flows), Phone Directory (6 steps, 9 flows) and Web Crawler (6 steps, 8 flows) and registered them. `typecheck` and `build` pass, and every flow hop was checked against final-diagram edges with a throwaway script. Node coordinates were chosen by hand to avoid overlaps and edge crossings but **have not been viewed in a browser**.
- **2026-11-09**: Added `/about` page (`src/app/about/page.tsx`): author credit (Santosh Goteti), purpose, teaching principles, the 7 stages, live problem count, stack, license, GitHub + LinkedIn links. Linked from the home page (top-right nav + under the About section). A footer credit was tried and removed in favour of this page.
- **2026-11-09 (later)**: Wrote Video Streaming, Chat App and News Feed and registered them. A validation script (not committed; it compiles `src/content` with `tsc` and replays the deltas) confirmed for all three that every flow hop follows an edge, every delta refers to nodes and edges that exist, nodes don't overlap, and no edge's straight line passes within 10 px of a third node at any step. The same script flagged edge crossings in older problems, now fixed by moving nodes: URL Shortener `regionB` → (680,600); Phone Directory `queue` → (1320,40) and `snap` → (330,640). URL Shortener now has `overview` and `communication` too, so every ready problem has both. All 7 problems pass the checks.
- **2026-11-09 (profile)**: Added local profile + reading progress (see Architecture). Checked: pure logic via a scratch node script; API via curl (missing/corrupt file → `{file:null}`, bad body → 400); in the browser, create profile → read Web Crawler to Stage 3 → Evolve v3 + note → reload → continue panel, recap, note, Resume lands on Evolve v3, the theme persists and doesn't affect other pages, no console errors. The production build passed in a copy of the repo. The mobile layout has not been checked visually. **Awaiting user review; not committed.**

## Notes
- Node positions: roughly 330 px between columns and 200+ px between rows, and an edge's straight line must not pass through a third node (no auto-layout, so check by eye).
- When adding a flow hop that has no matching edge, add the edge in the relevant evolution delta rather than drawing a fake hop.
- Keep this file's status and change log updated after each work session.
- Never run `npm run build` while `npm run dev` is running: both write `.next`, and it breaks the dev server ("reading 'call'"). Build in a copy of the repo, or stop dev first.

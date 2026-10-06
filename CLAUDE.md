# CLAUDE.md — SysDesign Studio

Teaching app for system design interviews. It teaches design *reasoning*: why each component exists, how the design evolves, and what breaks next. It is not a coding app. The user is a senior Java/banking/microservices engineer, so content should go deep on trade-offs and failure modes and skip definitions.

## Commands
- `npm run dev`: dev server at http://localhost:3000
- `npm run build`: production build (run before claiming work is done)
- `npm run typecheck`: `tsc --noEmit`

## Stack
Next.js 15 (App Router) + TypeScript + Tailwind v4 (`@tailwindcss/postcss`, config in `src/app/globals.css`) + `@xyflow/react` v12 + framer-motion + mermaid. shadcn/ui is **not** installed. Small Tailwind primitives live in `src/components/ui/primitives.tsx`. Light theme only (stone/indigo palette).

## Architecture
- **Content is pure data.** `src/content/types.ts` defines the `Problem` schema. Each problem is `src/content/problems/<slug>/index.ts` and is registered in `src/content/registry.ts`. Adding a problem must never require UI changes.
- **Diagram evolution:** `v1.diagram` is the start. Each `evolution[i].delta` adds/removes/updates nodes and edges. `lib/diagram.ts#diagramAt(problem, n)` computes the diagram after n steps and which ids changed (used for NEW/CHANGED highlighting).
- **Flows** run on the final diagram. Every hop with `to` must follow an existing edge (either direction, and `edgeForHop` handles reversal). A hop without `to` is local processing at `from`. A hop with `failure: true` renders red. The UI shows a "Content warning" if an edge is missing.
- **Node positions** are hand-placed x/y in content (no auto-layout). Edges are custom "floating" straight lines between node borders (`components/diagram/ArchDiagram.tsx`), and packets animate via SVG `animateMotion`.
- **Sequence view:** `lib/mermaid.ts` generates a Mermaid sequence diagram from flow hops. It is rendered client-side in `MermaidView.tsx`.
- **Journey shell:** `components/journey/JourneyViewer.tsx` holds 7 stage components (`Stage*.tsx`). The current stage is kept in the URL hash (`#stage-4`).

## Content quality bar (enforce when writing problems)
- Every component is justified by a stated problem with evidence (numbers).
- Every decision lists alternatives, each with a verdict on why it lost or won.
- Every estimate ends with a "so what" design implication.
- Each evolution step: problem → evidence → options → decision → new risks + mitigations → "say it" line.
- Flows include write, read, and failure paths (node death, stampede, region loss, duplicate processing).

## Build order & status
1. ✅ App shell + journey viewer + **URL Shortener** fully written (7 evolution steps v1→v7, 7 flows, 3 deep dives, trade-offs, follow-ups, mistakes). **Awaiting user review of teaching quality before continuing.**
2. ⏳ Rate Limiter, Phone Directory, Video Streaming (listed as "planned" in the registry).
3. ⏳ Framework page, Building Blocks, Decision Trees, Scaling Cheat Sheet.
4. ⏳ Practice mode (reveal-one-stage, drag-and-drop canvas, self-review checklist).
5. ⏳ Remaining problems (already listed as "planned" in `registry.ts`).

## Change log
- **2026-10-05**: Initial scaffold. Created schema, URL Shortener content, registry, diagram/mermaid libs, all 7 stage components, home page, README. Build and typecheck pass. All URL Shortener flow hops are validated against final-diagram edges. Client-side rendering has not yet been visually verified in a browser.

## Notes
- When adding a flow hop that has no matching edge, add the edge in the relevant evolution delta rather than drawing a fake hop.
- Keep this file's status and change log updated after each work session.

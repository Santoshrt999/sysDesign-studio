# SysDesign Studio

A polished learning app for system design interviews. It helps engineers reason through architecture decisions, trade-offs, bottlenecks, and failure modes instead of memorizing buzzwords.

Built with Next.js, TypeScript, Tailwind CSS, and a content-driven problem model so each design lesson is easy to extend without touching the UI.

## Author

This project is created and maintained by Santosh Goteti.

It is designed to help engineers build stronger system design instincts through guided reasoning, trade-off analysis, and evolution-based architecture thinking.

## Why this project?

System design interviews are not about drawing fancy diagrams — they are about explaining:

- why a component exists
- what problem it solves
- what alternative options were considered
- what breaks under load
- how the design evolves over time

SysDesign Studio turns those ideas into guided design journeys.

## Features

- 7-stage interview learning flow
  - Understand
  - Size
  - Start simple
  - Evolve
  - Flows
  - Deep dives
  - Defend
- Visual architecture diagrams with highlighted changes
- Flow-based reasoning with write, read, and failure paths
- Content-first architecture so new problems can be added without UI changes
- Designed for senior engineers, platform engineers, backend developers, and interview prep

## Tech stack

- Next.js 15
- React 19
- TypeScript
- Tailwind CSS
- @xyflow/react
- Framer Motion
- Mermaid

## Project structure

```bash
src/
  app/
    page.tsx
    problems/[slug]/page.tsx
  components/
    journey/
    diagram/
    ui/
  content/
    registry.ts
    types.ts
    problems/
  lib/
    diagram.ts
    mermaid.ts
```

## Quick start

### 1) Clone the repository

```bash
git clone https://github.com/Santoshrt999/sysDesign-studio.git
cd sysDesign-studio
```

### 2) Install dependencies

```bash
npm install
```

### 3) Run the app locally

```bash
npm run dev
```

Then open:

```text
http://localhost:3000
```

### 4) Build for production

```bash
npm run build
```

### 5) Run type checking

```bash
npm run typecheck
```

## GitHub setup and push

If this repo is not already initialized in your local folder, run:

```bash
git init
git branch -M main
git remote add origin https://github.com/Santoshrt999/sysDesign-studio.git
git add .
git commit -m "Initial commit"
git push -u origin main
```

If the remote already exists, update it instead:

```bash
git remote set-url origin https://github.com/Santoshrt999/sysDesign-studio.git
```

If you prefer SSH instead of HTTPS:

```bash
git remote set-url origin git@github.com:Santoshrt999/sysDesign-studio.git
```

## Adding a new problem

This project is intentionally content-driven. To add a design problem:

1. Create a new folder under `src/content/problems/<slug>/`
2. Export a `Problem` object from a file like `index.ts`
3. Register it in `src/content/registry.ts`

No UI changes are required for new problems.

## Notes

The app follows a strict teaching structure where each problem evolves from a simple architecture to a production-grade design with explicit trade-offs, failure modes, and mitigation strategies.

## License

This project is licensed under the MIT License.

See the [LICENSE](LICENSE) file for the full license text.

---

Made for engineers who want to get better at system design reasoning.

© 2026 Santosh Goteti

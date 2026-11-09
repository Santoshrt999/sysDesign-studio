/**
 * Pure progress logic: no React, no I/O. Everything here derives from existing Problem content,
 * so adding a problem never needs progress-specific code.
 */
import type { Position, ProblemProgress } from "./types";

/** The parts of a Problem that progress needs. A full Problem satisfies this; so does a slim outline sent to the client. */
export interface ProblemOutline {
  slug: string;
  title: string;
  tagline: string;
  difficulty: string;
  interviewQuestion: string;
  estimates: Array<{ result: string }>;
  v1: { title: string };
  evolution: Array<{ version: string; title: string }>;
  flows: Array<{ id: string; name: string }>;
  deepDives: Array<{ title: string }>;
}

export const STAGE_NAMES = ["Understand", "Size", "Start simple", "Evolve", "Flows", "Deep dives", "Defend"] as const;
export const STAGE_COUNT = STAGE_NAMES.length;

export function emptyProgress(now: string): ProblemProgress {
  return { completedStages: [], position: { stage: 0 }, evolveMaxStep: 0, flowsViewed: [], note: "", firstVisited: now, lastVisited: now };
}

export function recordPosition(p: ProblemProgress, pos: Partial<Position>, now: string): ProblemProgress {
  const position = { ...p.position, ...pos };
  const evolveMaxStep = Math.max(p.evolveMaxStep, position.evolveStep ?? 0);
  const flowsViewed = position.flowId && !p.flowsViewed.includes(position.flowId) ? [...p.flowsViewed, position.flowId] : p.flowsViewed;
  return { ...p, position, evolveMaxStep, flowsViewed, lastVisited: now };
}

export function completeStage(p: ProblemProgress, stage: number, now: string): ProblemProgress {
  if (stage < 0 || stage >= STAGE_COUNT) return p;
  const completedStages = p.completedStages.includes(stage) ? p.completedStages : [...p.completedStages, stage].sort((a, b) => a - b);
  return { ...p, completedStages, lastVisited: now };
}

export function isCompleted(p: ProblemProgress): boolean {
  return p.completedStages.length >= STAGE_COUNT;
}

export function percent(p: ProblemProgress): number {
  return Math.min(1, p.completedStages.length / STAGE_COUNT);
}

/** First stage not yet read; the last stage if everything is read. */
export function nextStage(p: ProblemProgress): number {
  for (let i = 0; i < STAGE_COUNT; i++) if (!p.completedStages.includes(i)) return i;
  return STAGE_COUNT - 1;
}

export function localDay(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function dayNumber(day: string): number {
  const [y, m, d] = day.split("-").map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / 86_400_000);
}

export function recordActivity(days: string[], today: string): string[] {
  if (days.includes(today)) return days;
  return [...days, today].sort().slice(-60);
}

/** Consecutive days with activity, ending today or yesterday. */
export function streak(days: string[], today: string): number {
  const set = new Set(days.map(dayNumber));
  let cursor = dayNumber(today);
  if (!set.has(cursor)) cursor -= 1;
  let n = 0;
  while (set.has(cursor)) { n++; cursor--; }
  return n;
}

/** Whole days from today to the date; null if missing, invalid or already past. */
export function daysUntil(dateIso: string | undefined, today: string): number | null {
  if (!dateIso || !/^\d{4}-\d{2}-\d{2}$/.test(dateIso)) return null;
  const n = dayNumber(dateIso) - dayNumber(today);
  return n >= 0 ? n : null;
}

/** Days since an ISO timestamp, in local days. */
export function daysAgo(iso: string, today: string): number {
  return Math.max(0, dayNumber(today) - dayNumber(localDay(new Date(iso))));
}

/** Keep a saved position valid after content changes. */
export function clampPosition(problem: Pick<ProblemOutline, "evolution" | "flows">, pos: Position): Position {
  const stage = Math.max(0, Math.min(STAGE_COUNT - 1, Math.floor(pos.stage) || 0));
  const evolveStep = pos.evolveStep === undefined ? undefined : Math.max(0, Math.min(problem.evolution.length, Math.floor(pos.evolveStep) || 0));
  const flowId = pos.flowId && problem.flows.some((f) => f.id === pos.flowId) ? pos.flowId : undefined;
  return { stage, evolveStep, flowId };
}

export function resumeHref(slug: string, pos: Position): string {
  const q = new URLSearchParams();
  if (pos.evolveStep !== undefined) q.set("step", String(pos.evolveStep));
  if (pos.flowId) q.set("flow", pos.flowId);
  const qs = q.toString();
  return `/problems/${slug}${qs ? `?${qs}` : ""}#stage-${pos.stage + 1}`;
}

function clip(s: string, max = 90): string {
  const t = s.replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max - 1);
  const space = cut.lastIndexOf(" ");
  // Break at a word boundary unless that would throw away most of the text.
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[\s,;:(–-]+$/, "")}…`;
}

/** A short "you covered … / next up …" recap built only from content the reader has completed. */
export function buildRecap(problem: ProblemOutline, p: ProblemProgress): { covered: string[]; next: string } {
  const done = new Set(p.completedStages);
  const covered: string[] = [];
  if (done.has(0)) covered.push(`The question: ${clip(problem.interviewQuestion)}`);
  if (done.has(1)) covered.push(`Sizing: ${problem.estimates.slice(0, 2).map((e) => clip(e.result, 60)).join("; ")}`);
  if (done.has(2)) covered.push(`Started simple: ${clip(problem.v1.title)}`);
  const evolved = problem.evolution.slice(0, done.has(3) ? problem.evolution.length : p.evolveMaxStep);
  if (evolved.length) covered.push(`Evolved: ${evolved.map((s) => s.version).join(", ")} (latest: ${clip(evolved[evolved.length - 1].title, 70)})`);
  const flows = problem.flows.filter((f) => p.flowsViewed.includes(f.id));
  if (flows.length) covered.push(`Flows walked: ${clip(flows.map((f) => f.name).join("; "))}`);
  if (done.has(5)) covered.push(`Deep dives: ${clip(problem.deepDives.map((d) => d.title).join("; "))}`);
  if (done.has(6)) covered.push("Defended it: trade-offs, bottlenecks and follow-ups");

  if (isCompleted(p)) return { covered, next: "All 7 stages read. Review the trade-offs or try explaining it out loud." };
  const s = nextStage(p);
  let detail = "";
  if (s === 3 && p.evolveMaxStep > 0) {
    // evolveStep N shows evolution[N-1], so that's the step the reader was on.
    const onStep = problem.evolution[Math.min(p.evolveMaxStep, problem.evolution.length) - 1];
    if (onStep) detail = ` (you were on ${onStep.version}: ${clip(onStep.title, 70)})`;
  }
  return { covered, next: `Stage ${s + 1}, ${STAGE_NAMES[s]}${detail}` };
}

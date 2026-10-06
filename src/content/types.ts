/**
 * Content schema for a system design problem.
 * Every problem is pure data in src/content/problems/<slug>/index.ts.
 * Adding a problem never requires UI changes — only a new file + a registry entry.
 */

export type NodeKind =
  | "client"
  | "edge" // CDN, DNS
  | "lb"
  | "service"
  | "cache"
  | "db"
  | "queue"
  | "worker"
  | "infra" // coordination: allocator, ZooKeeper, rate limiter store
  | "region";

export interface DiagramNode {
  id: string;
  label: string;
  /** Short subtitle, e.g. "stateless × N" or "Redis Cluster" */
  sub?: string;
  kind: NodeKind;
  x: number;
  y: number;
}

export interface DiagramEdge {
  id: string;
  from: string;
  to: string;
  label?: string;
  /** async = dashed line (replication, queue publish, failover) */
  async?: boolean;
}

/** Changes applied to the diagram by one evolution step. */
export interface DiagramDelta {
  addNodes?: DiagramNode[];
  removeNodes?: string[];
  /** Change the label/sub of an existing node (e.g. "App server" -> "API servers × N") */
  updateNodes?: Array<Pick<DiagramNode, "id"> & Partial<Omit<DiagramNode, "id">>>;
  addEdges?: DiagramEdge[];
  removeEdges?: string[];
}

export interface ClarifyingQuestion {
  question: string;
  /** Why a strong candidate asks this */
  whyItMatters: string;
  /** The interviewer's answer we will assume */
  answer: string;
  /** How the answer changes the design */
  designImpact: string;
}

export interface Requirements {
  functional: string[];
  nonFunctional: Array<{ name: string; target: string; why: string }>;
  outOfScope: string[];
}

export interface Estimate {
  title: string;
  /** Step-by-step reasoning lines, e.g. "100M/day ÷ 86,400 s ≈ 1,160/s" */
  reasoning: string[];
  result: string;
  soWhat: string;
}

export interface ApiEndpoint {
  method: string;
  path: string;
  request?: string;
  response: string;
  notes: string;
}

export interface DataModel {
  entity: string;
  fields: Array<{ name: string; type: string; note?: string }>;
  accessPatterns: string[];
  insight: string;
}

export interface Option {
  name: string;
  pros: string[];
  cons: string[];
  /** Why it was chosen or why it lost */
  verdict: string;
  chosen?: boolean;
}

export interface EvolutionStep {
  version: string; // "v2"
  title: string;
  problem: string;
  /** The number or observation that proves the problem is real */
  evidence: string;
  options: Option[];
  decision: string;
  newRisks: Array<{ risk: string; mitigation: string }>;
  /** What you'd literally say to the interviewer */
  sayIt: string;
  delta: DiagramDelta;
}

export interface FlowHop {
  from: string;
  /** Omit `to` for local processing at `from` (highlighted node, no packet) */
  to?: string;
  /** Short label used on the sequence diagram */
  label: string;
  /** What happens at this hop */
  narration: string;
  /** Why it's designed this way */
  why?: string;
  async?: boolean;
  /** Mark hops where something goes wrong in failure flows */
  failure?: boolean;
}

export interface Flow {
  id: string;
  name: string;
  kind: "write" | "read" | "failure";
  summary: string;
  hops: FlowHop[];
  takeaway: string;
}

export interface DeepDive {
  id: string;
  title: string;
  question: string;
  context: string[];
  options: Option[];
  recommendation: string;
  sayIt: string;
}

export interface TradeOff {
  decision: string;
  alternative: string;
  why: string;
  whenToSwitch: string;
}

export interface FollowUp {
  question: string;
  answer: string[];
}

export interface Problem {
  slug: string;
  title: string;
  tagline: string;
  difficulty: "Easy" | "Medium" | "Hard";
  // Stage 1
  interviewQuestion: string;
  clarifyingQuestions: ClarifyingQuestion[];
  requirements: Requirements;
  // Stage 2
  estimates: Estimate[];
  // Stage 3
  api: ApiEndpoint[];
  dataModel: DataModel[];
  v1: {
    title: string;
    description: string[];
    diagram: { nodes: DiagramNode[]; edges: DiagramEdge[] };
    whatBreaksFirst: string[];
  };
  // Stage 4
  evolution: EvolutionStep[];
  // Stage 5 — flows run on the final architecture (v1 + all deltas)
  flows: Flow[];
  // Stage 6
  deepDives: DeepDive[];
  // Stage 7
  tradeOffs: TradeOff[];
  bottlenecks: Array<{ item: string; mitigation: string }>;
  followUps: FollowUp[];
  mistakes: string[];
  redFlags: string[];
}

export interface ProblemSummary {
  slug: string;
  title: string;
  tagline: string;
  difficulty: Problem["difficulty"];
  status: "ready" | "planned";
}

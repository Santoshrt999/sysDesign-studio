import type { DiagramEdge, DiagramNode, Problem } from "@/content/types";

export interface DiagramState {
  nodes: DiagramNode[];
  edges: DiagramEdge[];
  /** ids added/changed by the step that produced this state (for highlighting) */
  addedNodes: Set<string>;
  updatedNodes: Set<string>;
  addedEdges: Set<string>;
  removedNodes: DiagramNode[];
}

/**
 * Diagram after applying evolution steps [0, stepCount).
 * stepCount = 0 → v1; stepCount = evolution.length → final architecture.
 */
export function diagramAt(problem: Problem, stepCount: number): DiagramState {
  let nodes = [...problem.v1.diagram.nodes];
  let edges = [...problem.v1.diagram.edges];
  let addedNodes = new Set<string>(stepCount === 0 ? nodes.map((n) => n.id) : []);
  let updatedNodes = new Set<string>();
  let addedEdges = new Set<string>(stepCount === 0 ? edges.map((e) => e.id) : []);
  let removedNodes: DiagramNode[] = [];

  problem.evolution.slice(0, stepCount).forEach((step) => {
    const d = step.delta;
    removedNodes = nodes.filter((n) => d.removeNodes?.includes(n.id));
    nodes = nodes.filter((n) => !d.removeNodes?.includes(n.id));
    edges = edges.filter(
      (e) => !d.removeEdges?.includes(e.id) && !d.removeNodes?.includes(e.from) && !d.removeNodes?.includes(e.to),
    );
    nodes = nodes.map((n) => {
      const u = d.updateNodes?.find((x) => x.id === n.id);
      return u ? { ...n, ...u } : n;
    });
    nodes.push(...(d.addNodes ?? []));
    edges.push(...(d.addEdges ?? []));
    addedNodes = new Set((d.addNodes ?? []).map((n) => n.id));
    updatedNodes = new Set((d.updateNodes ?? []).map((n) => n.id));
    addedEdges = new Set((d.addEdges ?? []).map((e) => e.id));
  });

  return { nodes, edges, addedNodes, updatedNodes, addedEdges, removedNodes };
}

/** Find the edge a hop travels along, in either direction. */
export function edgeForHop(edges: DiagramEdge[], from: string, to?: string) {
  if (!to) return undefined;
  const fwd = edges.find((e) => e.from === from && e.to === to);
  if (fwd) return { edge: fwd, reverse: false };
  const rev = edges.find((e) => e.from === to && e.to === from);
  if (rev) return { edge: rev, reverse: true };
  return undefined;
}

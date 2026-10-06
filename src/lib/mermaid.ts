import type { DiagramNode, Flow } from "@/content/types";

const safe = (s: string) => s.replace(/[;#:]/g, " ").replace(/\s+/g, " ").trim();

/** Turn a flow's hops into a Mermaid sequence diagram. */
export function flowToSequence(flow: Flow, nodes: DiagramNode[]): string {
  const ids = Array.from(new Set(flow.hops.flatMap((h) => (h.to ? [h.from, h.to] : [h.from]))));
  const label = (id: string) => nodes.find((n) => n.id === id)?.label ?? id;
  const lines = ["sequenceDiagram", "  autonumber"];
  ids.forEach((id) => lines.push(`  participant ${id} as ${safe(label(id))}`));
  flow.hops.forEach((h) => {
    const text = safe(h.label);
    if (!h.to) lines.push(`  Note over ${h.from}: ${h.failure ? "✗ " : ""}${text}`);
    else lines.push(`  ${h.from}${h.failure ? "-x" : h.async ? "--)" : "->>"}${h.to}: ${text}`);
  });
  return lines.join("\n");
}

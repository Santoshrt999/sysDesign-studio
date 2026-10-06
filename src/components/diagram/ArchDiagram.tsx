"use client";
// Author: Santosh Goteti

import {
  BaseEdge,
  Background,
  Controls,
  EdgeLabelRenderer,
  Handle,
  MarkerType,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useInternalNode,
  useReactFlow,
  type Edge,
  type EdgeProps,
  type InternalNode,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import { motion } from "framer-motion";
import { useEffect, useMemo } from "react";
import type { DiagramEdge, DiagramNode, NodeKind } from "@/content/types";

export type NodeState = "normal" | "added" | "updated" | "active" | "failed" | "dim";
export type EdgeState = "normal" | "added" | "active" | "failed" | "dim";

export interface ArchDiagramProps {
  nodes: DiagramNode[];
  edges: DiagramEdge[];
  nodeState?: (id: string) => NodeState;
  edgeState?: (id: string) => EdgeState;
  /** Edge currently carrying a packet; reverse = packet travels to→from */
  packet?: { edgeId: string; reverse: boolean; failure?: boolean };
  height?: number;
}

const KIND_STYLE: Record<NodeKind, { bar: string; tag: string }> = {
  client: { bar: "bg-slate-400", tag: "client" },
  edge: { bar: "bg-sky-500", tag: "edge" },
  lb: { bar: "bg-indigo-500", tag: "load balancer" },
  service: { bar: "bg-violet-500", tag: "service" },
  cache: { bar: "bg-rose-500", tag: "cache" },
  db: { bar: "bg-amber-500", tag: "storage" },
  queue: { bar: "bg-emerald-500", tag: "queue" },
  worker: { bar: "bg-teal-500", tag: "worker" },
  infra: { bar: "bg-stone-500", tag: "coordination" },
  region: { bar: "bg-cyan-600", tag: "region" },
};

type ArchNodeData = { label: string; sub?: string; kind: NodeKind; state: NodeState };
type ArchEdgeData = { label?: string; async?: boolean; state: EdgeState; packet?: { reverse: boolean; failure?: boolean } };

function ArchNode({ data }: NodeProps<Node<ArchNodeData>>) {
  const k = KIND_STYLE[data.kind];
  const ring =
    data.state === "added"
      ? "ring-2 ring-emerald-500 shadow-emerald-200 shadow-lg"
      : data.state === "updated"
        ? "ring-2 ring-amber-400"
        : data.state === "active"
          ? "ring-2 ring-indigo-500 shadow-indigo-200 shadow-lg"
          : data.state === "failed"
            ? "ring-2 ring-red-500 shadow-red-200 shadow-lg"
            : "ring-1 ring-stone-200";
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.7, y: 8 }}
      animate={{
        opacity: data.state === "dim" ? 0.35 : 1,
        scale: data.state === "active" || data.state === "failed" ? 1.06 : 1,
        y: 0,
      }}
      transition={{ type: "spring", stiffness: 260, damping: 22 }}
      className={`relative w-[170px] rounded-lg bg-white px-3 py-2 ${ring}`}
    >
      <Handle type="target" position={Position.Left} className="!opacity-0 !pointer-events-none" />
      <Handle type="source" position={Position.Right} className="!opacity-0 !pointer-events-none" />
      <div className={`absolute left-0 top-0 h-full w-1 rounded-l-lg ${k.bar}`} />
      <div className="text-[10px] uppercase tracking-wider text-stone-400">{k.tag}</div>
      <div className="text-sm font-semibold leading-tight text-stone-800">{data.label}</div>
      {data.sub && <div className="text-[11px] leading-tight text-stone-500">{data.sub}</div>}
      {data.state === "added" && (
        <span className="absolute -right-2 -top-2 rounded bg-emerald-500 px-1.5 py-0.5 text-[9px] font-bold text-white">NEW</span>
      )}
      {data.state === "updated" && (
        <span className="absolute -right-2 -top-2 rounded bg-amber-400 px-1.5 py-0.5 text-[9px] font-bold text-white">CHANGED</span>
      )}
      {data.state === "failed" && (
        <span className="absolute -right-2 -top-2 rounded bg-red-500 px-1.5 py-0.5 text-[9px] font-bold text-white">FAIL</span>
      )}
    </motion.div>
  );
}

/** Point where the line from a node's center toward `to` crosses the node's border. */
function borderPoint(n: InternalNode, to: { x: number; y: number }) {
  const w = n.measured.width ?? 170;
  const h = n.measured.height ?? 60;
  const cx = n.internals.positionAbsolute.x + w / 2;
  const cy = n.internals.positionAbsolute.y + h / 2;
  const dx = to.x - cx;
  const dy = to.y - cy;
  const scale = 1 / Math.max(Math.abs(dx) / (w / 2 + 6), Math.abs(dy) / (h / 2 + 6), 1e-6);
  return { x: cx + dx * scale, y: cy + dy * scale };
}

function center(n: InternalNode) {
  return {
    x: n.internals.positionAbsolute.x + (n.measured.width ?? 170) / 2,
    y: n.internals.positionAbsolute.y + (n.measured.height ?? 60) / 2,
  };
}

function FloatingEdge({ id, source, target, data, markerEnd }: EdgeProps<Edge<ArchEdgeData>>) {
  const s = useInternalNode(source);
  const t = useInternalNode(target);
  if (!s || !t || !data) return null;
  const a = borderPoint(s, center(t));
  const b = borderPoint(t, center(s));
  const path = `M ${a.x},${a.y} L ${b.x},${b.y}`;
  const color =
    data.state === "active" ? "#6366f1" : data.state === "failed" ? "#ef4444" : data.state === "added" ? "#10b981" : "#a8a29e";
  const width = data.state === "active" || data.state === "failed" || data.state === "added" ? 2.5 : 1.5;
  const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  const packetColor = data.packet?.failure ? "#ef4444" : "#6366f1";

  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        markerEnd={markerEnd}
        style={{
          stroke: color,
          strokeWidth: width,
          strokeDasharray: data.async ? "6 5" : undefined,
          opacity: data.state === "dim" ? 0.25 : 1,
          transition: "stroke 0.3s, opacity 0.3s",
        }}
      />
      {data.packet && (
        <g>
          <circle r={7} fill={packetColor} opacity={0.25}>
            <animateMotion dur="1.1s" repeatCount="indefinite" path={path} keyPoints={data.packet.reverse ? "1;0" : "0;1"} keyTimes="0;1" calcMode="linear" />
          </circle>
          <circle r={4.5} fill={packetColor}>
            <animateMotion dur="1.1s" repeatCount="indefinite" path={path} keyPoints={data.packet.reverse ? "1;0" : "0;1"} keyTimes="0;1" calcMode="linear" />
          </circle>
        </g>
      )}
      {data.label && data.state !== "dim" && (
        <EdgeLabelRenderer>
          <div
            className="nodrag nopan pointer-events-none absolute rounded bg-stone-50/90 px-1 text-[10px] text-stone-500"
            style={{ transform: `translate(-50%, -50%) translate(${mid.x}px, ${mid.y}px)` }}
          >
            {data.label}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}

const nodeTypes = { arch: ArchNode };
const edgeTypes = { floating: FloatingEdge };

function FitOnChange({ signature }: { signature: string }) {
  const { fitView } = useReactFlow();
  useEffect(() => {
    const t = setTimeout(() => fitView({ padding: 0.15, duration: 500 }), 60);
    return () => clearTimeout(t);
  }, [signature, fitView]);
  return null;
}

function Inner({ nodes, edges, nodeState, edgeState, packet, height = 460 }: ArchDiagramProps) {
  const rfNodes: Node<ArchNodeData>[] = useMemo(
    () =>
      nodes.map((n) => ({
        id: n.id,
        type: "arch",
        position: { x: n.x, y: n.y },
        data: { label: n.label, sub: n.sub, kind: n.kind, state: nodeState?.(n.id) ?? "normal" },
        draggable: false,
      })),
    [nodes, nodeState],
  );
  const rfEdges: Edge<ArchEdgeData>[] = useMemo(
    () =>
      edges.map((e) => {
        const state = edgeState?.(e.id) ?? "normal";
        const color = state === "active" ? "#6366f1" : state === "failed" ? "#ef4444" : state === "added" ? "#10b981" : "#a8a29e";
        return {
          id: e.id,
          source: e.from,
          target: e.to,
          type: "floating",
          markerEnd: { type: MarkerType.ArrowClosed, color, width: 16, height: 16 },
          data: {
            label: e.label,
            async: e.async,
            state,
            packet: packet?.edgeId === e.id ? { reverse: packet.reverse, failure: packet.failure } : undefined,
          },
        };
      }),
    [edges, edgeState, packet],
  );
  const signature = nodes.map((n) => n.id).join(",");

  return (
    <div style={{ height }} className="w-full rounded-xl border border-stone-200 bg-stone-50">
      <ReactFlow
        nodes={rfNodes}
        edges={rfEdges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        fitView
        fitViewOptions={{ padding: 0.15 }}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        proOptions={{ hideAttribution: true }}
        minZoom={0.3}
      >
        <Background gap={20} size={1} color="#e7e5e4" />
        <Controls showInteractive={false} />
        <FitOnChange signature={signature} />
      </ReactFlow>
    </div>
  );
}

export function ArchDiagram(props: ArchDiagramProps) {
  return (
    <ReactFlowProvider>
      <Inner {...props} />
    </ReactFlowProvider>
  );
}

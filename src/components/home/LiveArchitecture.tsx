"use client";
// A scripted, self-playing architecture story (URL Shortener): v1 → overload → scale out → cache → failure → recovery → CDN.
// Pure SVG + framer-motion. Packets ride <animateMotion> along the active routes. Pauses off-screen; static for reduced motion.
import { AnimatePresence, motion } from "framer-motion";
import { useCallback, useEffect, useRef, useState } from "react";

type NodeId = "client" | "cdn" | "lb" | "api1" | "api2" | "api3" | "cache" | "db";
type Status = "ok" | "hot" | "down" | "healed";

const NODES: Record<NodeId, { x: number; y: number; label: string; glyph: string }> = {
  client: { x: 62, y: 185, label: "Users", glyph: "◉" },
  cdn: { x: 196, y: 185, label: "CDN edge", glyph: "◎" },
  lb: { x: 330, y: 185, label: "Load balancer", glyph: "⇶" },
  api1: { x: 470, y: 80, label: "API", glyph: "λ" },
  api2: { x: 470, y: 185, label: "API", glyph: "λ" },
  api3: { x: 470, y: 290, label: "API", glyph: "λ" },
  cache: { x: 640, y: 95, label: "Cache", glyph: "⚡" },
  db: { x: 640, y: 275, label: "Database", glyph: "▤" },
};

interface Beat {
  tag: string;
  title: string;
  metric: string;
  tone: "neutral" | "warn" | "fail" | "good";
  nodes: NodeId[];
  edges: Array<[NodeId, NodeId]>;
  routes: Array<{ path: NodeId[]; fail?: boolean; fast?: boolean }>;
  status?: Partial<Record<NodeId, Status>>;
  labels?: Partial<Record<NodeId, string>>;
  ms: number;
}

const V2_NODES: NodeId[] = ["client", "lb", "api1", "api2", "api3", "db"];
const V2_EDGES: Array<[NodeId, NodeId]> = [["client", "lb"], ["lb", "api1"], ["lb", "api2"], ["lb", "api3"], ["api1", "db"], ["api2", "db"], ["api3", "db"]];
const CACHE_EDGES: Array<[NodeId, NodeId]> = [["api1", "cache"], ["api2", "cache"], ["api3", "cache"]];
const CACHED_ROUTES = [
  { path: ["client", "lb", "api1", "cache"] as NodeId[] },
  { path: ["client", "lb", "api2", "cache"] as NodeId[] },
  { path: ["client", "lb", "api3", "db"] as NodeId[] },
];

const BEATS: Beat[] = [
  {
    tag: "v1", title: "One server, one database", metric: "100 req/s · everything is fine", tone: "neutral", ms: 3600,
    nodes: ["client", "api2", "db"], edges: [["client", "api2"], ["api2", "db"]],
    routes: [{ path: ["client", "api2", "db"] }], labels: { api2: "App server" },
  },
  {
    tag: "load ×100", title: "Traffic grows. The database melts.", metric: "p99 120 ms → 2.4 s", tone: "warn", ms: 3600,
    nodes: ["client", "api2", "db"], edges: [["client", "api2"], ["api2", "db"]],
    routes: [{ path: ["client", "api2", "db"], fast: true }, { path: ["client", "api2", "db"], fast: true }],
    status: { db: "hot", api2: "hot" }, labels: { api2: "App server" },
  },
  {
    tag: "v2", title: "Stateless servers behind a load balancer", metric: "scale out, not up", tone: "neutral", ms: 3600,
    nodes: V2_NODES, edges: V2_EDGES,
    routes: [{ path: ["client", "lb", "api1", "db"] }, { path: ["client", "lb", "api2", "db"] }, { path: ["client", "lb", "api3", "db"] }],
    status: { db: "hot" },
  },
  {
    tag: "v3", title: "Cache the hot reads", metric: "p99 2.4 s → 4 ms · 95% hit ratio", tone: "good", ms: 3800,
    nodes: [...V2_NODES, "cache"], edges: [...V2_EDGES, ...CACHE_EDGES], routes: CACHED_ROUTES,
  },
  {
    tag: "failure", title: "A cache node dies", metric: "every miss stampedes the database", tone: "fail", ms: 3800,
    nodes: [...V2_NODES, "cache"], edges: [...V2_EDGES, ...CACHE_EDGES],
    routes: [
      { path: ["client", "lb", "api1", "cache"], fail: true },
      { path: ["client", "lb", "api1", "db"], fast: true },
      { path: ["client", "lb", "api2", "db"], fast: true },
      { path: ["client", "lb", "api3", "db"], fast: true },
    ],
    status: { cache: "down", db: "hot" },
  },
  {
    tag: "recover", title: "Replica promoted, misses coalesced", metric: "back to 4 ms in ~10 s", tone: "good", ms: 3600,
    nodes: [...V2_NODES, "cache"], edges: [...V2_EDGES, ...CACHE_EDGES], routes: CACHED_ROUTES,
    status: { cache: "healed" }, labels: { cache: "Cache · replica" },
  },
  {
    tag: "v6", title: "Go global with a CDN edge", metric: "redirects in ~20 ms, worldwide", tone: "good", ms: 5200,
    nodes: ["client", "cdn", "lb", "api1", "api2", "api3", "cache", "db"],
    edges: [["client", "cdn"], ["cdn", "lb"], ...V2_EDGES.filter(([a]) => a !== "client"), ...CACHE_EDGES],
    routes: [
      { path: ["client", "cdn"], fast: true },
      { path: ["client", "cdn"], fast: true },
      { path: ["client", "cdn", "lb", "api2", "cache"] },
    ],
  },
];

const W = 112;
const H = 46;
const TONE: Record<Beat["tone"], string> = {
  neutral: "text-indigo-200 bg-indigo-500/15 ring-indigo-400/30",
  warn: "text-amber-200 bg-amber-500/15 ring-amber-400/30",
  fail: "text-rose-200 bg-rose-500/15 ring-rose-400/40",
  good: "text-emerald-200 bg-emerald-500/15 ring-emerald-400/30",
};

function routePath(path: NodeId[]) {
  return path.map((id, i) => `${i ? "L" : "M"} ${NODES[id].x} ${NODES[id].y}`).join(" ");
}

export function LiveArchitecture() {
  const [beat, setBeat] = useState(0);
  const [reduced, setReduced] = useState(false);
  const [visible, setVisible] = useState(true);
  const root = useRef<HTMLDivElement>(null);
  const svg = useRef<SVGSVGElement>(null);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const apply = () => { setReduced(mq.matches); if (mq.matches) setBeat(BEATS.length - 1); };
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);

  // Stop everything while the hero is scrolled out of view.
  useEffect(() => {
    if (!root.current) return;
    const io = new IntersectionObserver(([e]) => setVisible(e.isIntersecting), { threshold: 0.15 });
    io.observe(root.current);
    return () => io.disconnect();
  }, []);
  useEffect(() => {
    const s = svg.current;
    if (!s) return;
    if (visible && !reduced) s.unpauseAnimations();
    else s.pauseAnimations();
  }, [visible, reduced, beat]);

  useEffect(() => {
    if (reduced || !visible) return;
    const t = setTimeout(() => setBeat((b) => (b + 1) % BEATS.length), BEATS[beat].ms);
    return () => clearTimeout(t);
  }, [beat, reduced, visible]);

  const jump = useCallback((i: number) => setBeat(i), []);
  const b = BEATS[beat];

  return (
    <div ref={root} className="relative">
      <div className="relative overflow-hidden rounded-3xl border border-white/10 bg-white/[0.03] p-3 shadow-[0_0_80px_-20px_rgba(99,102,241,0.45)] backdrop-blur-sm">
        <svg ref={svg} viewBox="0 0 720 440" className="h-auto w-full" role="img" aria-label={`Architecture, ${b.tag}: ${b.title}`}>
          <defs>
            <linearGradient id="la-edge" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="720" y2="0">
              <stop offset="0%" stopColor="#818cf8" stopOpacity="0.15" />
              <stop offset="50%" stopColor="#a5b4fc" stopOpacity="0.6" />
              <stop offset="100%" stopColor="#67e8f9" stopOpacity="0.25" />
            </linearGradient>
            <filter id="la-glow" x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur stdDeviation="3.5" result="b" />
              <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
            </filter>
            <pattern id="la-dots" width="24" height="24" patternUnits="userSpaceOnUse">
              <circle cx="1" cy="1" r="1" fill="#ffffff" opacity="0.06" />
            </pattern>
          </defs>
          <rect width="720" height="440" fill="url(#la-dots)" />

          {/* edges */}
          <AnimatePresence>
            {b.edges.map(([a, c]) => {
              const A = NODES[a], C = NODES[c];
              return (
                <motion.line
                  key={`${a}-${c}`}
                  x1={A.x} y1={A.y} x2={C.x} y2={C.y}
                  stroke="url(#la-edge)" strokeWidth={1.6}
                  initial={{ pathLength: 0, opacity: 0 }}
                  animate={{ pathLength: 1, opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.7, ease: "easeOut" }}
                />
              );
            })}
          </AnimatePresence>

          {/* packets: keyed by beat so every beat restarts its flows */}
          {!reduced && (
            <g key={beat} filter="url(#la-glow)">
              {b.routes.flatMap((r, ri) =>
                [0, 1, 2].map((k) => {
                  const dur = (r.fast ? 1.1 : 1.8) * (r.path.length - 1) * 0.55 + 0.6;
                  const color = r.fail ? "#fb7185" : r.path[r.path.length - 1] === "cache" || r.path[r.path.length - 1] === "cdn" ? "#67e8f9" : "#a5b4fc";
                  return (
                    <circle key={`${ri}-${k}`} r={r.fail ? 4.2 : 3.4} fill={color} opacity={0}>
                      <animateMotion dur={`${dur}s`} begin={`${0.5 + ri * 0.35 + (k * dur) / 3}s`} repeatCount="indefinite" path={routePath(r.path)} />
                      <animate attributeName="opacity" values="0;1;1;0" keyTimes="0;0.1;0.85;1" dur={`${dur}s`} begin={`${0.5 + ri * 0.35 + (k * dur) / 3}s`} repeatCount="indefinite" />
                    </circle>
                  );
                }),
              )}
            </g>
          )}

          {/* nodes */}
          <AnimatePresence>
            {b.nodes.map((id) => {
              const n = NODES[id];
              const st = b.status?.[id] ?? "ok";
              const stroke = st === "down" ? "#fb7185" : st === "hot" ? "#fbbf24" : st === "healed" ? "#34d399" : "rgba(165,180,252,0.55)";
              const fill = st === "down" ? "rgba(244,63,94,0.16)" : st === "hot" ? "rgba(245,158,11,0.14)" : "rgba(15,23,42,0.85)";
              return (
                <motion.g
                  key={id}
                  initial={{ opacity: 0, scale: 0.6 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.6 }}
                  transition={{ type: "spring", stiffness: 260, damping: 22 }}
                  style={{ transformOrigin: `${n.x}px ${n.y}px` }}
                >
                  {(st === "hot" || st === "down") && !reduced && (
                    <rect x={n.x - W / 2 - 6} y={n.y - H / 2 - 6} width={W + 12} height={H + 12} rx={16} fill="none" stroke={stroke} strokeWidth={1.5}>
                      <animate attributeName="opacity" values="0.9;0.1;0.9" dur={st === "down" ? "0.8s" : "1.4s"} repeatCount="indefinite" />
                    </rect>
                  )}
                  <rect x={n.x - W / 2} y={n.y - H / 2} width={W} height={H} rx={12} fill={fill} stroke={stroke} strokeWidth={1.4} />
                  <text x={n.x - W / 2 + 16} y={n.y + 5} fontSize="15" fill={st === "down" ? "#fb7185" : "#a5b4fc"} textAnchor="middle">
                    {st === "down" ? "✕" : n.glyph}
                  </text>
                  <text x={n.x - W / 2 + 30} y={n.y + 4} fontSize="11.5" fontWeight={600} fill={st === "down" ? "#fecdd3" : "#e7e5e4"}>
                    {b.labels?.[id] ?? n.label}
                  </text>
                </motion.g>
              );
            })}
          </AnimatePresence>
        </svg>

        {/* caption, synced to the beat */}
        <div className="pointer-events-none absolute inset-x-4 bottom-4 flex items-end justify-between gap-3">
            <motion.div
              key={beat}
              initial={{ opacity: 0, y: 10, filter: "blur(4px)" }}
              animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
              transition={{ duration: 0.35 }}
              className="rounded-xl bg-stone-950/70 px-3 py-2 ring-1 ring-white/10 backdrop-blur"
            >
              <span className={`mr-2 inline-flex rounded-md px-1.5 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wider ring-1 ${TONE[b.tone]}`}>{b.tag}</span>
              <span className="text-sm font-semibold text-white">{b.title}</span>
              <div className="mt-0.5 font-mono text-[11px] text-stone-400">{b.metric}</div>
            </motion.div>
        </div>
      </div>

      {/* beat scrubber */}
      <div className="mt-3 flex items-center justify-center gap-1.5" role="tablist" aria-label="Architecture story">
        {BEATS.map((x, i) => (
          <button
            key={x.tag + i}
            role="tab"
            aria-selected={i === beat}
            aria-label={`${x.tag}: ${x.title}`}
            onClick={() => jump(i)}
            className={`h-1.5 rounded-full transition-all ${i === beat ? "w-8 bg-indigo-300" : "w-3 bg-white/20 hover:bg-white/40"}`}
          />
        ))}
      </div>
    </div>
  );
}

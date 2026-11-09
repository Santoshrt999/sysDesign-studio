"use client";
import Link from "next/link";
import { motion, useReducedMotion } from "framer-motion";
import { useEffect, useRef, useState, type PointerEvent } from "react";
import { ProfileNavLink } from "@/components/profile/ProfileNavLink";
import { LiveArchitecture } from "./LiveArchitecture";
import { ContinueChip } from "./ContinueChip";

export interface HeroStats {
  problems: number;
  steps: number;
  flows: number;
  failures: number;
}

const ROTATING = ["Design it.", "Break it.", "Defend it."];

function CountUp({ to, delay = 0 }: { to: number; delay?: number }) {
  const reduce = useReducedMotion();
  const [n, setN] = useState(reduce ? to : 0);
  useEffect(() => {
    if (reduce) { setN(to); return; }
    let raf = 0;
    const start = performance.now() + delay;
    const tick = (t: number) => {
      const p = Math.min(1, Math.max(0, (t - start) / 1400));
      setN(Math.round(to * (1 - Math.pow(1 - p, 3))));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [to, delay, reduce]);
  return <>{n}</>;
}

function RotatingWord() {
  const reduce = useReducedMotion();
  const [i, setI] = useState(0);
  useEffect(() => {
    if (reduce) return;
    const t = setInterval(() => setI((x) => (x + 1) % ROTATING.length), 2200);
    return () => clearInterval(t);
  }, [reduce]);
  return (
    <span className="relative inline-grid">
      {ROTATING.map((w, k) => (
        <motion.span
          key={w}
          className="col-start-1 row-start-1"
          initial={false}
          animate={{ opacity: k === i ? 1 : 0, y: k === i ? 0 : 12, filter: k === i ? "blur(0px)" : "blur(6px)" }}
          transition={{ duration: 0.45 }}
          aria-hidden={k !== i}
        >
          {w}
        </motion.span>
      ))}
    </span>
  );
}

export function Hero({ stats, first, titles }: { stats: HeroStats; first: { slug: string; title: string }; titles: Record<string, string> }) {
  const ref = useRef<HTMLElement>(null);
  // Cursor spotlight: CSS variables updated on pointer move (no re-render).
  const onMove = (e: PointerEvent<HTMLElement>) => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    el.style.setProperty("--mx", `${e.clientX - r.left}px`);
    el.style.setProperty("--my", `${e.clientY - r.top}px`);
  };

  const rise = (d: number) => ({
    initial: { opacity: 0, y: 18, filter: "blur(6px)" },
    animate: { opacity: 1, y: 0, filter: "blur(0px)" },
    transition: { duration: 0.7, delay: d, ease: [0.22, 1, 0.36, 1] as const },
  });

  return (
    <section ref={ref} onPointerMove={onMove} className="hero-spotlight relative isolate overflow-hidden bg-stone-950 text-white">
      {/* backdrop: aurora + perspective grid + vignette */}
      <div aria-hidden className="hero-aurora pointer-events-none absolute -top-1/3 left-1/2 -z-10 h-[140%] w-[140%] -translate-x-1/2 opacity-60" />
      <div aria-hidden className="hero-grid pointer-events-none absolute inset-x-0 bottom-0 -z-10 h-2/3" />
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(ellipse_at_center,transparent_40%,#0c0a09_95%)]" />

      <div className="mx-auto max-w-7xl px-4 pb-16 pt-6 sm:px-6 lg:pb-24">
        <nav className="flex items-center justify-between text-sm">
          <Link href="/" className="font-semibold tracking-tight text-white">
            <span className="mr-1.5 inline-block h-2 w-2 rounded-full bg-indigo-400 shadow-[0_0_12px_2px_rgba(129,140,248,0.8)]" />
            SysDesign Studio
          </Link>
          <div className="flex items-center gap-5">
            <ProfileNavLink className="font-medium text-indigo-300 hover:text-white" />
            <Link href="/about" className="font-medium text-stone-400 hover:text-white">About</Link>
          </div>
        </nav>

        <div className="mt-12 grid items-center gap-12 lg:mt-16 lg:grid-cols-[1fr_1.15fr]">
          <div>
            <motion.div {...rise(0)} className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-medium text-stone-300 backdrop-blur">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60 motion-reduce:hidden" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" />
              </span>
              System design, the way senior engineers reason
            </motion.div>

            <motion.h1 {...rise(0.08)} className="mt-6 text-4xl font-semibold leading-[1.05] tracking-tight sm:text-6xl">
              Don&apos;t memorise architectures.
              <br />
              <span className="hero-gradient-text">Watch them evolve.</span>
            </motion.h1>

            <motion.p {...rise(0.16)} className="mt-6 max-w-xl text-lg leading-relaxed text-stone-300">
              Every component justified by a number, every decision weighed against its alternatives, and every design pushed until it breaks:
              node death, stampedes, region loss. <span className="text-white"><RotatingWord /></span>
            </motion.p>

            <motion.div {...rise(0.24)} className="mt-8 flex flex-wrap items-center gap-3">
              <Link
                href={`/problems/${first.slug}`}
                className="group relative inline-flex items-center gap-2 overflow-hidden rounded-xl bg-white px-6 py-3 font-semibold text-stone-950 shadow-[0_0_40px_-8px_rgba(165,180,252,0.9)] transition hover:shadow-[0_0_60px_-6px_rgba(165,180,252,1)]"
              >
                <span className="hero-shine pointer-events-none absolute inset-0" aria-hidden />
                ▶ Start with {first.title}
              </Link>
              <a href="#problems" className="rounded-xl px-5 py-3 font-medium text-stone-200 ring-1 ring-white/15 transition hover:bg-white/5 hover:ring-white/30">
                Browse all problems ↓
              </a>
            </motion.div>

            <motion.div {...rise(0.3)} className="mt-4">
              <ContinueChip titles={titles} />
            </motion.div>

            <motion.dl {...rise(0.36)} className="mt-10 grid max-w-lg grid-cols-4 gap-4 border-t border-white/10 pt-6">
              {[
                { k: "problems", v: stats.problems, label: "problems" },
                { k: "steps", v: stats.steps, label: "evolution steps" },
                { k: "flows", v: stats.flows, label: "animated flows" },
                { k: "failures", v: stats.failures, label: "failure drills" },
              ].map((s, i) => (
                <div key={s.k}>
                  <dt className="sr-only">{s.label}</dt>
                  <dd className="font-mono text-2xl font-semibold text-white sm:text-3xl"><CountUp to={s.v} delay={400 + i * 120} /></dd>
                  <div className="mt-1 text-xs text-stone-400">{s.label}</div>
                </div>
              ))}
            </motion.dl>
          </div>

          <motion.div
            initial={{ opacity: 0, scale: 0.94, rotateX: 8 }}
            animate={{ opacity: 1, scale: 1, rotateX: 0 }}
            transition={{ duration: 1, delay: 0.2, ease: [0.22, 1, 0.36, 1] }}
            style={{ transformPerspective: 1200 }}
          >
            <LiveArchitecture />
          </motion.div>
        </div>
      </div>
    </section>
  );
}

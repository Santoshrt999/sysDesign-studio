"use client";
// Author: Santosh Goteti
import { useEffect, useId, useState } from "react";

export function MermaidView({ code }: { code: string }) {
  const [svg, setSvg] = useState("");
  const [err, setErr] = useState("");
  const id = "m" + useId().replace(/[^a-zA-Z0-9]/g, "");
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const mermaid = (await import("mermaid")).default;
      mermaid.initialize({ startOnLoad: false, theme: "neutral", sequence: { mirrorActors: false, showSequenceNumbers: true } });
      try {
        const out = await mermaid.render(id, code);
        if (!cancelled) { setSvg(out.svg); setErr(""); }
      } catch (e) {
        if (!cancelled) setErr(String(e));
      }
    })();
    return () => { cancelled = true; };
  }, [code, id]);
  if (err) return <pre className="whitespace-pre-wrap text-xs text-red-600">{err}</pre>;
  return <div className="overflow-x-auto rounded-xl border border-stone-200 bg-white p-4 [&_svg]:mx-auto" dangerouslySetInnerHTML={{ __html: svg }} />;
}

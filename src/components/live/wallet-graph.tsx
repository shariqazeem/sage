"use client";

import { useEffect, useMemo, useState } from "react";
import { Share2 } from "lucide-react";
import type { WalletGraph as G } from "@/lib/graph/wallet-graph";

/**
 * THE WALLET GRAPH, drawn. A small force layout (repulsion between every pair, springs on every
 * edge, gravity to the centre, the vault pinned there), run deterministically on mount so the same
 * ledger always draws the same picture. Consolidation edges are the loud ones: a payout that was
 * forwarded between two submitters is one person's wallets, and the picture says so.
 */
function layout(g: G, w: number, h: number): Map<string, { x: number; y: number }> {
  const pos = new Map<string, { x: number; y: number; vx: number; vy: number }>();
  let seed = 7;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  g.nodes.forEach((n, i) => pos.set(n.id, n.kind === "vault" ? { x: w / 2, y: h / 2, vx: 0, vy: 0 } : { x: w / 2 + Math.cos((i / g.nodes.length) * Math.PI * 2) * (h * 0.3) + rnd() * 8, y: h / 2 + Math.sin((i / g.nodes.length) * Math.PI * 2) * (h * 0.3) + rnd() * 8, vx: 0, vy: 0 }));
  const ids = g.nodes.map((n) => n.id);
  const k = { rep: 2600, spring: 0.015, grav: 0.012, damp: 0.82 };
  const rest = (kind: string) => (kind === "consolidation" ? 60 : kind === "gas" ? 90 : Math.min(h * 0.32, 150));
  for (let it = 0; it < 260; it++) {
    for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) {
      const a = pos.get(ids[i])!, b = pos.get(ids[j])!;
      let dx = b.x - a.x, dy = b.y - a.y; const d2 = dx * dx + dy * dy + 0.01; const d = Math.sqrt(d2);
      const f = k.rep / d2; dx /= d; dy /= d;
      a.vx -= dx * f; a.vy -= dy * f; b.vx += dx * f; b.vy += dy * f;
    }
    for (const e of g.edges) {
      const a = pos.get(e.from), b = pos.get(e.to); if (!a || !b) continue;
      const dx = b.x - a.x, dy = b.y - a.y; const d = Math.sqrt(dx * dx + dy * dy) + 0.01;
      const f = (d - rest(e.kind)) * k.spring; const ux = dx / d, uy = dy / d;
      a.vx += ux * f; a.vy += uy * f; b.vx -= ux * f; b.vy -= uy * f;
    }
    for (const n of g.nodes) {
      const p = pos.get(n.id)!;
      if (n.kind === "vault") { p.x = w / 2; p.y = h / 2; p.vx = 0; p.vy = 0; continue; }
      p.vx += (w / 2 - p.x) * k.grav; p.vy += (h / 2 - p.y) * k.grav;
      p.vx *= k.damp; p.vy *= k.damp; p.x += p.vx; p.y += p.vy;
      p.x = Math.max(28, Math.min(w - 28, p.x)); p.y = Math.max(24, Math.min(h - 24, p.y));
    }
  }
  return new Map([...pos.entries()].map(([id, p]) => [id, { x: p.x, y: p.y }]));
}

export function WalletGraph({ campaignId, title = "Wallet graph" }: { campaignId: string; title?: string }) {
  const [g, setG] = useState<G | null>(null);
  const [tip, setTip] = useState<{ x: number; y: number; text: string } | null>(null);
  const W = 800, H = 450;
  useEffect(() => {
    let alive = true;
    void fetch(`/api/campaigns/${campaignId}/graph`, { cache: "no-store" }).then(async (r) => { if (r.ok && alive) setG((await r.json()) as G); }).catch(() => {});
    return () => { alive = false; };
  }, [campaignId]);
  const pos = useMemo(() => (g ? layout(g, W, H) : null), [g]);
  if (!g || !pos) return null;
  const clustered = g.nodes.filter((n) => n.clustered).length;
  const paid = g.nodes.filter((n) => n.status === "paid").length;
  return (
    <section className="lv-card">
      <div className="lv-h">
        <h2><Share2 size={15} /> {title}</h2>
        <span className="lv-tele"><span><b>{g.nodes.length - 1}</b> wallets</span><span><b>{paid}</b> paid</span><span><b>{clustered}</b> in a linked cluster</span><span><b>{g.edges.filter((e) => e.kind === "gas").length}</b> gas links</span></span>
      </div>
      <div className="lv-graph">
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Wallet graph of ${g.title}`}>
          {g.edges.map((e, i) => {
            const a = pos.get(e.from), b = pos.get(e.to); if (!a || !b) return null;
            return <line key={i} className={`e-${e.kind}`} x1={a.x} y1={a.y} x2={b.x} y2={b.y} />;
          })}
          {g.nodes.map((n) => {
            const p = pos.get(n.id)!;
            const text = n.kind === "vault" ? `the vault\n${g.title}` : `${n.label}\n${n.status ?? ""}${n.paidBase ? ` · $${(n.paidBase / 1e6).toFixed(2)} paid` : ""}${n.clustered ? "\nlinked cluster" : ""}${n.flags.length ? `\n${n.flags.join(", ")}` : ""}`;
            return (
              <g key={n.id} className={`n ${n.kind} ${n.status ?? ""}${n.clustered ? " clustered" : ""}`} transform={`translate(${p.x},${p.y})`} onMouseEnter={() => setTip({ x: p.x / W * 100, y: p.y / H * 100, text })} onMouseLeave={() => setTip(null)}>
                {n.clustered && <circle className="halo" r={22} />}
                {n.kind === "vault" ? <rect x={-14} y={-14} width={28} height={28} rx={7} /> : <circle r={n.paidBase ? 10 : 8} />}
                <text y={n.kind === "vault" ? 3.5 : 22} textAnchor="middle">{n.kind === "vault" ? "$" : n.label}</text>
              </g>
            );
          })}
        </svg>
        <div className={`lv-tip${tip ? " on" : ""}`} style={tip ? { left: `${tip.x}%`, top: `${tip.y}%` } : undefined}>{tip?.text}</div>
      </div>
      <div className="lv-legend">
        <span><i className="payout" /> paid by the vault</span>
        <span><i className="gas" /> gas funded by another submitter</span>
        <span><i className="consolidation" /> payout forwarded between submitters</span>
        <span><b /> linked cluster: one person&rsquo;s wallets</span>
        {g.partial && <span>showing the first 60 wallets</span>}
      </div>
    </section>
  );
}

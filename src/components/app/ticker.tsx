"use client";

import { useEffect, useRef, useState } from "react";

interface Line {
  id: string;
  at: number;
  text: string;
}

/** HH:MM:SS in UTC — deterministic, formatted client-side (this is a client component). */
function hhmmss(at: number): string {
  const d = new Date(at * 1000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`;
}

/**
 * The terminal ticker atop /app — real journal events in mono, streaming. Polls
 * every 5s (paused when the tab is hidden), version-gated so an unchanged payload
 * is a no-op. Oldest scrolls out to the left; the track is doubled for a seamless
 * loop. Under reduced motion it renders only the latest line, statically. Empty
 * (nothing real yet) → renders nothing, per the feed rule.
 */
export function Ticker() {
  const [lines, setLines] = useState<Line[]>([]);
  const lastVer = useRef<string>("");

  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null;
    const tick = async () => {
      if (typeof document !== "undefined" && document.hidden) return;
      try {
        const res = await fetch("/api/deputy/ticker", { cache: "no-store" });
        if (!res.ok) return;
        const j = (await res.json()) as { lines?: Line[] };
        const next = j.lines ?? [];
        const ver = next.map((l) => l.id).join(",");
        if (ver === lastVer.current) return; // unchanged → no-op
        lastVer.current = ver;
        setLines(next);
      } catch {
        /* transient — next tick retries */
      }
    };
    void tick();
    timer = setInterval(() => void tick(), 5000);
    const onVis = () => {
      if (!document.hidden) void tick();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      if (timer) clearInterval(timer);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, []);

  if (lines.length === 0) return null;

  // oldest → newest so the oldest scrolls off the left edge first.
  const ordered = [...lines].reverse();
  const latest = lines[0]!; // newest, for the reduced-motion static line

  return (
    <div className="sage-ticker" role="log" aria-label="Live agent activity">
      <div className="sage-ticker-track" aria-hidden>
        {[...ordered, ...ordered].map((l, i) => (
          <span className="sage-ticker-item mono" key={`${l.id}-${i}`}>
            <span className="sage-ticker-time">{hhmmss(l.at)}</span>
            {l.text}
          </span>
        ))}
      </div>
      <span className="sage-ticker-latest mono">
        <span className="sage-ticker-time">{hhmmss(latest.at)}</span>
        {latest.text}
      </span>
    </div>
  );
}

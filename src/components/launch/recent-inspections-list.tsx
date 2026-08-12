"use client";

import { useEffect, useState } from "react";
import { History } from "lucide-react";
import { readRecentInspections, type RecentInspection } from "@/lib/launch/recent-inspections";

/**
 * "YOUR INSPECTIONS" — the way back. Renders only when this browser has history, so a first-time
 * founder sees nothing extra. Statuses are fetched live from the same status API the plan page
 * polls; a fetch failure shows the link without a status rather than hiding the way back.
 */
export function RecentInspectionsList() {
  const [items, setItems] = useState<RecentInspection[]>([]);
  const [statuses, setStatuses] = useState<Record<string, string>>({});

  useEffect(() => {
    const recent = readRecentInspections();
    setItems(recent);
    let alive = true;
    void (async () => {
      const entries = await Promise.all(
        recent.slice(0, 8).map(async (r) => {
          try {
            const res = await fetch(`/api/launch/${r.id}`, { cache: "no-store" });
            const data = (await res.json()) as { ok?: boolean; job?: { status?: string } };
            return [r.id, data.ok && data.job?.status ? data.job.status : ""] as const;
          } catch {
            return [r.id, ""] as const;
          }
        }),
      );
      if (alive) setStatuses(Object.fromEntries(entries));
    })();
    return () => {
      alive = false;
    };
  }, []);

  if (items.length === 0) return null;

  const label = (s: string | undefined): string => {
    switch (s) {
      case "ready":
        return "plan ready";
      case "needs_input":
        return "needs your input";
      case "failed":
        return "didn't finish";
      case "claimed":
        return "launched";
      case undefined:
      case "":
        return "";
      default:
        return "in progress";
    }
  };

  return (
    <section className="lx-recent" aria-label="Your inspections">
      <div className="lx-recent-head">
        <History size={14} aria-hidden />
        Your inspections
      </div>
      <ul className="lx-recent-list">
        {items.slice(0, 8).map((r) => {
          const s = label(statuses[r.id]);
          return (
            <li key={r.id}>
              <a className="lx-recent-row" href={`/launch/${r.id}`}>
                <span className="lx-recent-host">{r.host}</span>
                {s && <span className={`lx-recent-status${statuses[r.id] === "ready" ? " ok" : ""}`}>{s}</span>}
                <span className="lx-recent-when">
                  {new Date(r.at).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                </span>
              </a>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

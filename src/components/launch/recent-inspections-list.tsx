"use client";

import { useEffect, useState } from "react";
import { History } from "lucide-react";
import { readRecentInspections } from "@/lib/launch/recent-inspections";
import { useFounderSession } from "@/lib/auth/use-founder-session";

/**
 * "YOUR INSPECTIONS" — the way back.
 *
 * IT USED TO BE A LIST OF THIS BROWSER, NOT OF THIS PERSON. Entries came only from localStorage,
 * which made it wrong in both directions: a founder who inspected on a laptop and returned on a
 * phone saw nothing, though every job sat in the database under their wallet — and a second wallet
 * signing in on a shared browser was shown the first one's product URLs under the word "Your".
 *
 * Signed in, the server is the source of truth and the list follows the wallet across devices.
 * Local entries are still merged, but ONLY those the server says are unclaimed — that is the
 * original purpose of the local store, so that work started before signing in is not stranded.
 * Anything belonging to another wallet is dropped.
 *
 * Signed out, it behaves exactly as before: local history, which is the only way back a founder
 * without a wallet has.
 */

interface Entry {
  id: string;
  host: string;
  status: string;
  /** When it was started, so the list reads the same as it always has. */
  at: number;
}

const hostOf = (url: string): string => {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
};

export function RecentInspectionsList() {
  const founder = useFounderSession();
  const [entries, setEntries] = useState<Entry[]>([]);

  useEffect(() => {
    if (founder.loading) return;
    let alive = true;

    void (async () => {
      const byId = new Map<string, Entry>();

      // 1. The server's own record for this founder — authoritative, and it crosses devices.
      if (founder.authed) {
        try {
          const res = await fetch("/api/launch/mine", { cache: "no-store" });
          const data = (await res.json()) as {
            jobs?: { id: string; productUrl: string; status: string; createdAt: number }[];
          };
          for (const j of data.jobs ?? []) {
            byId.set(j.id, {
              id: j.id,
              host: hostOf(j.productUrl),
              status: j.status,
              // Stored in seconds; the row renders a date.
              at: j.createdAt * 1000,
            });
          }
        } catch {
          /* fall back to whatever this browser remembers */
        }
      }

      // 2. This browser's own history. Each is asked whether it is actually the caller's, so a
      //    job owned by a different wallet is never listed under "Your inspections".
      const local = readRecentInspections().slice(0, 12);
      const resolved = await Promise.all(
        local.map(async (r) => {
          if (byId.has(r.id)) return null; // already known from the server
          try {
            const res = await fetch(`/api/launch/${r.id}`, { cache: "no-store" });
            const d = (await res.json()) as {
              ok?: boolean;
              ownership?: string;
              job?: { status?: string };
            };
            if (!d.ok) return null;
            // Signed in: keep only unclaimed work. Signed out: everything local is "the way back".
            if (founder.authed && d.ownership !== "anonymous" && d.ownership !== "yours") {
              return null;
            }
            return { id: r.id, host: r.host, status: d.job?.status ?? "", at: r.at };
          } catch {
            // A failed lookup while signed OUT still shows the link — losing the way back is
            // worse than showing a row without a status. Signed in, the server list stands alone.
            return founder.authed ? null : { id: r.id, host: r.host, status: "", at: r.at };
          }
        }),
      );
      for (const e of resolved) if (e) byId.set(e.id, e);

      if (alive) setEntries([...byId.values()].slice(0, 8));
    })();

    return () => {
      alive = false;
    };
  }, [founder.authed, founder.loading, founder.address]);

  if (entries.length === 0) return null;

  return (
    <section className="lx-recent" aria-label="Your inspections">
      <div className="lx-recent-head">
        <History size={14} aria-hidden />
        Your inspections
      </div>
      <ul className="lx-recent-list">
        {entries.map((e) => {
          const s = label(e.status);
          return (
            <li key={e.id}>
              <a className="lx-recent-row" href={`/launch/${e.id}`}>
                <span className="lx-recent-host">{e.host}</span>
                {s && <span className={`lx-recent-status${e.status === "ready" ? " ok" : ""}`}>{s}</span>}
                <span className="lx-recent-when">
                  {new Date(e.at).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                </span>
              </a>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** Unchanged from the original: the same words, for the same statuses. */
function label(s: string | undefined): string {
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
}

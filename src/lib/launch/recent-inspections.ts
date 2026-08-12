"use client";

/**
 * "YOUR INSPECTIONS" — client-side memory of the plans this browser has started or viewed.
 *
 * Inspections are durable server-side (the /launch/<id> permalink outlives everything), but an
 * anonymous founder who closes the tab used to lose the only pointer to their own plan. The most
 * privacy-preserving fix is no accounts and no server list: this browser remembers its own ids in
 * localStorage, newest first, capped. Wallet-connected founders get nothing worse; anonymous
 * founders get their way back.
 */
export interface RecentInspection {
  id: string;
  host: string;
  at: number;
}

const KEY = "sage.recentInspections.v1";
const CAP = 12;

export function readRecentInspections(): RecentInspection[] {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (x): x is RecentInspection =>
          !!x &&
          typeof (x as RecentInspection).id === "string" &&
          typeof (x as RecentInspection).host === "string" &&
          typeof (x as RecentInspection).at === "number",
      )
      .slice(0, CAP);
  } catch {
    return [];
  }
}

export function rememberInspection(id: string, productUrl: string): void {
  try {
    let host = productUrl;
    try {
      host = new URL(productUrl).host;
    } catch {
      /* keep the raw string */
    }
    const rest = readRecentInspections().filter((r) => r.id !== id);
    const next = [{ id, host, at: Date.now() }, ...rest].slice(0, CAP);
    window.localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* localStorage unavailable (private mode) — the permalink still works */
  }
}

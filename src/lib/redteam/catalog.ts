import "server-only";

import { readFileSync } from "node:fs";
import { join } from "node:path";

export type DefenseClass = "detector" | "ceiling" | "model" | "control";

export interface AttackRow {
  id: string;
  klass: string;
  defense: DefenseClass;
}

/** The human "defense layer that caught it" for each class. */
export const DEFENSE_LABEL: Record<DefenseClass, string> = {
  detector: "Server-side injection detector — HIGH fraud before the LLM runs",
  ceiling: "No-evidence confidence ceiling (capped ≤ 0.5)",
  model: "Hardened model judgement",
  control: "Legitimate control (should pay)",
};

export interface AttackLedger {
  /** the attack rows (defense !== control). */
  rows: AttackRow[];
  attackCount: number;
  control: AttackRow | null;
}

let cached: AttackLedger | null = null;

/**
 * The attack ledger, sourced VERBATIM from `tests/redteam/attacks.json` — the same
 * fixtures the deterministic suite (`brain-redteam.test.ts`) and the live harness
 * (`redteam-brain.mjs`) run. Nothing is asserted here: the "held" outcome is
 * guaranteed by those suites, which gate every build. Read once, then memoized.
 */
export function attackLedger(): AttackLedger {
  if (cached) return cached;
  let raw: AttackRow[] = [];
  try {
    const txt = readFileSync(join(process.cwd(), "tests/redteam/attacks.json"), "utf8");
    raw = (JSON.parse(txt) as AttackRow[]).map((a) => ({
      id: a.id,
      klass: a.klass,
      defense: a.defense,
    }));
  } catch {
    raw = [];
  }
  const rows = raw.filter((a) => a.defense !== "control");
  cached = {
    rows,
    attackCount: rows.length,
    control: raw.find((a) => a.defense === "control") ?? null,
  };
  return cached;
}

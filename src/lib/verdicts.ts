/**
 * Verdict taxonomy for Sage.
 *
 * These are the only verdicts Sage may issue. Each maps to a fixed color token
 * defined in `globals.css` (see CLAUDE.md > Design system rules). This module is
 * intentionally presentational/metadata only — scoring logic lives elsewhere.
 */
export const VERDICTS = ["SAFE", "RISKY", "SCAM"] as const;

export type Verdict = (typeof VERDICTS)[number];

export interface VerdictMeta {
  /** Human-facing label (always uppercase). */
  label: Verdict;
  /** One-line description of what the verdict asserts. */
  description: string;
  /** Tailwind color token suffix backing this verdict (e.g. `verdict-safe`). */
  token: `verdict-${Lowercase<Verdict>}`;
}

export const VERDICT_META: Record<Verdict, VerdictMeta> = {
  SAFE: {
    label: "SAFE",
    description:
      "No disqualifying evidence found within the investigation window.",
    token: "verdict-safe",
  },
  RISKY: {
    label: "RISKY",
    description: "Material risk signals present; proceed only with caution.",
    token: "verdict-risky",
  },
  SCAM: {
    label: "SCAM",
    description: "Strong evidence of intent to defraud or rug holders.",
    token: "verdict-scam",
  },
};

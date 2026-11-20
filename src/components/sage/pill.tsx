import type { ReactNode } from "react";

/**
 * A STATUS CHIP: the only pill in the product. `ok` is for money that was paid and `err` for money
 * that was not; neither is ever a generic accent.
 */
export type PillTone = "neutral" | "ink" | "accent" | "ok" | "err";

export function Pill({ tone = "neutral", children }: { tone?: PillTone; children: ReactNode }) {
  return (
    <span className="sg-pill" data-tone={tone}>
      {children}
    </span>
  );
}

import { cn } from "@/lib/utils";
import { type Verdict, VERDICT_META } from "@/lib/verdicts";

const VERDICT_STYLES: Record<Verdict, string> = {
  SAFE: "border-verdict-safe/40 text-verdict-safe bg-verdict-safe/10",
  RISKY: "border-verdict-risky/40 text-verdict-risky bg-verdict-risky/10",
  SCAM: "border-verdict-scam/40 text-verdict-scam bg-verdict-scam/10",
};

export interface VerdictBadgeProps {
  verdict: Verdict;
  className?: string;
}

/**
 * Border-driven verdict chip. Monospace, uppercase, with a solid color square.
 * No gradient, no glow — color + border carry the meaning.
 */
export function VerdictBadge({ verdict, className }: VerdictBadgeProps) {
  return (
    <span
      data-slot="verdict-badge"
      data-verdict={verdict}
      title={VERDICT_META[verdict].description}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-sm border px-2 py-0.5 font-mono text-xs font-semibold tracking-widest uppercase",
        VERDICT_STYLES[verdict],
        className,
      )}
    >
      <span aria-hidden className="size-1.5 rounded-[1px] bg-current" />
      {VERDICT_META[verdict].label}
    </span>
  );
}

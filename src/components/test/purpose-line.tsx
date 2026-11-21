import type { JobView } from "@/components/launch/types";

/**
 * WHAT SAGE THINKS YOU CAME FOR (21 Nov 2026). The architect reads what this builder most likely came for and
 * ranks the first-try mission by it; the builder sees that read beside the missions it shaped, in Sage's own two
 * checked sentences, so a wrong read is caught before any money moves (they can ask for a different plan).
 */
const BECAUSE: Record<NonNullable<JobView["purpose"]>["rank"], string> = {
  lead: "So every tester starts with the first-try mission: what they took it to be, how far they got, and whether they would come back.",
  alongside: "So the first-try mission sits beside the flows you named.",
  yield:
    "So the flow you named comes first. On a small budget, the first-try mission is the one that waits.",
};

export function PurposeLine({
  purpose,
}: {
  purpose: NonNullable<JobView["purpose"]>;
}) {
  return (
    <div className="sg-stack sg-gap-2">
      <span className="sg-label">What Sage thinks you want</span>
      <p>{purpose.line}</p>
      <p className="sg-small">
        {BECAUSE[purpose.rank]}
        {purpose.why ? ` ${purpose.why}` : ""}
      </p>
    </div>
  );
}

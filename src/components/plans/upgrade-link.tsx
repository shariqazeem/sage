import Link from "next/link";
import { PLANS, type PlanId } from "@/lib/plans/catalog";

/**
 * A REFUSAL ALWAYS NAMES ITS WAY THROUGH. When a plan's limit stops a launch or a feature, the
 * message says which plan lifts it and this opens Settings on that plan, ready to pay. Without a
 * plan that would help (nothing does), it offers the conversation instead.
 */
export function UpgradeLink({ to, className = "ws-chip" }: { to: PlanId | null | undefined; className?: string }) {
  if (!to) return <Link className={className} href="/company#contact">Talk to us</Link>;
  if (PLANS[to].priceUsd === null) return <Link className={className} href="/company#contact">Talk to us about {PLANS[to].name}</Link>;
  return (
    <Link className={className} href={`/workspace/settings?plan=${to}#plan`}>
      Upgrade to {PLANS[to].name}
    </Link>
  );
}

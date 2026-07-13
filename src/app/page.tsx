import "./cinematic.css";
import "./app/motion.css";
import "./app/demo-moments.css";
import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  activeNetwork,
  getOperatorPayoutHistory,
  getOperatorVaultState,
} from "@/lib/deputy/chain";
import { getStarReceipt } from "@/lib/db/campaigns";
import { briefFromRow } from "@/lib/deputy/decisions";
import { ecosystemStatus } from "@/lib/ecosystem/status";
import { CinematicLanding } from "@/components/landing/cinematic-landing";

// The landing binds to live vault state on each request — the hero balance, the
// receipt in Act 3, the payout feed and the closing stats are all real on-chain.
export const dynamic = "force-dynamic";

export default async function HomePage() {
  const net = activeNetwork();
  const vault = await getOperatorVaultState("launch-growth");
  const decimals = vault?.raw.decimals ?? 6;
  const history = await getOperatorPayoutHistory("launch-growth", decimals);
  // The 3D hero render is dropped in later; render it the moment it exists,
  // otherwise the styled placeholder holds its slot (no broken image, no 404).
  const hasHero = existsSync(join(process.cwd(), "public", "hero-vault.png"));

  // Act 3's star: a REAL decision receipt from a settled payout (prefer an LLM
  // "pay"). Never fabricated — null falls back to the on-chain check rail, and it
  // upgrades itself the moment a mainnet LLM decision settles.
  const star = getStarReceipt();
  const receipt = star
    ? {
        brief: briefFromRow(star.decision),
        rewardUsd: star.rewardBase / 10 ** decimals,
        txHash: star.payoutTx,
        threshold: star.threshold,
      }
    : null;

  // The honest ecosystem strip — each claim shown only when it is really true.
  const ecosystem = await ecosystemStatus();

  return (
    <CinematicLanding
      vault={vault}
      history={history}
      network={{ name: net.name, chainId: net.chainId }}
      hasHero={hasHero}
      receipt={receipt}
      now={Date.now()}
      ecosystem={ecosystem}
    />
  );
}

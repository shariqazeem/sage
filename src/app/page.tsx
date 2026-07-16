import "./cinematic.css";
import "./app/motion.css";
import "./app/demo-moments.css";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { getOperatorVaultState } from "@/lib/deputy/chain";
import { chainConfig } from "@/lib/deputy/networks";
import { getStarReceipt } from "@/lib/db/campaigns";
import { getPublicReceipts } from "@/lib/erc8004/reputation";
import { briefFromRow } from "@/lib/deputy/decisions";
import { ecosystemStatus } from "@/lib/ecosystem/status";
import { CinematicLanding } from "@/components/landing/cinematic-landing";

// The landing binds to live vault state on each request — the hero balance, the
// receipt in Act 3, the payout feed and the closing stats are all real on-chain.
export const dynamic = "force-dynamic";

export default async function HomePage() {
  // The landing is the MAINNET showcase — GOAT Network, real USDC. Only real GOAT
  // payouts appear, and the hero counts what the agent has actually settled to real
  // people, so the "moment of truth" is never a testnet number.
  const net = chainConfig(2345);
  const vault = await getOperatorVaultState("launch-growth");
  const decimals = vault?.raw.decimals ?? 6;
  // The payout feed + closing stats come from the SAME clean, deduped record the agent card uses
  // (real journal, sandbox-excluded) — NOT the vault's raw on-chain log, which carried old test
  // spends and rendered as phantom trillions. Honest small real numbers instead.
  const history = getPublicReceipts().filter((h) => h.chainId === 2345);
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

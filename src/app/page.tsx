import "./cinematic.css";
import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  activeNetwork,
  getOperatorPayoutHistory,
  getOperatorVaultState,
} from "@/lib/deputy/chain";
import { CinematicLanding } from "@/components/landing/cinematic-landing";

// The landing binds to live vault state on each request — the hero balance, the
// check-rail cap, the payout feed and the closing stats are all real on-chain.
export const dynamic = "force-dynamic";

export default async function HomePage() {
  const net = activeNetwork();
  const vault = await getOperatorVaultState("launch-growth");
  const history = await getOperatorPayoutHistory(
    "launch-growth",
    vault?.raw.decimals ?? 6,
  );
  // The 3D hero render is dropped in later; render it the moment it exists,
  // otherwise the styled placeholder holds its slot (no broken image, no 404).
  const hasHero = existsSync(join(process.cwd(), "public", "hero-vault.png"));

  return (
    <CinematicLanding
      vault={vault}
      history={history}
      network={{ name: net.name }}
      hasHero={hasHero}
      now={Date.now()}
    />
  );
}

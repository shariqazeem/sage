import "server-only";

import { getAddress } from "viem";
import type { AgentWallet } from "@/lib/db/schema";
import { getAgentWallet, updateMandate } from "@/lib/db/agent-wallets";
import { GOAT_USDC } from "@/lib/deputy/networks";
import { launchChainConfig } from "@/lib/launch/deployment-service";
import { createMandatePolicy, type MandateSpec } from "./mandate";
import { mandateName } from "./mandate-name";
import { setWalletPolicies } from "./client";

/** The cap a founder may choose for one campaign, in whole USDC — the same bounds as opening. */
export const CAP_MIN_USD = 1;
export const CAP_MAX_USD = 10_000;

/**
 * CHANGE THE PER-CAMPAIGN CAP of an account after it is open.
 *
 * A Privy policy is immutable in our code and a mandate is a policy, so "raise the cap" is: build
 * the same mandate with the new cap, create it as a NEW policy, point the wallet at that policy
 * alone, and record the new policy id and cap on the row. The same swap-and-repoint that a
 * withdrawal does for its one-time permit, only this one is meant to stay. The old policy is left
 * behind at Privy, attached to nothing.
 *
 * The reclaim address is carried over: raising the cap must never widen where unspent money can go.
 * Order matters — the row is updated only after the wallet is on the new policy, so a failure
 * leaves the founder on the old cap with a row that still says so.
 */
export async function setAccountCap(wallet: AgentWallet, capBase: bigint): Promise<AgentWallet> {
  const usd = Number(capBase) / 1_000_000;
  if (!(usd >= CAP_MIN_USD && usd <= CAP_MAX_USD)) throw new Error(`the cap must be between ${CAP_MIN_USD} and ${CAP_MAX_USD} USDC`);
  const cfg = launchChainConfig(wallet.chainId);
  if (!cfg.factory) throw new Error(`campaign factory not configured for chain ${wallet.chainId}`);
  const spec: MandateSpec = {
    name: mandateName(wallet.chatId),
    factory: getAddress(cfg.factory),
    usdc: getAddress(cfg.token ?? GOAT_USDC),
    reclaim: getAddress(wallet.founderAddress),
    perCampaignCapBase: capBase,
  };
  const policyId = await createMandatePolicy(spec);
  await setWalletPolicies(wallet.privyWalletId, [policyId]);
  updateMandate(wallet.chatId, policyId, Number(capBase));
  const saved = getAgentWallet(wallet.chatId);
  if (!saved) throw new Error("the account row vanished while its cap was being changed");
  return saved;
}

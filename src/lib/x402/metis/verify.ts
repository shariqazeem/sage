import "server-only";

import type { MetisChain } from "./chain";
import type { MetisFacilitatorConfig } from "./config";
import { PERMIT2_ADDRESS, VERIFY_DEADLINE_MARGIN_SECONDS } from "./constants";
import { parseFacilitatorRequest } from "./parse";
import { encodeSettleCall, paymentKey } from "./settle-core";
import type { ClaimStore } from "./store";
import type { Check, ParsedPayment, VerifyResponse } from "./types";
import {
  checkPayment,
  judgeChainFacts,
  judgeClaim,
  judgeSimulation,
  nonceWordPos,
  type StaticPolicy,
} from "./verify-core";

/**
 * POST /verify (x402-specification-v2.md §7.1): READ-ONLY. It reads the chain and the claim ledger
 * and writes neither; a payment it calls valid is one /settle would broadcast right now.
 *
 * A failure to reach Metis is not a verdict. It throws, and the route answers 500 with
 * `unexpected_verify_error`, so a resource server never turns away a good payment because a node
 * was slow.
 */

export interface VerifyDeps {
  config: Pick<MetisFacilitatorConfig, "account" | "proxy" | "assets" | "payToAllowlist">;
  chain: MetisChain;
  claims: Pick<ClaimStore, "get">;
  nowSeconds: () => number;
}

export function policyOf(config: VerifyDeps["config"]): StaticPolicy {
  return { proxy: config.proxy, assets: config.assets, payToAllowlist: config.payToAllowlist };
}

/**
 * The on-chain half, shared with /settle: the payer is an EOA, Permit2 is approved, the balance
 * covers it, the nonce is unspent, and the settle call itself succeeds when simulated from the
 * facilitator's address (scheme_exact_evm.md §2 Phase 3 step 7: "Simulate x402ExactPermit2Proxy.settle").
 */
export async function verifyOnChain(p: ParsedPayment, deps: Pick<VerifyDeps, "config" | "chain">): Promise<Check> {
  const [payerHasCode, allowance, balance, nonceBitmap] = await Promise.all([
    deps.chain.hasCode(p.payer),
    deps.chain.allowance(p.token, p.payer, PERMIT2_ADDRESS),
    deps.chain.balanceOf(p.token, p.payer),
    deps.chain.nonceBitmap(p.payer, nonceWordPos(p.nonce)),
  ]);
  const facts = judgeChainFacts(p, { payerHasCode, allowance, balance, nonceBitmap });
  if (!facts.ok) return facts;
  const sim = await deps.chain.simulate(deps.config.account.address, deps.config.proxy, encodeSettleCall(p));
  return judgeSimulation(sim);
}

function invalid(reason: string, message: string, payer?: string): VerifyResponse {
  return { isValid: false, invalidReason: reason, invalidMessage: message, ...(payer ? { payer } : {}) };
}

export async function verifyPayment(body: unknown, deps: VerifyDeps): Promise<VerifyResponse> {
  const parsed = parseFacilitatorRequest(body);
  if (!parsed.ok) return invalid(parsed.reason, parsed.message, parsed.payer);
  const p = parsed.payment;

  const terms = await checkPayment(p, policyOf(deps.config), deps.nowSeconds(), VERIFY_DEADLINE_MARGIN_SECONDS);
  if (!terms.ok) return invalid(terms.reason, terms.message, p.payer);

  // The ledger first: a payment this facilitator is already settling is spoken for, whatever the
  // chain shows in the seconds before its transaction lands.
  const claim = judgeClaim(deps.claims.get(paymentKey(p.payer, p.nonce))?.status ?? null);
  if (!claim.ok) return invalid(claim.reason, claim.message, p.payer);

  const chain = await verifyOnChain(p, deps);
  if (!chain.ok) return invalid(chain.reason, chain.message, p.payer);

  return { isValid: true, payer: p.payer };
}

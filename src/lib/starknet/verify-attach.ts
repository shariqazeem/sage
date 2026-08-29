import type { MissionTerms, VaultState } from "./vault";

/**
 * DOES THIS VAULT ACTUALLY BACK THIS PLAN?
 *
 * A founder deploys their own vault and then tells Sage about it. The address arrives from a
 * browser, and a browser can send anything — so nothing here is taken on trust: every input is
 * something read back off the chain, and this decides whether a campaign may exist against it.
 *
 * Pure, and separate from the endpoint, because these are the checks that decide whether a worker
 * can be paid for work they have not yet done. Inline in a route handler they could only be
 * exercised by standing up a chain; here each one can be shown to fire.
 *
 * The ordering is deliberate: whoever/whatever the vault is comes before what it holds, because
 * "this is not your vault" is a truer answer than "your vault is short $3".
 */

export interface PlanMission {
  title: string;
  /** The felt its terms are stored under — the same one settlement will look up. */
  missionId: string;
  rewardBase: bigint;
  maxCompletions: number;
}

export interface AttachInputs {
  state: VaultState;
  /** The token's own ledger for this vault, not the vault's accounting. */
  balanceBase: bigint;
  /** What each mission's terms actually read as on chain, keyed by mission id. */
  onChainMissions: Map<string, MissionTerms>;
  sageOperator: string;
  claimedOwner: string;
  missions: PlanMission[];
}

export type AttachVerdict = { ok: true } | { ok: false; reason: string };

const usd = (base: bigint): string => `$${(Number(base) / 1e6).toFixed(2)}`;

/** Starknet addresses have many spellings that differ only in leading zeros. */
const sameAddress = (a: string, b: string): boolean => {
  try {
    return BigInt(a) === BigInt(b);
  } catch {
    return false;
  }
};

export function verifyVaultBacksPlan(input: AttachInputs): AttachVerdict {
  const { state, missions } = input;

  if (!sameAddress(state.operator, input.sageOperator)) {
    // A vault naming someone else's operator would accept work Sage can never pay for.
    return {
      ok: false,
      reason: "That vault does not name Sage as its operator, so Sage could never pay from it.",
    };
  }
  if (!sameAddress(state.owner, input.claimedOwner)) {
    // Otherwise a stranger could attach someone else's vault and revoke a founder's campaign.
    return {
      ok: false,
      reason: "That vault is owned by a different wallet than the one attaching it.",
    };
  }
  if (state.statusLabel !== "active") {
    return { ok: false, reason: `That vault is ${state.statusLabel}, so it cannot pay anyone yet.` };
  }

  if (!missions.length) {
    return { ok: false, reason: "This plan has no missions to attach." };
  }

  const totalBase = missions.reduce(
    (sum, m) => sum + m.rewardBase * BigInt(m.maxCompletions),
    BigInt(0),
  );

  if (state.budgetCeilingBase < totalBase) {
    // A ceiling below the plan means the last workers could never be paid. Better to refuse now
    // than to accept submissions against a budget that runs out partway through.
    return {
      ok: false,
      reason: `That vault's ceiling is ${usd(state.budgetCeilingBase)}, below this plan's ${usd(totalBase)}.`,
    };
  }

  // THE CEILING IS A LIMIT THE OWNER SET, NOT PROOF OF FUNDS. A vault deployed with a generous
  // ceiling and never funded passes every check above and pays nobody.
  if (input.balanceBase < totalBase) {
    return {
      ok: false,
      reason: `That vault is ${usd(totalBase - input.balanceBase)} short of this plan's budget.`,
    };
  }

  // MISSION BY MISSION — the check that protects the worker rather than the founder.
  //
  // Everything above concerns totals, and totals cannot catch a vault whose individual missions
  // are written at a fraction of what the board advertises. The campaign would publish a mission
  // worth $1.00, a tester would do the work, and the vault — which alone decides the amount —
  // would release $0.01. Sage would have published a price it cannot honour.
  for (const m of missions) {
    const terms = input.onChainMissions.get(m.missionId);
    if (!terms || !terms.exists) {
      return {
        ok: false,
        reason: `The vault holds no terms for "${m.title}", so Sage could never pay for it.`,
      };
    }
    if (terms.rewardBase !== m.rewardBase) {
      return {
        ok: false,
        reason: `The vault pays ${usd(terms.rewardBase)} for "${m.title}" but the plan advertises ${usd(m.rewardBase)}. Sage will not publish a price it cannot honour.`,
      };
    }
    if (terms.maxCompletions !== m.maxCompletions) {
      return {
        ok: false,
        reason: `The vault allows ${terms.maxCompletions} completions of "${m.title}" but the plan offers ${m.maxCompletions}.`,
      };
    }
    if (terms.paidCompletions > 0) {
      // A vault that has already paid is being reused. Its remaining capacity is not what this
      // plan assumes, and its replay protection is keyed to another campaign's authorisations.
      return {
        ok: false,
        reason: `The vault has already paid for "${m.title}" — a used vault cannot back a new campaign.`,
      };
    }
  }

  return { ok: true };
}

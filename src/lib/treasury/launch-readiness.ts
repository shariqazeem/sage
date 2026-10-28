/**
 * CAN THIS ACCOUNT LAUNCH THIS JOB? (28 Oct 2026)
 *
 * Two doors launch from the account: the plan page (TreasuryLaunch) and the composer's own Launch
 * button. They read the same GET /api/treasury, and this is the one place that turns that read into
 * an answer, so the two buttons can never disagree about the same balance. Each door words it its
 * own way; the facts come from here.
 */
export interface AccountRead {
  balanceUsd?: number;
  perCampaignCapUsd?: number;
  enoughGas?: boolean | null;
}

export interface LaunchReadiness {
  /** the account holds less than the job's budget */
  short: boolean;
  /** what to add, in dollars, when short (0 otherwise) */
  addUsd: number;
  /** the account's per-job limit is below the job's budget */
  overCap: boolean;
  /** the account lacks the network fee a launch needs */
  needsFee: boolean;
  /** nothing stands in the way */
  ready: boolean;
}

export function launchReadiness(st: AccountRead, budgetUsd: number): LaunchReadiness {
  const short = st.balanceUsd !== undefined && st.balanceUsd < budgetUsd;
  const overCap = st.perCampaignCapUsd !== undefined && st.perCampaignCapUsd < budgetUsd;
  const needsFee = st.enoughGas === false;
  return {
    short,
    // up to the next cent (adding $0.92 to cover $0.921 would leave it short), with float noise ignored
    addUsd: short ? Math.ceil((budgetUsd - (st.balanceUsd ?? 0)) * 100 - 1e-6) / 100 : 0,
    overCap,
    needsFee,
    ready: !short && !overCap && !needsFee,
  };
}

/** "0.05": a wei amount in plain digits for a sentence. */
export function nativeAmount(wei: string | undefined | null): string {
  if (!wei) return "a little";
  const n = Number(BigInt(wei)) / 1e18;
  return n >= 0.01 ? n.toFixed(2).replace(/0$/, "") : n.toPrecision(2);
}

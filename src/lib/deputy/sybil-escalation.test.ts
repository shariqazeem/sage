import { describe, expect, it } from "vitest";
import { escalateSybil, SYBIL_SIGNAL } from "./sybil-escalation";
import type { BriefFraudSignal } from "./brain-core";

const fresh: BriefFraudSignal = { signal: "fresh wallet", severity: "med", reason: "no history" };
const young: BriefFraudSignal = { signal: "fresh wallet", severity: "low", reason: "young" };
const author: BriefFraudSignal = { signal: "fresh author account", severity: "med", reason: "made today" };
const funded: BriefFraudSignal = { signal: "funded by another submitter", severity: "med", reason: "gas from a peer" };
const cluster: BriefFraudSignal = { signal: "wallet cluster", severity: "high", reason: "payouts met" };

describe("escalateSybil — the wallet-rotation shape becomes one HIGH signal", () => {
  it("fresh wallet + funded by a peer (tonight's eight wallets) → high", () => {
    const s = escalateSybil([fresh, funded]);
    expect(s?.severity).toBe("high");
    expect(s?.signal).toBe(SYBIL_SIGNAL);
    expect(s?.reason).toMatch(/no history.*gas funded by another submitter/);
  });
  it("fresh author account + payout-consolidation cluster → high, naming the cluster", () => {
    expect(escalateSybil([author, cluster])?.reason).toMatch(/author account created for this campaign.*linked to other submitters/);
  });
  it("a friend funding gas for an established wallet with an old account stays medium — no escalation", () => {
    expect(escalateSybil([funded])).toBeNull();
    expect(escalateSybil([young, funded])).toBeNull(); // low freshness does not count
  });
  it("a fresh wallet and a fresh author with NO funding link is a newcomer, not a farm", () => {
    expect(escalateSybil([fresh, author])).toBeNull();
  });
  it("nothing to escalate on an empty brief", () => {
    expect(escalateSybil([])).toBeNull();
  });
});

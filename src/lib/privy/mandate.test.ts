import { describe, it, expect } from "vitest";
import { getAddress } from "viem";
import { buildMandatePolicy, buildWithdrawPolicy, buildStopCampaignPolicy } from "./mandate";

type Cond = Record<string, unknown>;
type Rule = { name: string; method: string; action: string; conditions: Cond[] };
const rulesOf = (p: Record<string, unknown>): Rule[] => p.rules as Rule[];

const factory = getAddress("0x1111111111111111111111111111111111111111");
const usdc = getAddress("0x2222222222222222222222222222222222222222");
const reclaim = getAddress("0x3333333333333333333333333333333333333333");
const CAP = BigInt(5_000_000); // $5 in 6dp base units

describe("buildMandatePolicy", () => {
  it("walletless (no reclaim) omits the sweep rule so leftover stays as balance", () => {
    const rules = rulesOf(buildMandatePolicy({ name: "m", factory, usdc, perCampaignCapBase: CAP }));
    expect(rules).toHaveLength(4);
    expect(rules.some((r) => r.name.includes("sweep"))).toBe(false);
    // every rule is still a strict ALLOW on eth_signTransaction (default-deny otherwise).
    expect(rules.every((r) => r.action === "ALLOW" && r.method === "eth_signTransaction")).toBe(true);
  });

  it("pinned-reclaim adds a sweep rule locked to the reclaim address", () => {
    const rules = rulesOf(buildMandatePolicy({ name: "m", factory, usdc, reclaim, perCampaignCapBase: CAP }));
    expect(rules).toHaveLength(5);
    const sweep = rules.find((r) => r.name.includes("sweep"));
    expect(sweep).toBeDefined();
    const to = sweep!.conditions.find((c) => c.field === "transfer.to");
    expect(to?.value).toBe(reclaim);
    expect(to?.operator).toBe("eq");
  });

  it("caps approve and fund at the per-campaign cap (hex, lte), and pins create to the factory", () => {
    const rules = rulesOf(buildMandatePolicy({ name: "m", factory, usdc, perCampaignCapBase: CAP }));
    const capHex = `0x${CAP.toString(16)}`;

    const approve = rules.find((r) => r.name.includes("approve"))!.conditions.find((c) => c.field === "approve.amount");
    expect(approve?.value).toBe(capHex);
    expect(approve?.operator).toBe("lte");

    const fund = rules.find((r) => r.name.includes("fund"))!.conditions.find((c) => c.field === "fund.amount");
    expect(fund?.value).toBe(capHex);
    expect(fund?.operator).toBe("lte");

    const create = rules.find((r) => r.name.includes("create"))!.conditions.find((c) => c.field === "to");
    expect(create?.value).toBe(factory);
  });
});

describe("buildWithdrawPolicy", () => {
  const target = getAddress("0x4444444444444444444444444444444444444444");
  const maxBase = BigInt(3_000_000); // $3

  it("adds exactly one transfer rule pinned to the target and capped at the amount, over the base", () => {
    const rules = rulesOf(buildWithdrawPolicy({ name: "m", factory, usdc, perCampaignCapBase: CAP }, target, maxBase));
    // walletless base (4 rules) + 1 withdraw rule
    expect(rules).toHaveLength(5);
    const w = rules.find((r) => r.name.includes("withdraw"));
    expect(w).toBeDefined();
    expect(w!.action).toBe("ALLOW");

    const to = w!.conditions.find((c) => c.field === "transfer.to");
    expect(to?.value).toBe(target);
    expect(to?.operator).toBe("eq");

    const amt = w!.conditions.find((c) => c.field === "transfer.amount");
    expect(amt?.value).toBe(`0x${maxBase.toString(16)}`);
    expect(amt?.operator).toBe("lte");

    // the transaction must still be TO the USDC contract (can't transfer some other token).
    const txTo = w!.conditions.find((c) => c.field === "to" && c.field_source === "ethereum_transaction");
    expect(txTo?.value).toBe(usdc);
  });

  it("does not permit transfers on the base mandate (a withdraw is denied until the permit is attached)", () => {
    const base = rulesOf(buildMandatePolicy({ name: "m", factory, usdc, perCampaignCapBase: CAP }));
    expect(base.some((r) => r.conditions.some((c) => c.field === "transfer.to"))).toBe(false);
  });
});

describe("buildStopCampaignPolicy", () => {
  const vault = getAddress("0x4444444444444444444444444444444444444444");

  it("adds exactly two rules on top of the base mandate, both pinned to the vault", () => {
    const base = rulesOf(buildMandatePolicy({ name: "m", factory, usdc, perCampaignCapBase: CAP }));
    const rules = rulesOf(buildStopCampaignPolicy({ name: "m", factory, usdc, perCampaignCapBase: CAP }, vault));
    expect(rules).toHaveLength(base.length + 2);
    const added = rules.slice(base.length);
    for (const r of added) {
      expect(r.action).toBe("ALLOW");
      expect(r.method).toBe("eth_signTransaction");
      const to = r.conditions.find((c) => c.field === "to");
      expect(to?.value).toBe(vault); // pinned to THIS vault only
      expect(to?.operator).toBe("eq");
    }
  });

  it("permits revoke() and withdrawRemaining() by function name, nothing else", () => {
    const rules = rulesOf(buildStopCampaignPolicy({ name: "m", factory, usdc, perCampaignCapBase: CAP }, vault));
    const revoke = rules.find((r) => r.name.includes("revoke"))!;
    const rc = revoke.conditions.find((c) => c.field === "function_name");
    expect(rc?.value).toBe("revoke");
    expect(rc?.operator).toBe("eq");
    const wd = rules.find((r) => r.name.includes("withdraw"))!;
    const wc = wd.conditions.find((c) => c.field === "function_name");
    expect(wc?.value).toBe("withdrawRemaining");
    expect(wc?.operator).toBe("eq");
  });

  it("preserves the base mandate rules unchanged (create/approve/fund/activate)", () => {
    const rules = rulesOf(buildStopCampaignPolicy({ name: "m", factory, usdc, perCampaignCapBase: CAP }, vault));
    expect(rules.some((r) => r.name.includes("create"))).toBe(true);
    expect(rules.some((r) => r.name.includes("approve"))).toBe(true);
    expect(rules.some((r) => r.name.includes("fund"))).toBe(true);
    expect(rules.some((r) => r.name.includes("activate"))).toBe(true);
  });

  it("the new rules never permit an arbitrary transfer (funds can only return to the owner on-chain)", () => {
    const rules = rulesOf(buildStopCampaignPolicy({ name: "m", factory, usdc, perCampaignCapBase: CAP }, vault));
    const baseLen = rulesOf(buildMandatePolicy({ name: "m", factory, usdc, perCampaignCapBase: CAP })).length;
    const added = rules.slice(baseLen);
    // neither added rule references transfer.to / transfer.amount — they are no-arg vault calls
    for (const r of added) {
      expect(r.conditions.some((c) => String(c.field).startsWith("transfer."))).toBe(false);
    }
  });
});

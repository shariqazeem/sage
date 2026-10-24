import { describe, expect, it } from "vitest";
import { buildSendNativePolicy, buildSwapPolicy } from "./swap-policy";
import { buildMandatePolicy, type MandateSpec } from "./mandate";

/**
 * THE SCOPED PERMITS ARE THE CUSTODY GUARANTEE for moving money inside an account. These tests pin
 * every condition that keeps a swap's output in the account and a send at the one chosen address.
 */
const SPEC: MandateSpec = {
  name: "mandate:web:0x1111…111111",
  factory: "0x1111111111111111111111111111111111111111",
  usdc: "0xEA32A96608495e54156Ae48931A7c20f0dcc1a21",
  perCampaignCapBase: BigInt(50_000_000),
};
const ROUTER = "0x1E876cCe41B7b844FDe09E38Fa1cf00f213bFf56" as const;
const ACCOUNT = "0x2222222222222222222222222222222222222222" as const;

type Rule = { name: string; method: string; action: string; conditions: Array<Record<string, unknown>> };
const rulesOf = (p: Record<string, unknown>) => p.rules as Rule[];
const extra = (p: Record<string, unknown>) => rulesOf(p).slice(rulesOf(buildMandatePolicy(SPEC)).length);

describe("swap permit", () => {
  it("keeps every base mandate rule, so a launch running beside a swap still signs", () => {
    const p = buildSwapPolicy(SPEC, { side: "usdc_to_metis", router: ROUTER, account: ACCOUNT, amountIn: BigInt(5_000_000) });
    expect(rulesOf(p).slice(0, rulesOf(buildMandatePolicy(SPEC)).length)).toEqual(rulesOf(buildMandatePolicy(SPEC)));
    expect(p.name).toBe(`${SPEC.name}:swap`);
    expect(String(p.name).length).toBeLessThanOrEqual(50);
  });

  it("USDC → METIS: approves only the router, for only this amount, and pays out only to this account", () => {
    const p = buildSwapPolicy(SPEC, { side: "usdc_to_metis", router: ROUTER, account: ACCOUNT, amountIn: BigInt(5_000_000) });
    const [approve, swap] = extra(p);
    expect(approve!.conditions).toEqual(
      expect.arrayContaining([
        { field_source: "ethereum_transaction", field: "to", operator: "eq", value: SPEC.usdc },
        expect.objectContaining({ field: "approve.spender", operator: "eq", value: ROUTER }),
        expect.objectContaining({ field: "approve.amount", operator: "lte", value: "0x4c4b40" }),
      ]),
    );
    expect(swap!.conditions).toEqual(
      expect.arrayContaining([
        { field_source: "ethereum_transaction", field: "to", operator: "eq", value: ROUTER },
        expect.objectContaining({ field: "swapExactTokensForMetis.amountIn", operator: "lte", value: "0x4c4b40" }),
        expect.objectContaining({ field: "swapExactTokensForMetis.to", operator: "eq", value: ACCOUNT }),
      ]),
    );
  });

  it("METIS → USDC: the value is capped and the USDC can only come back to this account", () => {
    const p = buildSwapPolicy(SPEC, { side: "metis_to_usdc", router: ROUTER, account: ACCOUNT, amountIn: BigInt("1000000000000000000") });
    const added = extra(p);
    expect(added).toHaveLength(1);
    expect(added[0]!.conditions).toEqual(
      expect.arrayContaining([
        { field_source: "ethereum_transaction", field: "to", operator: "eq", value: ROUTER },
        { field_source: "ethereum_transaction", field: "value", operator: "lte", value: "0xde0b6b3a7640000" },
        expect.objectContaining({ field: "swapExactMetisForTokens.to", operator: "eq", value: ACCOUNT }),
      ]),
    );
  });

  it("every calldata condition carries the ABI Privy decodes with, and every rule name fits Privy's 50 characters", () => {
    for (const side of ["usdc_to_metis", "metis_to_usdc"] as const) {
      for (const r of extra(buildSwapPolicy(SPEC, { side, router: ROUTER, account: ACCOUNT, amountIn: BigInt(1) }))) {
        expect(r.name.length).toBeLessThanOrEqual(50);
        expect(r.action).toBe("ALLOW");
        expect(r.method).toBe("eth_signTransaction");
        for (const c of r.conditions) if (c.field_source === "ethereum_calldata") expect(Array.isArray(c.abi)).toBe(true);
      }
    }
  });
});

describe("METIS send permit", () => {
  it("reaches only the address the founder typed, for at most the amount confirmed", () => {
    const target = "0x3333333333333333333333333333333333333333" as const;
    const p = buildSendNativePolicy(SPEC, target, BigInt("250000000000000000"));
    const added = extra(p);
    expect(added).toHaveLength(1);
    expect(added[0]!.conditions).toEqual([
      { field_source: "ethereum_transaction", field: "to", operator: "eq", value: target },
      { field_source: "ethereum_transaction", field: "value", operator: "lte", value: "0x3782dace9d90000" },
    ]);
    expect(p.name).toBe(`${SPEC.name}:send`);
    expect(added[0]!.name.length).toBeLessThanOrEqual(50);
  });
});

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";

import { hasMissionPlan, isEvmCampaignVault } from "./vault-kind";

/**
 * RAIL PARITY — the audit that should have existed before a second rail shipped.
 *
 * `vaultKind === "campaign_v2"` meant two different things throughout the product: "carries a
 * mission plan" and "is an EVM CampaignVault". Adding Starknet turned every site that meant the
 * first into a silent exclusion, and each one was found the same way — a founder with real money
 * in a real vault hitting it. The tester board fell back to a legacy card; the submit route dropped
 * mission binding; the console redirected to a legacy page; the dashboard counted the wrong total.
 *
 * This fails when a NEW literal comparison appears, so the next rail is a decision rather than a
 * discovery.
 */

describe("the two meanings are distinct", () => {
  it("a Starknet vault carries a mission plan but is not an EVM vault", () => {
    expect(hasMissionPlan("sage_vault_starknet")).toBe(true);
    expect(isEvmCampaignVault("sage_vault_starknet")).toBe(false);
  });

  it("an EVM V2 vault is both", () => {
    expect(hasMissionPlan("campaign_v2")).toBe(true);
    expect(isEvmCampaignVault("campaign_v2")).toBe(true);
  });

  it("a V1 policy vault is neither — it has no missions to plan against", () => {
    expect(hasMissionPlan("policy_v1")).toBe(false);
    expect(isEvmCampaignVault("policy_v1")).toBe(false);
  });

  it("an absent or unknown kind is neither, rather than assumed", () => {
    for (const k of [null, undefined, "", "something_new"]) {
      expect(hasMissionPlan(k)).toBe(false);
      expect(isEvmCampaignVault(k)).toBe(false);
    }
  });
});

describe("no site compares the vault kind by hand any more", () => {
  /**
   * The allowlist is the EVM-only settlement path, which genuinely means "a vault I can call
   * through viem", plus the predicate's own home. Everything else must ask the predicate.
   */
  const ALLOWED = [
    "src/lib/campaigns/vault-kind.ts",
    "src/lib/campaigns/vault-strategy.ts", // EVM settle + pre-broadcast guard
    "src/lib/deputy/proof.ts", // EVM receipt verifier; Starknet has starknet-proof.ts
    "src/app/api/admin/repin-corpus/route.ts", // operator tool, EVM corpora only
    "src/components/proof/sage-proof-page.tsx", // names the EVM contract in copy
  ];

  it("only the allowlisted files still compare it literally", () => {
    const out = execSync(
      `grep -rln 'vaultKind === "campaign_v2"\\|vaultKind !== "campaign_v2"' src/ || true`,
      { encoding: "utf8" },
    );
    const hits = out.split("\n").filter(Boolean).filter((f) => !f.includes(".test."));
    const unexpected = hits.filter((f) => !ALLOWED.includes(f));
    expect(unexpected, "these should ask hasMissionPlan() instead").toEqual([]);
  });
});

describe("the settlement rail is actually written down", () => {
  it("the shared attach path persists it", () => {
    // It declared `settlementRail` as an input and never wrote the column, so a Starknet campaign
    // saved as EVM: the board offered a MetaMask sign-in for a campaign that pays on Starknet.
    const src = readFileSync("src/lib/campaigns/v2-setup.ts", "utf8");
    expect(src).toMatch(/settlementRail: input\.settlementRail \?\? "evm"/);
  });
});

import { describe, expect, it } from "vitest";
import { callSageTool } from "./server";
import { loadApprovedPlan } from "@/lib/launch/deployment-service";

/**
 * WORK PROOF, spoken — `sage_create_direct_campaign`. The agent structures the founder's words;
 * this tool compiles them deterministically into a ready, APPROVED plan on the same rails as every
 * campaign. Invariants under test: the founder wallet is SERVER-BOUND (never an arg), transport is
 * forgiving but substance is zod-strict, the artifact marker is FORCED to "wallet", recipients
 * become the lowercased allowlist, and the result is immediately consumable by the deploy flow.
 */
const ctx = { scheduleAfter: () => {} };
const FOUNDER = "0x00000000000000000000000000000000000000d1";

const friendlyArgs = () => ({
  kind: "grant",
  title: "Storefront micro-grant (spoken)",
  productUrl: "https://example-shop.org",
  whyItMatters: "Diaspora-funded tranches, receipted end to end.",
  milestones: [
    {
      title: "Publish the storefront page",
      instructions: "Publish your page with your wallet address in the footer, then submit its link.",
      // TRANSPORT TOLERANCE: criteria as a newline string, exactly how a model often sends lists.
      criteria: "The page is publicly reachable\nIt visibly carries your wallet address",
      // The model does NOT get to pick a marker — even a forged one is overridden to "wallet".
      evidence: { kind: "artifact_url", allowedHosts: ["Shop.Example.ORG"], markerKind: "nonce" },
      rewardUsd: 2,
      slots: 1,
    },
  ],
  recipients: ["0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"],
});

describe("sage_create_direct_campaign — server-bound wallet, strict substance", () => {
  it("refuses without a bound founder wallet (public MCP / anon web)", async () => {
    const r = await callSageTool("sage_create_direct_campaign", friendlyArgs(), ctx);
    expect(r?.isError).toBe(false); // friendly refusal, not a protocol error
    expect(r?.content[0]?.text ?? "").toMatch(/wallet/i);
    expect(JSON.parse(r!.content[0]!.text).ok).toBe(false);
  });

  it("creates an approved, deploy-consumable plan; marker forced to wallet; recipients → lowercased allowlist", async () => {
    const r = await callSageTool("sage_create_direct_campaign", friendlyArgs(), { ...ctx, founderWallet: FOUNDER });
    const data = JSON.parse(r!.content[0]!.text) as {
      ok: boolean;
      planUrl: string;
      inspectionId: string;
      totalBudgetUsd: number;
      invitedRecipients: number;
      milestones: { verifiedBy: string }[];
    };
    expect(data.ok).toBe(true);
    expect(data.planUrl).toMatch(/\/launch\//);
    expect(data.totalBudgetUsd).toBe(2);
    expect(data.invitedRecipients).toBe(1);
    expect(data.milestones[0]!.verifiedBy).toBe("artifact_url");

    // The EXACT call the claim/deploy path makes must already work — plan approved, fields intact.
    const loaded = loadApprovedPlan(data.inspectionId);
    expect(loaded).not.toBeNull();
    expect(loaded!.plan.campaignKind).toBe("grant");
    expect(loaded!.plan.allowlist).toEqual(["0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"]);
    const contract = loaded!.plan.missions[0]!.verificationContract as { kind: string; markerKind: string; allowedHosts: string[] };
    expect(contract.kind).toBe("artifact_url");
    expect(contract.markerKind).toBe("wallet"); // forged "nonce" overridden server-side
    expect(contract.allowedHosts).toEqual(["shop.example.org"]);
  });

  it("invalid substance → a field-named error the model can fix or relay", async () => {
    const bad = friendlyArgs();
    bad.milestones[0]!.rewardUsd = 0.1; // below the tangible floor
    const r = await callSageTool("sage_create_direct_campaign", bad, { ...ctx, founderWallet: FOUNDER });
    const data = JSON.parse(r!.content[0]!.text) as { ok: boolean; error: string };
    expect(data.ok).toBe(false);
    expect(data.error).toMatch(/rewardUsd/);
  });
});

import { describe, expect, it } from "vitest";
import type { ToolResult } from "@/lib/mcp/server";
import { createCampaign } from "@/lib/db/campaigns";
import { saveAgentWallet } from "@/lib/db/agent-wallets";
import { callAgentWalletTool } from "./agent-wallet-tools";

/** Gating + two-step for the founder review tools. The heavy release path is covered in
 *  review-actions.test; here we prove a chat can only touch its OWN campaigns, and that a
 *  confirm with nothing prepared refuses (so the model can never release on its own). */

function bind(chatId: string, wallet: string): void {
  saveAgentWallet({
    chatId,
    founderAddress: wallet,
    privyWalletId: `pw_${chatId}`,
    privyWalletAddress: wallet,
    policyId: `pol_${chatId}`,
    perCampaignCapBase: 100_000_000,
    chainId: 2345,
  });
}

async function body(r: ToolResult): Promise<{ ok: boolean; error?: string }> {
  return JSON.parse(r.content[0]?.text ?? "{}");
}

describe("founder review tools — gating + two-step", () => {
  it("sage_list_held rejects a campaign the chat's agent wallet does not own", async () => {
    const owner = `0x${"a".repeat(40)}`;
    const other = `0x${"b".repeat(40)}`;
    const campaign = createCampaign({
      // Distinctive on purpose: the leak assertion below is vacuous against a one-character title,
      // which would match any sentence containing the letter.
      title: "Owner Only Zebra Campaign",
      rewardAmount: 300_000,
      vaultAddress: `0x${"1".repeat(40)}`,
      posterWallet: owner,
      chainId: 2345,
      vaultKind: "campaign_v2",
    });
    bind("ownerChat", owner);
    bind("otherChat", other);

    const asOwner = await body(await callAgentWalletTool("sage_list_held", { campaignId: campaign.id }, "ownerChat"));
    expect(asOwner.ok).toBe(true);

    const asForeigner = await body(await callAgentWalletTool("sage_list_held", { campaignId: campaign.id }, "otherChat"));
    expect(asForeigner.ok).toBe(false);
    // Asserted as a PROPERTY, not a phrase. Campaign lookup now runs over the chat's OWN campaigns
    // (so a founder can say "kyvernlabs.com" instead of an opaque id), which means a foreign
    // campaign is no longer merely rejected — it is not findable, and the wording moved with that.
    // `ownsCampaign` still runs afterwards, so the refusal is defended twice over.
    expect(asForeigner.error).toBeTruthy();
    // and it must not leak anything about a campaign this chat cannot see
    expect(asForeigner.error).not.toContain(campaign.title);
    expect(asForeigner.error).not.toContain(owner);
  });

  it("sage_confirm_release refuses when nothing was prepared (two-step enforced)", async () => {
    bind("c9", `0x${"c".repeat(40)}`);
    const res = await body(await callAgentWalletTool("sage_confirm_release", {}, "c9"));
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/no prepared release|no pending/i);
  });
});

/**
 * "IS ANYTHING WAITING ON ME?" — the question founders actually ask, which the tool could not
 * answer because campaignId was REQUIRED. MEASURED by P-ROUTE: the agent went to my_campaigns,
 * then get_campaign, and reached held work on neither run. Held submissions sitting unreviewed is
 * a worker waiting unpaid, so the dead end has a cost.
 */
describe("sage_list_held with no campaign named", () => {
  it("answers across the founder's own campaigns instead of dead-ending", async () => {
    const owner = `0x${"c".repeat(40)}`;
    createCampaign({
      title: "Aggregate Scope Campaign",
      rewardAmount: 300_000,
      vaultAddress: `0x${"2".repeat(40)}`,
      posterWallet: owner,
      chainId: 2345,
      vaultKind: "campaign_v2",
    });
    bind("aggChat", owner);

    const r = await body(await callAgentWalletTool("sage_list_held", {}, "aggChat"));
    expect(r.ok).toBe(true);
    expect((r as { scope?: string }).scope).toBe("all-campaigns");
  });

  /**
   * WIDENING WHAT CAN BE ASKED MUST NOT WIDEN WHAT CAN BE REACHED. The aggregate runs over the
   * same ownership set `ownsCampaign` enforces, so another founder's campaign cannot appear in it.
   */
  it("never includes a campaign the chat does not own", async () => {
    const mine = `0x${"d".repeat(40)}`;
    const theirs = `0x${"e".repeat(40)}`;
    createCampaign({
      title: "Someone Elses Xylophone Campaign",
      rewardAmount: 300_000,
      vaultAddress: `0x${"3".repeat(40)}`,
      posterWallet: theirs,
      chainId: 2345,
      vaultKind: "campaign_v2",
    });
    bind("mineChat", mine);

    const r = await body(await callAgentWalletTool("sage_list_held", {}, "mineChat"));
    expect(r.ok).toBe(true);
    expect(JSON.stringify(r)).not.toContain("Xylophone");
  });

  it("still refuses when the chat has no agent wallet at all", async () => {
    const r = await body(await callAgentWalletTool("sage_list_held", {}, "unboundChat"));
    expect(r.ok).toBe(false);
  });
});

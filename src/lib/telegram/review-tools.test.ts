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

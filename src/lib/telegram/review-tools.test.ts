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
      title: "t",
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
    expect(asForeigner.error).toMatch(/isn't one you launched|didn't launch/i);
  });

  it("sage_confirm_release refuses when nothing was prepared (two-step enforced)", async () => {
    bind("c9", `0x${"c".repeat(40)}`);
    const res = await body(await callAgentWalletTool("sage_confirm_release", {}, "c9"));
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/no prepared release|no pending/i);
  });
});

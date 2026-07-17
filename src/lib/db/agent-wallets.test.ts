import { describe, it, expect } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "./index";
import { agentWallets } from "./schema";
import { getAgentWallet, saveAgentWallet } from "./agent-wallets";

/** One agent wallet per chat: re-onboarding REPLACES the binding (chatId is the key), so a chat can
 *  never accumulate multiple funded wallets. Runs against the real in-memory db (:memory:). */
describe("agent-wallets — one wallet per chat", () => {
  it("a second onboard for the same chat replaces the first (exactly one row, latest wins)", () => {
    const chatId = "chat:one-per-chat";
    saveAgentWallet({
      chatId,
      founderAddress: `0x${"a".repeat(40)}`,
      privyWalletId: "pw_1",
      privyWalletAddress: `0x${"1".repeat(40)}`,
      policyId: "pol_1",
      perCampaignCapBase: 1_000_000,
      chainId: 2345,
    });
    saveAgentWallet({
      chatId,
      founderAddress: `0x${"b".repeat(40)}`,
      privyWalletId: "pw_2",
      privyWalletAddress: `0x${"2".repeat(40)}`,
      policyId: "pol_2",
      perCampaignCapBase: 2_000_000,
      chainId: 2345,
    });

    const w = getAgentWallet(chatId);
    expect(w?.privyWalletAddress).toBe(`0x${"2".repeat(40)}`); // latest wins
    expect(w?.perCampaignCapBase).toBe(2_000_000);

    // exactly one row for the chat — never a duplicate
    const rows = db.select().from(agentWallets).where(eq(agentWallets.chatId, chatId)).all();
    expect(rows).toHaveLength(1);
  });

  it("different chats keep separate wallets", () => {
    saveAgentWallet({
      chatId: "chat:alice",
      founderAddress: `0x${"a".repeat(40)}`,
      privyWalletId: "pw_a",
      privyWalletAddress: `0x${"a".repeat(40)}`,
      policyId: "pol_a",
      perCampaignCapBase: 1_000_000,
      chainId: 2345,
    });
    saveAgentWallet({
      chatId: "chat:bob",
      founderAddress: `0x${"b".repeat(40)}`,
      privyWalletId: "pw_b",
      privyWalletAddress: `0x${"b".repeat(40)}`,
      policyId: "pol_b",
      perCampaignCapBase: 1_000_000,
      chainId: 2345,
    });
    expect(getAgentWallet("chat:alice")?.privyWalletId).toBe("pw_a");
    expect(getAgentWallet("chat:bob")?.privyWalletId).toBe("pw_b");
  });
});

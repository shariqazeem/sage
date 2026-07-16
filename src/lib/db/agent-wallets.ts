import "server-only";

import { eq, sql } from "drizzle-orm";
import { db } from "./index";
import { nowSeconds } from "./keys";
import { agentWallets, type AgentWallet } from "./schema";

/**
 * Accessors for the per-founder agent-wallet binding — chat ↔ SIWE'd founder ↔ Privy wallet ↔
 * mandate. One row per Telegram chat; upserting rebinds or updates the mandate in place. No
 * secrets are stored: the Privy key lives at Privy; we keep only its wallet id + address.
 */

export function getAgentWallet(chatId: string): AgentWallet | null {
  return db.select().from(agentWallets).where(eq(agentWallets.chatId, chatId)).get() ?? null;
}

/**
 * Find the agent wallet by its on-chain address (case-insensitive) — used to resolve which
 * Telegram chat launched a campaign (the vault owner IS this Privy wallet), so Sage can DM that
 * founder when a payout settles or holds. Returns null for a campaign not launched from chat.
 */
export function getAgentWalletByAddress(address: string): AgentWallet | null {
  const a = address.toLowerCase();
  return (
    db.select().from(agentWallets).where(sql`lower(${agentWallets.privyWalletAddress}) = ${a}`).get() ?? null
  );
}

export interface SaveAgentWalletInput {
  chatId: string;
  founderAddress: string;
  privyWalletId: string;
  privyWalletAddress: string;
  policyId: string;
  perCampaignCapBase: number;
  chainId?: number;
}

/** Create or replace a founder's agent-wallet binding (idempotent per chat). */
export function saveAgentWallet(input: SaveAgentWalletInput): AgentWallet {
  const now = nowSeconds();
  const founderAddress = input.founderAddress.toLowerCase();
  const chainId = input.chainId ?? 2345;
  db.insert(agentWallets)
    .values({
      chatId: input.chatId,
      founderAddress,
      privyWalletId: input.privyWalletId,
      privyWalletAddress: input.privyWalletAddress,
      policyId: input.policyId,
      perCampaignCapBase: input.perCampaignCapBase,
      chainId,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: agentWallets.chatId,
      set: {
        founderAddress,
        privyWalletId: input.privyWalletId,
        privyWalletAddress: input.privyWalletAddress,
        policyId: input.policyId,
        perCampaignCapBase: input.perCampaignCapBase,
        chainId,
        updatedAt: now,
      },
    })
    .run();

  const saved = getAgentWallet(input.chatId);
  if (!saved) throw new Error("agent wallet upsert failed");
  return saved;
}

/** Update just the mandate (policy id + per-campaign cap) — e.g. the founder raises their limit. */
export function updateMandate(chatId: string, policyId: string, perCampaignCapBase: number): void {
  db.update(agentWallets)
    .set({ policyId, perCampaignCapBase, updatedAt: nowSeconds() })
    .where(eq(agentWallets.chatId, chatId))
    .run();
}

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

/**
 * Every wallet Sage holds FOR this founder — the web accounts on each chain and any Telegram agent
 * wallet bound to the same address. Work launched from any of them is posted by that wallet, so
 * "does this founder own this campaign" has to ask this, not compare one address.
 */
export function agentWalletAddressesOf(founderAddress: string): string[] {
  const f = founderAddress.toLowerCase();
  return db
    .select({ address: agentWallets.privyWalletAddress })
    .from(agentWallets)
    .where(sql`lower(${agentWallets.founderAddress}) = ${f}`)
    .all()
    .map((r) => r.address);
}

/**
 * The Telegram chat this founder talks to Sage from, if any: an agent wallet bound to their address
 * under a chat id (web accounts are keyed `web:<founder>`, so they never match). Used to send a
 * founder the few messages about their own account, such as a plan that renews soon.
 */
export function telegramChatOf(founderAddress: string): string | null {
  const f = founderAddress.toLowerCase();
  const row = db
    .select({ chatId: agentWallets.chatId })
    .from(agentWallets)
    .where(sql`lower(${agentWallets.founderAddress}) = ${f} and ${agentWallets.chatId} not like 'web:%'`)
    .get();
  return row?.chatId ?? null;
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

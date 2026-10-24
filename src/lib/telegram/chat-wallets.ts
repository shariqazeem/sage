import "server-only";

import type { AgentWallet } from "@/lib/db/schema";
import { getAgentWallet, renameAgentWallet } from "@/lib/db/agent-wallets";
import { CHAINS } from "@/lib/deputy/networks";

/**
 * A CHAT'S WALLETS (24 Oct 2026, Telegram moves to Metis).
 *
 * A chat has ONE active wallet, under its own key (the chat id), and every tool that launches or
 * funds reads that one. When the chat's wallet sits on a network that is paused for new money (GOAT),
 * a new wallet opens on the default network under the chat's key, and the old one is set aside under
 * `<chat>@<chainId>`: same wallet, same mandate, same money, found by a different key. It stays
 * reachable for what a paused network still allows (its balance, a withdrawal, stopping its jobs,
 * deciding its held work), so nothing a founder holds is stranded by the move.
 */
export const setAsideKey = (chatId: string, chainId: number): string => `${chatId}@${chainId}`;

/** The active wallet first, then any set aside, newest network last. */
export function chatWallets(chatId: string): AgentWallet[] {
  const out: AgentWallet[] = [];
  const active = getAgentWallet(chatId);
  if (active) out.push(active);
  for (const id of Object.keys(CHAINS).map(Number)) {
    const w = getAgentWallet(setAsideKey(chatId, id));
    if (w) out.push(w);
  }
  return out;
}

/** The wallet a chat holds on one network, active or set aside. */
export function chatWalletOn(chatId: string, chainId: number): AgentWallet | null {
  return chatWallets(chatId).find((w) => w.chainId === chainId) ?? null;
}

/** Set the chat's active wallet aside under `<chat>@<its chain>`, so a new one can open under the chat's key. */
export function setAsideActiveWallet(chatId: string): AgentWallet | null {
  const active = getAgentWallet(chatId);
  if (!active) return null;
  return renameAgentWallet(chatId, setAsideKey(chatId, active.chainId)) ? getAgentWallet(setAsideKey(chatId, active.chainId)) : null;
}

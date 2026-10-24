import "server-only";
import { createHash, randomBytes } from "node:crypto";
import type { AgentKey, AgentKeyScope } from "@/lib/db/schema";
import { activeAgentKeyByHash, insertAgentKey, touchAgentKey } from "@/lib/db/agent-keys";

/**
 * CONNECT YOUR OWN AI AGENT (24 Oct 2026).
 *
 * A workspace owner mints a key for an agent they run: Claude, Cursor, or their own code. The agent
 * calls Sage's MCP endpoint with it and acts AS THE OWNER, with only the scopes they ticked:
 *
 *   read    their jobs, plans, submissions, receipts and account balance;
 *   plan    design work (inspect a product, compile a gig or a grant) — moves no money;
 *   launch  fund a ready plan from their Sage account, inside the account's per-job limit and the
 *           plan's limits, exactly as the owner's own Launch button would.
 *
 * The key is shown once. Sage keeps its SHA-256 and the first characters (to recognise it in a list);
 * a revoked key stops working on its next call. A key never lifts a limit: the mandate bounds what the
 * account can spend, the plan bounds what can launch, and the vault bounds every payout.
 */
export const KEY_PREFIX = "sage_sk_";
export const ALL_SCOPES: readonly AgentKeyScope[] = ["read", "plan", "launch"];

export function hashAgentKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

export function isAgentKeyShape(key: string): boolean {
  return key.startsWith(KEY_PREFIX) && /^[A-Za-z0-9_-]{40,80}$/.test(key);
}

/** Read is always granted; the rest only when asked for, in a fixed order. */
export function normaliseScopes(asked: readonly unknown[]): AgentKeyScope[] {
  const set = new Set<AgentKeyScope>(["read"]);
  for (const s of asked) if (s === "plan" || s === "launch") set.add(s);
  return ALL_SCOPES.filter((s) => set.has(s));
}

export function scopesOf(k: Pick<AgentKey, "scopes">): Set<AgentKeyScope> {
  return new Set(normaliseScopes(k.scopes.split(",")));
}

export interface MintedKey {
  /** the key itself: returned once, never stored */
  key: string;
  row: AgentKey;
}

export function mintAgentKey(input: { workspaceId: string; founder: string; name: string; scopes: readonly AgentKeyScope[] }): MintedKey {
  const key = `${KEY_PREFIX}${randomBytes(32).toString("base64url")}`;
  const row = insertAgentKey({
    id: `ak_${randomBytes(9).toString("base64url")}`,
    workspaceId: input.workspaceId,
    founder: input.founder,
    name: input.name.trim().slice(0, 60) || "My agent",
    prefix: key.slice(0, KEY_PREFIX.length + 6),
    keyHash: hashAgentKey(key),
    scopes: normaliseScopes(input.scopes).join(","),
  });
  return { key, row };
}

/** The live key a caller presented, or null. Looked up by hash, so the comparison never sees the key. */
export function verifyAgentKey(presented: string): AgentKey | null {
  if (!isAgentKeyShape(presented)) return null;
  const row = activeAgentKeyByHash(hashAgentKey(presented));
  if (!row) return null;
  try {
    touchAgentKey(row.id, row.lastUsedAt);
  } catch {
    /* a failed stamp never refuses a valid key */
  }
  return row;
}

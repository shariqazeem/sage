import "server-only";
import { and, desc, eq, isNull } from "drizzle-orm";
import { db } from "./index";
import { nowSeconds } from "./keys";
import { agentKeys, type AgentKey } from "./schema";

/** Store a key's record (its hash, never the key). */
export function insertAgentKey(row: Omit<AgentKey, "createdAt" | "lastUsedAt" | "revokedAt">): AgentKey {
  const full: AgentKey = { ...row, createdAt: nowSeconds(), lastUsedAt: null, revokedAt: null };
  db.insert(agentKeys).values(full).run();
  return full;
}

/** A workspace's keys, newest first, revoked ones included (the record of what was granted). */
export function listAgentKeys(workspaceId: string): AgentKey[] {
  return db.select().from(agentKeys).where(eq(agentKeys.workspaceId, workspaceId)).orderBy(desc(agentKeys.createdAt)).all();
}

export function countActiveAgentKeys(workspaceId: string): number {
  return db.select().from(agentKeys).where(and(eq(agentKeys.workspaceId, workspaceId), isNull(agentKeys.revokedAt))).all().length;
}

/** The live key with this hash, or null (unknown or revoked). */
export function activeAgentKeyByHash(keyHash: string): AgentKey | null {
  return db.select().from(agentKeys).where(and(eq(agentKeys.keyHash, keyHash), isNull(agentKeys.revokedAt))).get() ?? null;
}

/** Revoke one of a workspace's keys. True when a live key was revoked. */
export function revokeAgentKey(workspaceId: string, id: string): boolean {
  const res = db.update(agentKeys).set({ revokedAt: nowSeconds() }).where(and(eq(agentKeys.id, id), eq(agentKeys.workspaceId, workspaceId), isNull(agentKeys.revokedAt))).run();
  return res.changes > 0;
}

/** Stamp a key's last use, at most once a minute (a busy agent must not write on every call). */
export function touchAgentKey(id: string, lastUsedAt: number | null): void {
  const now = nowSeconds();
  if (lastUsedAt !== null && now - lastUsedAt < 60) return;
  db.update(agentKeys).set({ lastUsedAt: now }).where(eq(agentKeys.id, id)).run();
}

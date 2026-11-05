import "server-only";
import { and, eq } from "drizzle-orm";
import { db } from "./index";
import { nowSeconds } from "./keys";
import { workspaceFacts } from "./schema";
import { isFactKind, normalizeFact, type FactKind } from "@/lib/launch/remembered";

/** Everything a workspace has told Sage once, by kind. */
export function getWorkspaceFacts(workspaceId: string): Partial<Record<FactKind, string>> {
  const out: Partial<Record<FactKind, string>> = {};
  for (const r of db.select().from(workspaceFacts).where(eq(workspaceFacts.workspaceId, workspaceId)).all()) {
    if (isFactKind(r.kind)) out[r.kind] = r.value;
  }
  return out;
}

/**
 * Remember what a founder typed into a card. Each value is shape-checked for its kind (remembered.ts);
 * anything that isn't a clean repository, invite or https URL is dropped, never stored. Returns how many
 * were kept.
 */
export function rememberWorkspaceFacts(workspaceId: string, facts: { kind: unknown; value: unknown }[]): number {
  let kept = 0;
  for (const f of facts.slice(0, 10)) {
    if (!isFactKind(f.kind) || typeof f.value !== "string") continue;
    const value = normalizeFact(f.kind, f.value);
    if (!value) continue;
    const now = nowSeconds();
    db.insert(workspaceFacts)
      .values({ workspaceId, kind: f.kind, value, updatedAt: now })
      .onConflictDoUpdate({ target: [workspaceFacts.workspaceId, workspaceFacts.kind], set: { value, updatedAt: now } })
      .run();
    kept++;
  }
  return kept;
}

/** Forget one (the founder dropped it from a card on purpose). */
export function forgetWorkspaceFact(workspaceId: string, kind: FactKind): void {
  db.delete(workspaceFacts).where(and(eq(workspaceFacts.workspaceId, workspaceId), eq(workspaceFacts.kind, kind))).run();
}

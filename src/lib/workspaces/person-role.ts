import "server-only";
import { declaredLinksOf } from "@/lib/campaigns/wallet-links";
import { isWorkspaceMemberAddress, memberRole, walletMemberKey } from "@/lib/db/workspaces";
import type { Workspace, WorkspaceRole } from "@/lib/db/schema";

/**
 * THE ROLE A PERSON HOLDS IN A WORKSPACE, whichever of their wallets they signed in with.
 *
 * A workspace already follows the person (`workspaceContext`, `founderPlan`): signed in with a wallet
 * they DECLARED as theirs, they walk into the workspace that wallet owns, and launch on its plan. Every
 * role check still asked about the one wallet in the session, so the same person, in their own
 * workspace, was told "only the workspace owner can invite" (found 27 Oct 2026: a MetaMask bound to an
 * older account could launch but not invite, buy a plan, use a code or read its own receipts).
 *
 * Declared links only, as everywhere: a `discovered` link is the farm watch's finding, and inheriting
 * a role through one would hand a wallet cluster a founder's workspace.
 */
const RANK: Record<WorkspaceRole, number> = { owner: 0, admin: 1, member: 2 };

export function personRole(ws: Pick<Workspace, "id" | "ownerKey">, address: string): WorkspaceRole | null {
  let best: WorkspaceRole | null = null;
  for (const id of [address, ...declaredLinksOf(address)]) {
    const key = walletMemberKey(id);
    const role: WorkspaceRole | null = ws.ownerKey === key ? "owner" : memberRole(ws.id, key);
    if (role && (best === null || RANK[role] < RANK[best])) best = role;
    if (best === "owner") break;
  }
  return best;
}

/**
 * Whether this person is in the workspace: any of their declared wallets joined it. The members-only
 * door asks this, so someone who joined by email and later signs in with the MetaMask they bound is
 * still let in. Pay still goes to the wallet that submits, which is theirs.
 */
export function isWorkspacePerson(workspaceId: string, address: string): boolean {
  return [address, ...declaredLinksOf(address)].some((a) => isWorkspaceMemberAddress(workspaceId, a));
}

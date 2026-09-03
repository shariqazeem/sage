import "server-only";
import { getFounderAddress, founderStorageKey } from "@/lib/auth/founder";
import { countMembers, memberRole, walletMemberKey, workspaceOwnedBy, workspacesForMember } from "@/lib/db/workspaces";
import type { Workspace, WorkspaceRole } from "@/lib/db/schema";

export interface WorkspaceContext {
  address: string;
  memberKey: string;
  /** the workspace this founder owns, if any (v1: one) */
  owned: Workspace | null;
  /** every workspace they belong to, owned one first */
  memberships: { workspace: Workspace; role: WorkspaceRole }[];
}

/** Who is asking, and which workspaces are theirs. Null when not signed in. */
export async function workspaceContext(): Promise<WorkspaceContext | null> {
  const address = await getFounderAddress();
  if (!address) return null;
  const memberKey = walletMemberKey(address);
  const owned = workspaceOwnedBy(founderStorageKey(address));
  const all = workspacesForMember(memberKey);
  const memberships = all
    .map((workspace) => ({ workspace, role: memberRole(workspace.id, memberKey) ?? ("member" as const) }))
    .sort((a, b) => (a.role === "owner" ? -1 : b.role === "owner" ? 1 : 0));
  return { address, memberKey, owned, memberships };
}

export function canManage(role: WorkspaceRole | null): boolean {
  return role === "owner" || role === "admin";
}

export { countMembers };

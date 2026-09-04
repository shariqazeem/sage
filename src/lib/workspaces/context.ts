import "server-only";
import { getFounderAddress, founderStorageKey } from "@/lib/auth/founder";
import { countMembers, memberRole, walletMemberKey, workspaceOwnedBy, workspacesForMember } from "@/lib/db/workspaces";
import { declaredLinksOf } from "@/lib/campaigns/wallet-links";
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
  /*
    A WORKSPACE FOLLOWS THE PERSON, NOT THE WALLET THEY HAPPEN TO BE HOLDING.

    Reported 2026-09-05: signed in by email, bound an Ethereum wallet, and was asked to set up an
    account from scratch — "it should be binded in same email right?". It should. A wallet the
    person DECLARED as theirs (they proved control of both and asked for them to be joined) is the
    same account, so a workspace owned by either is theirs to walk into.

    Declared links ONLY. A `discovered` link is the consolidation watch's finding about wallet
    rotation, and inheriting a workspace through one would let a farm cluster walk into a founder's
    account. Their own address is still tried first, so nothing changes for anyone unbound.
  */
  const owned =
    workspaceOwnedBy(founderStorageKey(address)) ??
    declaredLinksOf(address)
      .map((w) => workspaceOwnedBy(founderStorageKey(w)))
      .find((w): w is Workspace => !!w) ??
    null;
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

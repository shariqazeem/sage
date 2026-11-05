import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * ONE DOOR POLICY FOR EVERY DOOR.
 *
 * The Telegram door copied only the sanctions screen and the recipient list from the web door, so a farmer
 * refused at the web for want of a personhood proof could submit through chat (found 5 Nov 2026).
 */
const state = vi.hoisted(() => ({ doorArmed: true, verified: false, paid: 0, member: false }));
vi.mock("@/lib/identity/door", () => ({ PERSONHOOD_DOOR_COPY: "Verify you're a person once.", alreadyClaimedCopy: () => "Already claimed.", identityDoorArmed: () => state.doorArmed }));
vi.mock("@/lib/identity/worldid", () => ({ worldIdConfig: () => ({ action: "sage-worker" }) }));
vi.mock("@/lib/db/identity", () => ({ identityFor: () => (state.verified ? { nullifier: "n" } : null) }));
vi.mock("@/lib/identity/standing", () => ({ identityTiersArmed: () => false, standingOf: () => ({ tier: "new" }) }));
vi.mock("@/lib/identity/person", () => ({ personWallets: (w: string) => [w] }));
vi.mock("@/lib/db/campaigns", () => ({ countPaidByWalletsInCampaign: () => state.paid }));
vi.mock("@/lib/db/workspaces", () => ({ campaignWorkspace: () => ({ id: "ws1", name: "Acme" }) }));
vi.mock("@/lib/workspaces/person-role", () => ({ isWorkspacePerson: () => state.member }));
vi.mock("@/lib/deputy/sanctions", () => ({ isSanctionedWallet: () => false, SANCTIONS_LIST_LABEL: "OFAC SDN list" }));

const W = `0x${"1".repeat(40)}`;
const base = { id: "c1", allowlist: null as string[] | null, visibility: "listed", perWalletPayoutCap: 1, rewardAmount: 1_000_000 };

beforeEach(() => Object.assign(state, { doorArmed: true, verified: false, paid: 0, member: false }));

describe("checkSubmitDoor", () => {
  it("asks for a personhood proof on public work, on EVERY door", async () => {
    const { checkSubmitDoor } = await import("./submit-door");
    for (const surface of ["web", "telegram"] as const) {
      const r = checkSubmitDoor(base as never, W, { surface });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.needsVerification).toBe(true);
    }
  });

  it("lets a verified person in, once", async () => {
    const { checkSubmitDoor } = await import("./submit-door");
    state.verified = true;
    expect(checkSubmitDoor(base as never, W).ok).toBe(true);
    state.paid = 1;
    expect(checkSubmitDoor(base as never, W).ok).toBe(false);
  });

  it("never asks the founder's named recipient for a personhood proof, and lets them into unlisted team work", async () => {
    const { checkSubmitDoor } = await import("./submit-door");
    const named = { ...base, allowlist: [W], visibility: "unlisted" };
    expect(checkSubmitDoor(named as never, W, { surface: "telegram" }).ok).toBe(true);
    expect(checkSubmitDoor(named as never, `0x${"2".repeat(40)}`).ok).toBe(false);
  });

  it("keeps a team's unlisted work to its members", async () => {
    const { checkSubmitDoor } = await import("./submit-door");
    const teamOnly = { ...base, visibility: "unlisted" };
    expect(checkSubmitDoor(teamOnly as never, W).ok).toBe(false);
    state.member = true;
    expect(checkSubmitDoor(teamOnly as never, W).ok).toBe(true);
  });
});

describe("both doors run the one policy", () => {
  it("the web route and the chat door both call checkSubmitDoor, and neither keeps a private copy", () => {
    const web = readFileSync(resolve(process.cwd(), "src/app/api/campaigns/[id]/submit/route.ts"), "utf8");
    const chat = readFileSync(resolve(process.cwd(), "src/lib/campaigns/recipient-submit.ts"), "utf8");
    for (const src of [web, chat]) {
      expect(src).toMatch(/checkSubmitDoor\(campaign, wallet/);
      expect(src).not.toMatch(/identityDoorArmed\(\) && publicWork/);
    }
  });
});

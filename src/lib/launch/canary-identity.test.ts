import { describe, expect, it, beforeEach, afterEach } from "vitest";

import { resolveCanaryIdentity } from "./job";
import { saveAgentWallet } from "@/lib/db/agent-wallets";

/**
 * A TELEGRAM FOUNDER IS STILL A FOUNDER.
 *
 * The grounded planner is gated on a server-verified wallet, which is right. But a job's
 * `founderWallet` is an ownership NAMESPACE, not always an address, and only the `0x` shape ever
 * satisfied that gate. Measured over all 344 production jobs: every one of the 20 grounded plans
 * ever selected came from a `0x` founder, and all 43 Telegram founders were refused as
 * `no_server_identity` — never once for a reason about their product or their plan.
 *
 * They were getting a structurally weaker plan than a web founder would get for the same product
 * and the same budget, because of which string the namespace happened to hold.
 *
 * These tests pin both halves: the resolution that fixes it, and the refusals that must survive it.
 */

const WALLET = `0x${"a".repeat(40)}`;
const AGENT_WALLET = `0x${"b".repeat(40)}`;

const saved = process.env.MISSION_CANARY_ALLOWLIST;
beforeEach(() => {
  process.env.MISSION_CANARY_ALLOWLIST = "*";
});
afterEach(() => {
  if (saved === undefined) delete process.env.MISSION_CANARY_ALLOWLIST;
  else process.env.MISSION_CANARY_ALLOWLIST = saved;
});

describe("a web founder is unchanged", () => {
  it("resolves their SIWE wallet directly", () => {
    const id = resolveCanaryIdentity(WALLET);
    expect(id).toEqual({ wallet: WALLET, operatorAuthorized: true, source: "server_session" });
  });
});

describe("a Telegram founder now resolves to the wallet they actually have", () => {
  it("uses the linked Privy agent wallet for the chat the namespace names", () => {
    saveAgentWallet({
      chatId: "778899",
      founderAddress: `0x${"f".repeat(40)}`,
      privyWalletId: "pw_1",
      privyWalletAddress: AGENT_WALLET,
      policyId: "pol_1",
      perCampaignCapBase: 1_000_000,
    });
    const id = resolveCanaryIdentity("clawup:778899");
    expect(id).not.toBeNull();
    expect(id!.wallet).toBe(AGENT_WALLET.toLowerCase());
    expect(id!.source).toBe("server_session");
    expect(id!.operatorAuthorized).toBe(true);
  });

  it("stays null for a chat that never linked a wallet", () => {
    // No wallet is not a weaker founder, it is an absent one. Behaviour here is exactly as before.
    expect(resolveCanaryIdentity("clawup:never-linked-000")).toBeNull();
  });
});

describe("what must still be refused", () => {
  it.each([
    ["anonymous", "anonymous"],
    ["an empty namespace", "clawup:"],
    ["nothing at all", ""],
    ["null", null],
    ["undefined", undefined],
    ["a non-address string", "not-a-wallet"],
    ["a short hex string", "0xdead"],
  ])("%s resolves to no identity", (_label, input) => {
    expect(resolveCanaryIdentity(input as string | null | undefined)).toBeNull();
  });

  it("does not invent authority from a namespace that merely looks like one", () => {
    // The lookup is a primary-key read against wallets minted by the link flow. A namespace with no
    // row behind it grants nothing, which is what keeps this from being a way to claim authority.
    expect(resolveCanaryIdentity("clawup:0x1234")).toBeNull();
  });

  it("still respects the allowlist when it is not open", () => {
    // Resolution and authorization are separate: finding the wallet must not imply allowing it.
    process.env.MISSION_CANARY_ALLOWLIST = `0x${"c".repeat(40)}`;
    saveAgentWallet({
      chatId: "112233",
      founderAddress: `0x${"f".repeat(40)}`,
      privyWalletId: "pw_2",
      privyWalletAddress: AGENT_WALLET,
      policyId: "pol_2",
      perCampaignCapBase: 1_000_000,
    });
    const id = resolveCanaryIdentity("clawup:112233");
    expect(id).not.toBeNull();
    expect(id!.operatorAuthorized).toBe(false);
  });
});

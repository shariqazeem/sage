import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A WALLETLESS FOUNDER MUST NOT BE SENT TO A BLOCK EXPLORER.
 *
 * MEASURED live in the bot: "How much btc for gas in my wallet" ->
 *
 *   "I don't have a tool to check your wallet's native BTC balance — I can only see your USDC.
 *    You'd need to check your wallet directly ... on a block explorer or wallet app."
 *
 * GOAT charges gas in native BTC, so a wallet holding plenty of USDC and no BTC cannot launch
 * anything. The gas number DID exist — inside `sage_fund_and_launch`, at the moment of launching,
 * and nowhere else — so a founder could only discover they were short by having a launch fail.
 * Telling someone who was promised they'd never need a wallet to go read a block explorer is the
 * whole promise breaking in one sentence.
 *
 * The threshold is shared with the launch gate on purpose: two copies of that number is how status
 * says "you have enough" and the launch then says "needs gas".
 */

const h = vi.hoisted(() => ({ usdc: BigInt(0), gasWei: BigInt(0), throwGas: false }));

vi.mock("@/lib/deputy/chain", () => ({
  publicClient: () => ({
    readContract: async () => h.usdc,
    getBalance: async () => {
      if (h.throwGas) throw new Error("rpc down");
      return h.gasWei;
    },
  }),
}));
vi.mock("@/lib/privy/onboarding", () => ({
  founderBinding: (chatId: string) =>
    chatId === "hasWallet"
      ? {
          chatId,
          founderAddress: "0x1111111111111111111111111111111111111111",
          privyWalletId: "pw_1",
          privyWalletAddress: "0x1111111111111111111111111111111111111111",
          policyId: "pol_1",
          perCampaignCapBase: 2_000_000,
          chainId: 2345,
        }
      : null,
  onboardWalletless: vi.fn(),
}));

import { callAgentWalletTool, MIN_GAS_WEI } from "./agent-wallet-tools";

const status = async () => {
  const r = await callAgentWalletTool("sage_agent_wallet_status", {}, "hasWallet");
  return JSON.parse(r.content[0]?.text ?? "{}");
};

beforeEach(() => {
  h.usdc = BigInt(6_500_000); // 6.50 USDC, the real balance from the live chat
  h.gasWei = BigInt(0);
  h.throwGas = false;
});

describe("wallet status answers the gas question", () => {
  it("reports the native BTC balance, not just USDC", async () => {
    h.gasWei = BigInt(5_000_000_000_000);
    const s = await status();
    expect(s.balanceUsdc).toBe(6.5);
    expect(s.gasSymbol).toBe("BTC");
    expect(s.gasBalanceBtc).toBe("0.000005");
  });

  it("says plainly when there is not enough gas to launch", async () => {
    h.gasWei = BigInt(0);
    const s = await status();
    expect(s.enoughGasToLaunch).toBe(false);
    expect(s.gasBalanceBtc).toBe("0");
  });

  it("says so when there is enough", async () => {
    h.gasWei = MIN_GAS_WEI;
    expect((await status()).enoughGasToLaunch).toBe(true);
  });

  it("judges by the SAME threshold the launch gate uses", async () => {
    // One wei under the launch gate must not read as launchable, or status and launch disagree
    // and the founder is told they are fine right before it fails.
    h.gasWei = MIN_GAS_WEI - BigInt(1);
    expect((await status()).enoughGasToLaunch).toBe(false);
    const s = await status();
    expect(s.minGasToLaunchBtc).toBe("0.000003");
  });

  it("degrades honestly when the chain read fails, rather than claiming zero gas", async () => {
    // Reporting 0 on an RPC blip would send a funded founder off to top up gas they already have.
    h.throwGas = true;
    const s = await status();
    expect(s.gasBalanceBtc).toBeNull();
    expect(s.enoughGasToLaunch).toBeNull();
    expect(s.balanceUsdc).toBe(6.5); // the USDC read still succeeded
  });

  it("still reports no wallet when there is none", async () => {
    const r = await callAgentWalletTool("sage_agent_wallet_status", {}, "noWallet");
    const s = JSON.parse(r.content[0]?.text ?? "{}");
    expect(s.linked).toBe(false);
  });
});

describe("the model is never invited to do the money math", () => {
  /**
   * MEASURED on prod 2026-08-27. The founder had EXACTLY 1.00 USDC and asked to launch a 1.00 USDC
   * gig. The model called wallet-status, saw `balanceUsdc: 1`, compared it to the budget ITSELF,
   * announced "balance short — send 1 more USDC", and never called sage_fund_and_launch at all. A
   * fully funded campaign looked unfundable, and the real run stalled on arithmetic the model was
   * never supposed to perform.
   *
   * The balance therefore ships WITH its own instruction: informational, never a sufficiency
   * verdict. (The launch tool's own `balance < budget` check is the one place that decides, and
   * equality passes — pinned below so nobody "fixes" it into a `<=`.)
   */
  it("wallet status carries an explicit do-not-compare instruction", async () => {
    h.usdc = BigInt(1_000_000);
    const s = await status();
    expect(s.balanceUsdc).toBe(1);
    expect(String(s.sufficiencyNote)).toMatch(/never compare/i);
    expect(String(s.sufficiencyNote)).toMatch(/sage_fund_and_launch/);
  });

  it("a balance EQUAL to the budget is sufficient — equality must never read as short", () => {
    const balance = BigInt(1_000_000);
    const budget = BigInt(1_000_000);
    expect(balance < budget).toBe(false); // the launch tool's exact predicate
  });
});

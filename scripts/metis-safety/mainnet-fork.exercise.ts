import { describe, expect, it, vi } from "vitest";
import { createPublicClient, createTestClient, createWalletClient, defineChain, erc20Abi, getAddress, http, parseUnits, publicActions, type Address } from "viem";
import { mnemonicToAccount } from "viem/accounts";

/**
 * METIS MAINNET, REHEARSED (run through run-mainnet-fork.mjs, never directly).
 *
 * Sage has never launched or paid on Metis with real money. This drives a founder's whole money path through
 * PRODUCTION's own code against a fork of Metis Andromeda, so the first real job on Metis is not the first time
 * the path runs:
 *  1. a job is written the way Post writes it (composeDirectBody → createDirectCampaign);
 *  2. it launches from the founder's account (launchFromTreasury): the preflight reads balance and gas on the
 *     fork, the bundle is built, the executor estimates, prices Metis as legacy, broadcasts, and the vault is
 *     re-read and recorded. Only the wallet provider's SIGNATURE is stood in for, with a fork-only key;
 *  3. a worker submits, the judge holds it (no model key here), the founder approves, and the operator pays
 *     through settleByRail with its real signer code;
 *  4. a second settle pays nothing.
 * The fork runs a pre-London hardfork, so a type-2 transaction from any of this code would be refused, as
 * Metis refuses it.
 */
const h = vi.hoisted(() => ({
  MNEMONIC: "test test test test test test test test test test test junk",
  signed: [] as { type: string; to: string }[],
}));
const at = (i: number) => mnemonicToAccount(h.MNEMONIC, { addressIndex: i });
const founder = at(0);
const account = at(2);
const worker = at(3);

// The ONE stand-in: the wallet provider's signature. The transaction it signs is exactly what production built.
vi.mock("@/lib/privy/client", async (orig) => {
  const real = (await orig()) as Record<string, unknown>;
  return {
    ...real,
    signEvmTransaction: async (_walletId: string, tx: Record<string, string | number | undefined>, chainId: number) => {
      const { mnemonicToAccount: derive } = await import("viem/accounts");
      const acct = derive(h.MNEMONIC, { addressIndex: 2 });
      const base = { chainId, to: tx.to as Address, value: BigInt((tx.value as string) ?? "0x0"), data: tx.data as `0x${string}`, nonce: Number(BigInt(tx.nonce as string)), gas: BigInt(tx.gas_limit as string) };
      if (tx.gas_price !== undefined) {
        h.signed.push({ type: "legacy", to: String(tx.to) });
        return acct.signTransaction({ ...base, type: "legacy", gasPrice: BigInt(tx.gas_price as string) });
      }
      h.signed.push({ type: "eip1559", to: String(tx.to) });
      return acct.signTransaction({ ...base, type: "eip1559", maxFeePerGas: BigInt(tx.max_fee_per_gas as string), maxPriorityFeePerGas: BigInt(tx.max_priority_fee_per_gas as string) });
    },
  };
});

const RPC = process.env.METIS_FORK_RPC ?? "";
const USDC = getAddress("0xEA32A96608495e54156Ae48931A7c20f0dcc1a21");
const NETSWAP_PAIR = getAddress("0x5Ae3ee7fBB3Cb28C17e7ADc3a6Ae605ae2465091"); // holds m.USDC on mainnet, so on the fork
const chain = defineChain({ id: 1088, name: "Metis (fork)", nativeCurrency: { name: "Metis", symbol: "METIS", decimals: 18 }, rpcUrls: { default: { http: [RPC] } } });

describe("Metis mainnet, rehearsed on a fork", () => {
  it("launches from the account and pays a worker through production's own code", async () => {
    // HARD GUARD: only ever a local fork
    expect(RPC).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    expect(process.env.METIS_MAINNET_RPC_URL).toBe(RPC);
    const pub = createPublicClient({ chain, transport: http(RPC) });
    expect(await pub.getChainId()).toBe(1088);
    const test = createTestClient({ chain, mode: "anvil", transport: http(RPC) }).extend(publicActions);
    const usdc = (a: Address) => pub.readContract({ address: USDC, abi: erc20Abi, functionName: "balanceOf", args: [a] });

    // the account holds what a founder deposits: m.USDC (borrowed from the pool on the fork) and METIS for its fee
    await test.setBalance({ address: NETSWAP_PAIR, value: parseUnits("10", 18) });
    await test.impersonateAccount({ address: NETSWAP_PAIR });
    const pool = createWalletClient({ chain, transport: http(RPC), account: NETSWAP_PAIR });
    const fundTx = await pool.writeContract({ address: USDC, abi: erc20Abi, functionName: "transfer", args: [account.address, parseUnits("20", 6)], type: "legacy", gasPrice: await pub.getGasPrice() });
    await pub.waitForTransactionReceipt({ hash: fundTx });
    await test.stopImpersonatingAccount({ address: NETSWAP_PAIR });
    await test.setBalance({ address: account.address, value: parseUnits("1", 18) });
    expect(await usdc(account.address)).toBe(parseUnits("20", 6));

    const { saveAgentWallet } = await import("@/lib/db/agent-wallets");
    const { webTreasuryKey } = await import("@/lib/treasury/web");
    const { composeDirectBody } = await import("@/lib/launch/composer");
    const { createDirectCampaign, directCampaignSchema } = await import("@/lib/launch/direct-campaign");
    const { launchFromTreasury } = await import("@/lib/treasury/launch");
    const { getCampaign, listMissions, createSubmission, getSubmission, updateSubmission, getDecisionBySubmission } = await import("@/lib/db/campaigns");
    const { runDeputyOnSubmission } = await import("@/lib/deputy/pipeline");
    const { settleByRail } = await import("@/lib/campaigns/settle-dispatch");

    // 1. the founder's account on Metis (what POST /api/workspaces opens at sign-in)
    saveAgentWallet({ chatId: webTreasuryKey(founder.address, 1088), founderAddress: founder.address, privyWalletId: "fork-wallet", privyWalletAddress: account.address, policyId: "fork-policy", perCampaignCapBase: 50_000_000, chainId: 1088 });

    // 2. a job, written the way Post writes it
    const body = composeDirectBody({
      who: "anyone",
      slots: "2",
      tranches: [{ amount: "1", title: "Write a short guide to Sage", deliverable: "A public guide to posting a job on Sage is live", verify: "link", expectedText: "", toAddr: "", instructions: "1. Write a short guide to posting a job on Sage.\n2. Publish it and put your wallet address in it.\n3. Submit the link.", criteria: ["The guide explains how to post a job", "The guide is in the writer's own words"] }],
      splitTotal: "",
      currency: "USD",
      inviteOnly: false,
      why: "",
      title: "Write a short guide to Sage",
    });
    const parsed = directCampaignSchema.safeParse(body);
    expect(parsed.success).toBe(true);
    const created = createDirectCampaign(parsed.success ? parsed.data : (body as never), founder.address);
    expect(created.ok).toBe(true);
    const jobId = created.ok ? created.jobId : "";

    // 3. LAUNCH from the account: production's preflight, bundle, executor and record
    const launch = await launchFromTreasury(founder.address, jobId, 1088);
    console.log("LAUNCH", JSON.stringify(launch));
    expect(launch.ok).toBe(true);
    if (!launch.ok) return;
    expect(h.signed.length).toBe(4); // create, approve, fund, activate
    expect(h.signed.every((s) => s.type === "legacy")).toBe(true);
    const vault = getAddress(launch.vault);
    expect(await usdc(vault)).toBe(parseUnits("2", 6)); // $1 × 2 people, exactly
    const campaign = getCampaign(launch.campaignId)!;
    expect(campaign.chainId).toBe(1088);
    const [mission] = listMissions(campaign.id);
    expect(mission).toBeTruthy();

    // 4. a worker submits; with no model key the judge holds it; the founder approves; the operator pays
    const sub = createSubmission({ campaignId: campaign.id, wallet: worker.address, evidenceUrl: "https://example.com/", note: "My guide.", missionIdHash: mission!.missionIdHash, missionSpecDigest: mission!.specDigest });
    expect(sub.ok).toBe(true);
    const sid = sub.ok ? sub.submission.id : "";
    const judged = await runDeputyOnSubmission(sid);
    console.log("JUDGED", JSON.stringify(judged));
    expect(getDecisionBySubmission(sid)).toBeTruthy();

    const before = await usdc(worker.address);
    updateSubmission(sid, { status: "approved", decidedAt: Math.floor(Date.now() / 1000) });
    const paid = await settleByRail(getCampaign(campaign.id)!, getSubmission(sid)!);
    console.log("PAID", JSON.stringify(paid));
    expect(await usdc(worker.address)).toBe(before + parseUnits("1", 6));
    expect(await usdc(vault)).toBe(parseUnits("1", 6));

    // 5. a second settle of the same work pays nothing
    await settleByRail(getCampaign(campaign.id)!, getSubmission(sid)!).catch((e) => console.log("SECOND SETTLE REFUSED", e instanceof Error ? e.message : e));
    expect(await usdc(worker.address)).toBe(before + parseUnits("1", 6));
  });
});

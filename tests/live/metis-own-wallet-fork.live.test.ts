/**
 * PAY FROM YOUR OWN WALLET ON METIS, REHEARSED ON A FORK (20 Nov 2026).
 *
 * From 1 Dec 2026 Metis counts only wallets a person controls, so a builder's own wallet now creates,
 * funds and activates the job's vault. This runs that launch end to end on a local fork of Metis
 * Andromeda, with production's own code on every side:
 *
 *  - the SERVER's prepare door (`prepareOwnWalletLaunch`, real settings and bundle builders) hands over
 *    the calls for a fresh wallet;
 *  - the BROWSER's driver (`runOwnWalletLaunch`, the real chain reader) sends them, each signed by that
 *    wallet's own key as a type-0 transaction and checked the way the embedded-wallet path checks bytes;
 *  - the SERVER's record door (`recordOwnWalletLaunch`, the real `readVaultFacts`) reads the fork and
 *    accepts the vault; two tampered vaults (another operator; underfunded) are refused;
 *  - the REAL operator address pays the mission once; the same person again is refused (code 6) and a
 *    second person on the one-place mission is refused (code 7).
 *
 *   METIS_FORK=1 npx vitest run metis-own-wallet-fork.live
 *
 * Nothing is broadcast to Metis: anvil holds its own copy of the chain. The wallets are keys made for this
 * run; their METIS is set on the fork and their m.USDC is moved from a holder by impersonation
 * (METIS_FORK_HOLDER, default Netswap's METIS/m.USDC pool, the largest holder Sage already reads). Needs Foundry's `anvil` and the network.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createPublicClient,
  createTestClient,
  createWalletClient,
  decodeEventLog,
  encodeFunctionData,
  formatEther,
  getAddress,
  http,
  keccak256,
  parseAbi,
  toHex,
  type Abi,
  type Address,
  type Hex,
} from "viem";
import { generatePrivateKey, privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";

import type { DeploymentReadyPlan } from "@/lib/launch/approve";
import type { LoadedPlan } from "@/lib/launch/deployment-service";
import { minLaunchGasWei } from "@/lib/treasury/gas-policy";
import { prepareOwnWalletLaunch, recordOwnWalletLaunch, expectedVault, type OwnWalletDeps } from "@/lib/own-wallet/flow";
import { readVaultFacts, readVaultState, realOwnWalletDeps, type VaultReader } from "@/lib/own-wallet/server";
import { assertSignedLegacy, readOwnWalletState } from "@/lib/own-wallet/browser";
import { verifyOwnWalletVault, type LegacyTx, type OwnWalletParams, type OwnWalletStep } from "@/lib/own-wallet/plan";
import { runOwnWalletLaunch, type OwnWalletIO, type RunView } from "@/lib/own-wallet/run";
import campaignVaultArtifact from "../../contracts/out/CampaignVault.sol/CampaignVault.json";

const RUN = process.env.METIS_FORK === "1";
const RPC = process.env.METIS_FORK_RPC ?? "https://andromeda.metis.io/?owner=1088";
const PORT = 8548;
const LOCAL = `http://127.0.0.1:${PORT}`;

const FACTORY = getAddress("0xdD9a45c181dD95e48CDdC0149C8b821D604C45C9");
const TOKEN = getAddress("0xEA32A96608495e54156Ae48931A7c20f0dcc1a21"); // m.USDC
const OPERATOR = getAddress("0x0deF3D4124D0cD1708aEFFE6c1BC8182342a44D6");
const HOLDER = getAddress(process.env.METIS_FORK_HOLDER ?? "0x5Ae3ee7fBB3Cb28C17e7ADc3a6Ae605ae2465091");
const REWARD = BigInt(1_000_000); // $1.00, one place

const erc20 = parseAbi(["function balanceOf(address) view returns (uint256)", "function transfer(address to, uint256 amount) returns (bool)", "function approve(address spender, uint256 amount) returns (bool)"]);
const factoryAbi = parseAbi([
  "function createCampaignVault(address operator, address guardian, address token, bytes32 campaignIdHash, bytes32[] missionIds, uint256[] rewards, uint256[] maxCompletions, uint256 dailyVelocityCap, uint256 duration) returns (address)",
  "function getVaultByCampaign(address owner, bytes32 campaignIdHash) view returns (address)",
]);
const vaultAbi = campaignVaultArtifact.abi as unknown as Abi;
const bump = (n: bigint): bigint => (n * BigInt(12)) / BigInt(10);

const metis = { id: 1088, name: "Metis Andromeda (fork)", nativeCurrency: { name: "Metis", symbol: "METIS", decimals: 18 }, rpcUrls: { default: { http: [LOCAL] } } } as const;

describe.skipIf(!RUN)("Metis: a builder pays from their own wallet, rehearsed on a fork", () => {
  let anvil: ChildProcess | null = null;
  const real = createPublicClient({ transport: http(RPC) });
  const pub = createPublicClient({ chain: metis, transport: http(LOCAL) });
  const test = createTestClient({ chain: metis, mode: "anvil", transport: http(LOCAL) });
  const wallet = createWalletClient({ chain: metis, transport: http(LOCAL) });
  const reader = pub as unknown as VaultReader;
  const browserReader = pub as unknown as Parameters<typeof readOwnWalletState>[1];
  let gasPrice = BigInt(0);
  const spent: { step: string; gas: bigint; wei: bigint }[] = [];

  const stamp = Date.now().toString();
  const missionId = keccak256(toHex(`own-wallet-mission-${stamp}`));
  // the plan fields the launch reads; the rest of a real plan never reaches the chain
  const plan = {
    publicCampaignId: `own-wallet-${stamp}`,
    campaignIdHash: keccak256(toHex(`own-wallet-${stamp}`)),
    totalBudgetBase: REWARD.toString(),
    tokenDecimals: 6,
    missions: [{ missionIdHash: missionId, rewardBase: REWARD.toString(), maxCompletions: 1 }],
  } as unknown as DeploymentReadyPlan;
  const loaded = { plan, revisionId: "rev", revisionNumber: 1, model: null, provider: null } as LoadedPlan;

  beforeAll(async () => {
    // the server's own Metis settings (public addresses), as production has them
    process.env.METIS_MAINNET_CAMPAIGN_FACTORY_ADDRESS = FACTORY;
    process.env.METIS_MAINNET_OPERATOR_ADDRESS = OPERATOR;
    gasPrice = await real.getGasPrice();
    anvil = spawn("anvil", ["--fork-url", RPC, "--port", String(PORT), "--chain-id", "1088", "--silent"], { stdio: "ignore" });
    for (let i = 0; i < 60; i++) {
      try {
        await pub.getBlockNumber();
        return;
      } catch {
        await new Promise((r) => setTimeout(r, 500));
      }
    }
    throw new Error("anvil did not start");
  }, 60_000);

  afterAll(() => {
    anvil?.kill();
  });

  /** A wallet made for this run: the launch floor's METIS set on the fork, m.USDC moved from a holder. */
  async function freshWallet(usdc: bigint): Promise<PrivateKeyAccount> {
    const account = privateKeyToAccount(generatePrivateKey());
    await test.setBalance({ address: account.address, value: minLaunchGasWei(1088) });
    await test.setBalance({ address: HOLDER, value: BigInt(10) ** BigInt(18) });
    await test.impersonateAccount({ address: HOLDER });
    const hash = await wallet.sendTransaction({ account: HOLDER, to: TOKEN, data: encodeFunctionData({ abi: erc20, functionName: "transfer", args: [account.address, usdc] }), gas: BigInt(150_000), gasPrice: bump(gasPrice), type: "legacy", chain: metis });
    expect((await pub.waitForTransactionReceipt({ hash })).status).toBe("success");
    await test.stopImpersonatingAccount({ address: HOLDER });
    return account;
  }

  /** The wallet's own key signs a type-0 transaction; the bytes are checked as the embedded path checks them, then sent. */
  async function signAndSend(account: PrivateKeyAccount, tx: LegacyTx): Promise<Hex> {
    const nonce = await pub.getTransactionCount({ address: account.address, blockTag: "pending" });
    const raw = await account.signTransaction({ type: "legacy", chainId: tx.chainId, to: tx.to, data: tx.data, value: tx.value, gas: tx.gas, gasPrice: tx.gasPrice, nonce });
    await assertSignedLegacy(raw, tx, nonce);
    return pub.sendRawTransaction({ serializedTransaction: raw });
  }

  /** One raw call from a wallet, for the tampered vaults (which the door would never hand out). */
  async function rawCall(account: PrivateKeyAccount, to: Address, data: Hex): Promise<void> {
    const gas = await pub.estimateGas({ account: account.address, to, data });
    const hash = await signAndSend(account, { type: "legacy", chainId: 1088, from: account.address, to, data, value: BigInt(0), gas: bump(gas), gasPrice: bump(gasPrice) });
    expect((await pub.waitForTransactionReceipt({ hash })).status).toBe("success");
  }

  /** The server's doors with the chain pointed at the fork; no database, so the recorder is a stand-in that counts. */
  function serverDeps(owner: Address, recorded: string[]): OwnWalletDeps {
    // this wallet's own record, as the campaigns table would hold it: a second ask answers from it
    let live: { id: string; vaultAddress: string; posterWallet: string } | null = null;
    return {
      ...realOwnWalletDeps, // closedReason, settings, bundle: production's own
      job: () => ({ founderWallet: owner }),
      isWeeklyRound: () => false,
      currentRevision: () => 1,
      approve: () => true,
      approvedPlan: () => loaded,
      draftPlan: () => plan,
      launchAllowed: () => ({ ok: true }),
      recordErrors: () => [],
      liveCampaign: () => live,
      vaultState: (_chainId, vault) => readVaultState(reader, vault),
      facts: (expected) => readVaultFacts(reader, expected),
      record: async (o, l, _jobId, _settings, vault) => {
        recorded.push(l.plan.publicCampaignId);
        live = { id: l.plan.publicCampaignId, vaultAddress: vault, posterWallet: o };
        return l.plan.publicCampaignId;
      },
    };
  }

  it("create → approve → fund → activate from a fresh wallet, verified on chain, paid once, refused twice", async () => {
    const builder = await freshWallet(REWARD);
    const recorded: string[] = [];
    const deps = serverDeps(builder.address, recorded);

    // THE SERVER hands over the calls (its real settings + bundle builders, Sage's Metis operator).
    const prepared = await prepareOwnWalletLaunch(builder.address, "job", { approve: true }, deps);
    expect(prepared.ok && prepared.stage).toBe("ready");
    if (!prepared.ok || prepared.stage !== "ready") throw new Error("prepare refused");
    const params: OwnWalletParams = prepared.params;
    expect(params.operator).toBe(OPERATOR);
    expect(params.calls.map((c) => c.step)).toEqual(["create", "approve", "fund", "activate"]);

    // A vault that does not exist yet cannot be recorded.
    expect(await recordOwnWalletLaunch(builder.address, "job", {}, deps)).toMatchObject({ ok: false, reason: "mismatch", mismatches: ["no_vault"] });

    // THE BROWSER's driver walks the steps; every transaction is type 0, signed by the wallet's own key.
    const hashes: Partial<Record<OwnWalletStep, Hex>> = {};
    const sentTypes: string[] = [];
    const io: OwnWalletIO = {
      readState: (p) => readOwnWalletState(p, browserReader),
      estimateGas: (from, call) => pub.estimateGas({ account: from, to: call.to, data: call.data }),
      send: async (tx) => {
        sentTypes.push(tx.type);
        // the price a browser reads from Metis itself, not the fork's
        return signAndSend(builder, { ...tx, gasPrice: bump(gasPrice) });
      },
      txStatus: async (hash) => {
        try {
          return (await pub.getTransactionReceipt({ hash })).status === "success" ? "success" : "reverted";
        } catch {
          return "unknown";
        }
      },
      waitFor: async (hash) => ((await pub.waitForTransactionReceipt({ hash })).status === "success" ? "success" : "reverted"),
      record: async (vault) => {
        const r = await recordOwnWalletLaunch(builder.address, "job", { vault }, deps);
        return r.ok ? { ok: true, campaignId: r.campaignId } : { ok: false, error: r.message, retry: false };
      },
      recall: (step) => hashes[step] ?? null,
      remember: (step, hash) => {
        if (hash) hashes[step] = hash;
        else delete hashes[step];
      },
      sleep: (ms) => new Promise((r) => setTimeout(r, Math.min(ms, 200))),
    };
    const views: RunView[] = [];
    const final = await runOwnWalletLaunch(io, params, (v) => views.push(v));
    expect(final.error).toBeNull();
    expect(final.phase).toBe("live");
    expect(sentTypes).toEqual(["legacy", "legacy", "legacy", "legacy"]);
    expect(recorded).toEqual([plan.publicCampaignId]);

    for (const step of ["create", "approve", "fund", "activate"] as const) {
      const hash = hashes[step]!;
      const [receipt, tx] = await Promise.all([pub.getTransactionReceipt({ hash }), pub.getTransaction({ hash })]);
      expect(tx.type).toBe("legacy");
      expect(getAddress(tx.from)).toBe(builder.address);
      spent.push({ step, gas: receipt.gasUsed, wei: receipt.gasUsed * tx.gasPrice! });
    }

    // On chain: the factory's vault for this wallet and plan, active, holding the whole budget.
    const vault = params.vault;
    expect(await pub.readContract({ address: FACTORY, abi: factoryAbi, functionName: "getVaultByCampaign", args: [builder.address, plan.campaignIdHash] })).toBe(vault);
    expect(Number(await pub.readContract({ address: vault, abi: vaultAbi, functionName: "getState" }))).toBe(2);
    expect(await pub.readContract({ address: TOKEN, abi: erc20, functionName: "balanceOf", args: [vault] })).toBe(REWARD);
    expect(await pub.readContract({ address: TOKEN, abi: erc20, functionName: "balanceOf", args: [builder.address] })).toBe(BigInt(0));

    // Running it again sends nothing: the chain is the memory.
    const again = await runOwnWalletLaunch(io, params, () => undefined);
    expect(again.phase).toBe("live");
    expect(sentTypes).toHaveLength(4);

    // Another signed-in wallet cannot record this vault as theirs.
    const stranger = privateKeyToAccount(generatePrivateKey());
    expect(await recordOwnWalletLaunch(stranger.address, "job", { vault }, serverDeps(stranger.address, recorded))).toMatchObject({ ok: false, reason: "wrong_vault" });

    // TAMPERED 1: the same plan, but the vault's operator is not Sage's. Created, funded and activated for real.
    const mallory = await freshWallet(REWARD);
    const malloryOperator = privateKeyToAccount(generatePrivateKey()).address;
    const day14 = BigInt(14 * 24 * 60 * 60);
    await rawCall(mallory, FACTORY, encodeFunctionData({ abi: factoryAbi, functionName: "createCampaignVault", args: [malloryOperator, mallory.address, TOKEN, plan.campaignIdHash, [missionId], [REWARD], [BigInt(1)], REWARD, day14] }));
    const badVault = await pub.readContract({ address: FACTORY, abi: factoryAbi, functionName: "getVaultByCampaign", args: [mallory.address, plan.campaignIdHash] });
    await rawCall(mallory, TOKEN, encodeFunctionData({ abi: erc20, functionName: "approve", args: [badVault, REWARD] }));
    await rawCall(mallory, badVault, encodeFunctionData({ abi: vaultAbi, functionName: "fund", args: [REWARD] }));
    await rawCall(mallory, badVault, encodeFunctionData({ abi: vaultAbi, functionName: "activate", args: [] }));
    const malloryDeps = serverDeps(mallory.address, recorded);
    // the door: she names her vault, and it is not the one her wallet and this plan produce
    expect(await recordOwnWalletLaunch(mallory.address, "job", { vault: badVault }, malloryDeps)).toMatchObject({ ok: false, reason: "wrong_vault" });
    // the door, naming nothing: the plan's vault for her wallet does not exist
    expect(await recordOwnWalletLaunch(mallory.address, "job", {}, malloryDeps)).toMatchObject({ ok: false, reason: "mismatch", mismatches: ["no_vault"] });
    // and the judgment itself, pointed straight at her funded, active vault: the operator is what is wrong
    const s = realOwnWalletDeps.settings(plan, mallory.address);
    if (!s.ok) throw new Error(s.errors.join(","));
    const malloryExpected = { ...expectedVault(mallory.address, s.settings, realOwnWalletDeps.bundle(plan, s.settings)), vault: badVault };
    const badVerdict = verifyOwnWalletVault(malloryExpected, await readVaultFacts(reader, malloryExpected));
    expect(badVerdict).toEqual({ ok: false, mismatches: ["operator"] });

    // TAMPERED 2: the right vault, funded with half the budget (so it cannot be activated either).
    const stingy = await freshWallet(REWARD);
    const stingyDeps = serverDeps(stingy.address, recorded);
    const sp = await prepareOwnWalletLaunch(stingy.address, "job", { approve: true }, stingyDeps);
    if (!sp.ok || sp.stage !== "ready") throw new Error("prepare refused");
    await rawCall(stingy, sp.params.calls[0].to, sp.params.calls[0].data);
    await rawCall(stingy, sp.params.calls[1].to, sp.params.calls[1].data);
    await rawCall(stingy, sp.params.vault, encodeFunctionData({ abi: vaultAbi, functionName: "fund", args: [REWARD / BigInt(2)] }));
    const under = await recordOwnWalletLaunch(stingy.address, "job", { vault: sp.params.vault }, stingyDeps);
    expect(under).toMatchObject({ ok: false, reason: "mismatch" });
    expect(under.ok ? [] : [...(under.mismatches ?? [])].sort()).toEqual(["not_active", "underfunded"]);
    expect(recorded).toEqual([plan.publicCampaignId]); // only the honest vault was ever recorded

    // THE OPERATOR PAYS: the vault derives the amount, the operator names none.
    const opMetis = await pub.getBalance({ address: OPERATOR });
    const payout = (recipient: Address, n: string) =>
      encodeFunctionData({ abi: vaultAbi, functionName: "requestPayout", args: [missionId, recipient, keccak256(toHex(`decision-${n}-${stamp}`)), keccak256(toHex(`intent-${n}-${stamp}`))] });
    const asOperator = async (step: string, data: Hex) => {
      await test.impersonateAccount({ address: OPERATOR });
      const gas = await pub.estimateGas({ account: OPERATOR, to: vault, data });
      const hash = await wallet.sendTransaction({ account: OPERATOR, to: vault, data, gas: bump(gas), gasPrice: bump(gasPrice), type: "legacy", chain: metis });
      const receipt = await pub.waitForTransactionReceipt({ hash });
      await test.stopImpersonatingAccount({ address: OPERATOR });
      expect(receipt.status, `${step} reverted`).toBe("success");
      spent.push({ step, gas: receipt.gasUsed, wei: receipt.gasUsed * bump(gasPrice) });
      return receipt.logs.filter((l) => getAddress(l.address) === vault).map((l) => decodeEventLog({ abi: vaultAbi, data: l.data, topics: l.topics, strict: false }));
    };
    const worker = getAddress(keccak256(toHex(`own-wallet-worker-${stamp}`)).slice(0, 42));
    const paid = await asOperator("payout", payout(worker, "1"));
    expect(paid.find((e) => e.eventName === "PayoutSettled"), "no PayoutSettled event").toBeTruthy();
    expect(await pub.readContract({ address: TOKEN, abi: erc20, functionName: "balanceOf", args: [worker] })).toBe(REWARD);

    const code = (events: Awaited<ReturnType<typeof asOperator>>): number => {
      const rejected = events.find((e) => e.eventName === "PayoutRejected");
      expect(rejected, "the payout was not refused").toBeTruthy();
      return Number((rejected!.args as unknown as { failedCheckIndex: number }).failedCheckIndex);
    };
    // the same person again: refused, already paid for this mission (the contract's check 6)
    expect(code(await asOperator("refused: same person again", payout(worker, "2")))).toBe(6);
    expect(await pub.readContract({ address: TOKEN, abi: erc20, functionName: "balanceOf", args: [worker] })).toBe(REWARD);
    // a second person on the one-place mission: refused, no places left (check 7)
    const other = getAddress(keccak256(toHex(`own-wallet-other-${stamp}`)).slice(0, 42));
    expect(code(await asOperator("refused: no places left", payout(other, "3")))).toBe(7);
    expect(await pub.readContract({ address: TOKEN, abi: erc20, functionName: "balanceOf", args: [other] })).toBe(BigInt(0));

    // The record door still accepts the vault after it has paid (spent + held = the budget).
    const bs = realOwnWalletDeps.settings(plan, builder.address);
    if (!bs.ok) throw new Error(bs.errors.join(","));
    const afterPay = expectedVault(builder.address, bs.settings, realOwnWalletDeps.bundle(plan, bs.settings));
    expect(verifyOwnWalletVault(afterPay, await readVaultFacts(reader, afterPay))).toEqual({ ok: true });

    const launchWei = spent.filter((x) => ["create", "approve", "fund", "activate"].includes(x.step)).reduce((a, x) => a + x.wei, BigInt(0));
    const payoutWei = spent.find((x) => x.step === "payout")!.wei;
    console.log(
      [
        `gas price on Metis now: ${Number(gasPrice) / 1e9} gwei (sent at +20%, type 0)`,
        ...spent.map((x) => `  ${x.step.padEnd(28)} ${x.gas.toString().padStart(9)} gas  ${formatEther(x.wei)} METIS`),
        `launch from the builder's wallet: ${formatEther(launchWei)} METIS of the ${formatEther(minLaunchGasWei(1088))} METIS the door asks for`,
        `payout: ${formatEther(payoutWei)} METIS of the operator's ${formatEther(opMetis)}`,
        `builder ${builder.address}, vault ${vault} (on the fork only)`,
      ].join("\n"),
    );
    expect(minLaunchGasWei(1088) > launchWei).toBe(true);
  }, 300_000);
});

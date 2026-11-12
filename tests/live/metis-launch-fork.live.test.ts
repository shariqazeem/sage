/**
 * METIS LAUNCH, REHEARSED ON A FORK (12 Nov 2026).
 *
 * The first job on Metis is a founder's own money and has never happened. This runs the account launch
 * the way production builds it (`buildDeployBundle`, the same create → approve → fund → activate) from a
 * REAL account's REAL balances on a local fork of Metis Andromeda, then has the REAL operator address pay
 * the mission, and checks the control: a second person is refused (code 7, no completions left), so "it
 * paid" can't be a vault that pays anything. Nothing is broadcast to Metis; anvil impersonates the
 * accounts on its own copy of the chain.
 *
 *   METIS_FORK=1 npx vitest run metis-launch-fork.live
 *
 * Needs Foundry's `anvil` on PATH and the network. Defaults are the founder's account and the live
 * factory, token and operator; METIS_FORK_ACCOUNT / _GUARDIAN / _BUDGET_BASE / _RPC override them. Every
 * transaction is priced as the executor prices it on Metis (type 0, the network's gas price +20%), so a
 * pass also says the account and the operator hold enough METIS for it.
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
import { buildDeployBundle } from "@/lib/launch/deploy-plan";
import type { DeploymentReadyPlan } from "@/lib/launch/approve";
import campaignVaultArtifact from "../../contracts/out/CampaignVault.sol/CampaignVault.json";

const RUN = process.env.METIS_FORK === "1";
const RPC = process.env.METIS_FORK_RPC ?? "https://andromeda.metis.io/?owner=1088";
const PORT = 8547;
const LOCAL = `http://127.0.0.1:${PORT}`;

const FACTORY = getAddress("0xdD9a45c181dD95e48CDdC0149C8b821D604C45C9");
const TOKEN = getAddress("0xEA32A96608495e54156Ae48931A7c20f0dcc1a21"); // m.USDC
const OPERATOR = getAddress("0x0deF3D4124D0cD1708aEFFE6c1BC8182342a44D6");
const ACCOUNT = getAddress(process.env.METIS_FORK_ACCOUNT ?? "0xf280D83968419F944360d836A9f6A9cB7bA22ce9");
const GUARDIAN = getAddress(process.env.METIS_FORK_GUARDIAN ?? "0xDF70f6E8e656E5bb714fF0E8CA176d76F26890e3");
const BUDGET = BigInt(process.env.METIS_FORK_BUDGET_BASE ?? "3000000");

const erc20 = parseAbi(["function balanceOf(address) view returns (uint256)"]);
const vaultAbi = campaignVaultArtifact.abi as unknown as Abi; // the same build artifact deploy-plan.ts reads
const bump = (n: bigint): bigint => (n * BigInt(12)) / BigInt(10);

const metis = { id: 1088, name: "Metis Andromeda (fork)", nativeCurrency: { name: "Metis", symbol: "METIS", decimals: 18 }, rpcUrls: { default: { http: [LOCAL] } } } as const;

describe.skipIf(!RUN)("Metis launch, rehearsed on a fork", () => {
  let anvil: ChildProcess | null = null;
  const real = createPublicClient({ transport: http(RPC) });
  const pub = createPublicClient({ chain: metis, transport: http(LOCAL) });
  const test = createTestClient({ chain: metis, mode: "anvil", transport: http(LOCAL) });
  const wallet = createWalletClient({ chain: metis, transport: http(LOCAL) });
  let gasPrice = BigInt(0);
  const spent: { step: string; gas: bigint; wei: bigint }[] = [];

  beforeAll(async () => {
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

  /** Send one call the way the Privy executor does on Metis: estimate, +20% gas, type 0 at the network's price +20%. */
  async function send(step: string, from: Address, to: Address, data: Hex): Promise<Hex> {
    await test.impersonateAccount({ address: from });
    const gas = await pub.estimateGas({ account: from, to, data });
    const hash = await wallet.sendTransaction({ account: from, to, data, gas: bump(gas), gasPrice: bump(gasPrice), type: "legacy", chain: metis });
    const receipt = await pub.waitForTransactionReceipt({ hash });
    expect(receipt.status, `${step} reverted`).toBe("success");
    spent.push({ step, gas: receipt.gasUsed, wei: receipt.gasUsed * bump(gasPrice) });
    await test.stopImpersonatingAccount({ address: from });
    return hash;
  }

  it("launches from the account's own balances and pays the mission once", async () => {
    const [usdcBefore, metisBefore, opMetis] = await Promise.all([
      pub.readContract({ address: TOKEN, abi: erc20, functionName: "balanceOf", args: [ACCOUNT] }),
      pub.getBalance({ address: ACCOUNT }),
      pub.getBalance({ address: OPERATOR }),
    ]);
    expect(usdcBefore >= BUDGET, `the account holds ${usdcBefore} base units, the job needs ${BUDGET}`).toBe(true);

    const stamp = Date.now().toString();
    const missionId = keccak256(toHex(`rehearsal-mission-${stamp}`));
    // the plan fields buildDeployBundle reads; the rest of a real plan never reaches the chain
    const plan = {
      campaignIdHash: keccak256(toHex(`rehearsal-${stamp}`)),
      totalBudgetBase: BUDGET.toString(),
      missions: [{ missionIdHash: missionId, rewardBase: BUDGET.toString(), maxCompletions: 1 }],
    } as unknown as DeploymentReadyPlan;
    const bundle = buildDeployBundle(plan, {
      chainId: 1088,
      factory: FACTORY,
      owner: ACCOUNT,
      operator: OPERATOR,
      guardian: GUARDIAN,
      token: TOKEN,
      dailyVelocityCap: BUDGET, // defaultDailyCap: the whole budget
      durationSeconds: BigInt(14 * 24 * 60 * 60), // DEFAULT_DURATION_SECONDS
    });
    for (const c of bundle.calls) await send(c.step, ACCOUNT, c.to, c.data);

    const vault = bundle.predictedVault;
    const [state, vaultUsdc] = await Promise.all([
      pub.readContract({ address: vault, abi: vaultAbi, functionName: "getState" }),
      pub.readContract({ address: TOKEN, abi: erc20, functionName: "balanceOf", args: [vault] }),
    ]);
    expect(Number(state)).toBe(2); // Active
    expect(vaultUsdc).toBe(BUDGET);

    // the operator pays the mission: the vault derives the amount, the operator names none
    const worker = getAddress(keccak256(toHex(`rehearsal-worker-${stamp}`)).slice(0, 42));
    const payout = (recipient: Address, n: string) =>
      encodeFunctionData({
        abi: vaultAbi,
        functionName: "requestPayout",
        args: [missionId, recipient, keccak256(toHex(`decision-${n}-${stamp}`)), keccak256(toHex(`intent-${n}-${stamp}`))],
      });
    const paidTx = await send("payout", OPERATOR, vault, payout(worker, "1"));
    const paidLogs = (await pub.getTransactionReceipt({ hash: paidTx })).logs.filter((l) => getAddress(l.address) === vault);
    const settled = paidLogs.map((l) => decodeEventLog({ abi: vaultAbi, data: l.data, topics: l.topics, strict: false })).find((e) => e.eventName === "PayoutSettled");
    expect(settled, "no PayoutSettled event").toBeTruthy();
    expect(await pub.readContract({ address: TOKEN, abi: erc20, functionName: "balanceOf", args: [worker] })).toBe(BUDGET);

    // the control: a second person on a one-place job is refused, on chain, with the reason
    const other = getAddress(keccak256(toHex(`rehearsal-other-${stamp}`)).slice(0, 42));
    const refusedTx = await send("refused payout (control)", OPERATOR, vault, payout(other, "2"));
    const refused = (await pub.getTransactionReceipt({ hash: refusedTx })).logs
      .filter((l) => getAddress(l.address) === vault)
      .map((l) => decodeEventLog({ abi: vaultAbi, data: l.data, topics: l.topics, strict: false }))
      .find((e) => e.eventName === "PayoutRejected");
    expect(refused, "the second payout was not refused").toBeTruthy();
    expect(Number((refused!.args as unknown as { failedCheckIndex: number }).failedCheckIndex)).toBe(7); // no completions left
    expect(await pub.readContract({ address: TOKEN, abi: erc20, functionName: "balanceOf", args: [other] })).toBe(BigInt(0));

    const launchWei = spent.filter((s) => ["create", "approve", "fund", "activate"].includes(s.step)).reduce((a, s) => a + s.wei, BigInt(0));
    const payoutWei = spent.find((s) => s.step === "payout")!.wei;
    console.log(
      [
        `gas price on Metis now: ${Number(gasPrice) / 1e9} gwei (sent at +20%)`,
        ...spent.map((s) => `  ${s.step.padEnd(26)} ${s.gas.toString().padStart(9)} gas  ${formatEther(s.wei)} METIS`),
        `launch: ${formatEther(launchWei)} METIS of the account's ${formatEther(metisBefore)}`,
        `payout: ${formatEther(payoutWei)} METIS of the operator's ${formatEther(opMetis)} (about ${opMetis / payoutWei} payouts)`,
        `vault ${vault} (on the fork only)`,
      ].join("\n"),
    );
    expect(metisBefore > launchWei).toBe(true);
    expect(opMetis > payoutWei).toBe(true);
  }, 180_000);
});

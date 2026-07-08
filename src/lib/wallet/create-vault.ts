import {
  createPublicClient,
  getAddress,
  http,
  parseEventLogs,
  parseUnits,
  zeroAddress,
  type Address,
  type Hash,
  type WalletClient,
} from "viem";
import { metisSepolia } from "./config";
import { factoryAbi, mockUsdcAbi, policyVaultAbi } from "./abis";

const publicClient = createPublicClient({
  chain: metisSepolia,
  transport: http(),
});

const USDC = (process.env.NEXT_PUBLIC_USDC_ADDRESS ?? "") as Address;
const FACTORY = (process.env.NEXT_PUBLIC_FACTORY_ADDRESS ?? "") as Address;
const OPERATOR = (process.env.NEXT_PUBLIC_OPERATOR_ADDRESS ?? "") as Address;
const USDC_DECIMALS = 6;
const DURATION_SECONDS = BigInt(14 * 24 * 60 * 60); // 14-day term

/**
 * New vaults start with an EMPTY allowlist — recipients now arrive through
 * campaigns, and the poster (vault owner) approves each one via the timelocked
 * add. A short timelock keeps additions deliberate without stalling a payout.
 */
const VENDOR_TIMELOCK_SECONDS = BigInt(10 * 60); // 10 minutes

export type CreateStep = "mint" | "create" | "approve" | "fund" | "activate" | "done";

export interface CreateVaultResult {
  vault: Address;
  createTx: Hash;
}

/**
 * The real founder-signed vault creation. Every step is a transaction the
 * founder's wallet signs, on Metis Sepolia: mint free test USDC (public mint) →
 * `factory.createVault` (operator = our AI key, so the Deputy can spend within
 * policy) → approve → fund → activate. Returns the deterministic vault address
 * read from the `VaultCreated` event. `onStep` drives the UI progress.
 */
export async function createDeputyVault(opts: {
  wallet: WalletClient;
  founder: Address;
  budget: number;
  perPayout: number;
  velocity: number;
  onStep?: (step: CreateStep, txHash?: Hash) => void;
}): Promise<CreateVaultResult> {
  const { wallet, founder, budget, perPayout, velocity, onStep } = opts;

  if (!USDC || !FACTORY || !OPERATOR) {
    throw new Error(
      "Missing NEXT_PUBLIC_USDC_ADDRESS / _FACTORY_ADDRESS / _OPERATOR_ADDRESS.",
    );
  }

  const budgetWei = parseUnits(String(budget), USDC_DECIMALS);
  const perWei = parseUnits(String(perPayout), USDC_DECIMALS);
  const velWei = parseUnits(String(velocity), USDC_DECIMALS);

  const sign = async (
    params: Parameters<WalletClient["writeContract"]>[0],
  ): Promise<Hash> => {
    const hash = await wallet.writeContract(params);
    await publicClient.waitForTransactionReceipt({ hash });
    return hash;
  };

  // 1 · mint free test USDC to cover the budget (public mint on MockUSDC)
  const balance = (await publicClient.readContract({
    address: USDC,
    abi: mockUsdcAbi,
    functionName: "balanceOf",
    args: [founder],
  })) as bigint;
  if (balance < budgetWei) {
    onStep?.("mint");
    const mintTx = await sign({
      address: USDC,
      abi: mockUsdcAbi,
      functionName: "mint",
      args: [founder, budgetWei - balance],
      account: founder,
      chain: metisSepolia,
    });
    onStep?.("mint", mintTx);
  }

  // 2 · create the vault (founder = owner, our key = operator)
  onStep?.("create");
  const createTx = await sign({
    address: FACTORY,
    abi: factoryAbi,
    functionName: "createVault",
    args: [
      OPERATOR,
      zeroAddress,
      USDC,
      budgetWei,
      perWei,
      velWei,
      DURATION_SECONDS,
      [], // empty allowlist — recipients arrive via campaigns (owner-approved)
      VENDOR_TIMELOCK_SECONDS,
    ],
    account: founder,
    chain: metisSepolia,
  });
  const receipt = await publicClient.getTransactionReceipt({ hash: createTx });
  const events = parseEventLogs({
    abi: factoryAbi,
    logs: receipt.logs,
    eventName: "VaultCreated",
  });
  const created = events[0]?.args as { vault?: Address } | undefined;
  if (!created?.vault) throw new Error("Vault created but address not found in logs.");
  const vault = getAddress(created.vault);
  onStep?.("create", createTx);

  // 3 · approve the vault to pull the budget
  onStep?.("approve");
  const approveTx = await sign({
    address: USDC,
    abi: mockUsdcAbi,
    functionName: "approve",
    args: [vault, budgetWei],
    account: founder,
    chain: metisSepolia,
  });
  onStep?.("approve", approveTx);

  // 4 · fund (Created → Funded)
  onStep?.("fund");
  const fundTx = await sign({
    address: vault,
    abi: policyVaultAbi,
    functionName: "fund",
    args: [budgetWei],
    account: founder,
    chain: metisSepolia,
  });
  onStep?.("fund", fundTx);

  // 5 · activate (Funded → Active) — the Deputy can now spend within policy
  onStep?.("activate");
  const activateTx = await sign({
    address: vault,
    abi: policyVaultAbi,
    functionName: "activate",
    args: [],
    account: founder,
    chain: metisSepolia,
  });
  onStep?.("activate", activateTx);

  onStep?.("done");
  return { vault, createTx };
}

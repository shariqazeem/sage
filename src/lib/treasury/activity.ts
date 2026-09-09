import "server-only";
import { erc20Abi, getAddress, parseAbiItem, type Address } from "viem";
import { publicClient } from "@/lib/deputy/chain";
import { chainConfig } from "@/lib/deputy/networks";

/**
 * What moved through an account, read from the chain itself: every USDC transfer in or out of the
 * treasury address. No table of our own — the chain is the record, the account page just reads it.
 */
export interface TreasuryMove {
  direction: "in" | "out";
  amountBase: number;
  counterparty: Address;
  txHash: `0x${string}`;
  blockNumber: number;
}

const TRANSFER = parseAbiItem("event Transfer(address indexed from, address indexed to, uint256 value)");

/** Arc testnet mints about four blocks a second; a treasury created at `createdAtSec` cannot have moved before that. */
function blocksSince(createdAtSec: number, latest: bigint, perSecond = 4): bigint {
  const ageSec = Math.max(0, Math.floor(Date.now() / 1000) - createdAtSec);
  const span = BigInt(Math.ceil(ageSec * perSecond * 1.2) + 20_000);
  return latest > span ? latest - span : BigInt(0);
}

export async function treasuryActivity(address: string, chainId: number, createdAtSec: number, limit = 30): Promise<TreasuryMove[]> {
  const usdc = chainConfig(chainId).usdcAddress;
  if (!usdc) return [];
  const client = publicClient(chainId);
  const me = getAddress(address);
  try {
    const latest = await client.getBlockNumber();
    const fromBlock = blocksSince(createdAtSec, latest);
    const [ins, outs] = await Promise.all([
      client.getLogs({ address: usdc, event: TRANSFER, args: { to: me }, fromBlock, toBlock: latest }),
      client.getLogs({ address: usdc, event: TRANSFER, args: { from: me }, fromBlock, toBlock: latest }),
    ]);
    const moves: TreasuryMove[] = [
      ...ins.map((l) => ({ direction: "in" as const, amountBase: Number(l.args.value ?? BigInt(0)), counterparty: getAddress(l.args.from as Address), txHash: l.transactionHash, blockNumber: Number(l.blockNumber) })),
      ...outs.map((l) => ({ direction: "out" as const, amountBase: Number(l.args.value ?? BigInt(0)), counterparty: getAddress(l.args.to as Address), txHash: l.transactionHash, blockNumber: Number(l.blockNumber) })),
    ];
    return moves.sort((a, b) => b.blockNumber - a.blockNumber).slice(0, limit);
  } catch (e) {
    console.warn("[treasury-activity] could not read the chain:", e instanceof Error ? e.message : e);
    return [];
  }
}

/** The account's USDC balance, straight from the token. */
export async function accountBalanceBase(address: string, chainId: number): Promise<bigint> {
  const usdc = chainConfig(chainId).usdcAddress;
  if (!usdc) return BigInt(0);
  return publicClient(chainId).readContract({ address: usdc, abi: erc20Abi, functionName: "balanceOf", args: [getAddress(address)] });
}

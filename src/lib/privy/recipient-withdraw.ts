import "server-only";

import {
  encodeAbiParameters,
  getAddress,
  hexToNumber,
  keccak256,
  slice,
  stringToHex,
  type Abi,
  type Address,
  type Hash,
  type Hex,
} from "viem";

import { publicClient } from "@/lib/deputy/chain";
import { GOAT_USDC } from "@/lib/deputy/networks";
import { sendVaultWrite } from "@/lib/deputy/signer";
import type { RecipientWallet } from "@/lib/db/schema";
import { signTypedDataViaPrivy } from "./client";

/**
 * WALLETLESS RECIPIENT WITHDRAWAL — the honest gap closed.
 *
 * A recipient earns USDC into a chat-bound wallet that holds NO native gas, so they could receive
 * money and never move it. "We pay you but you cannot cash out" is not a payment rail.
 *
 * The fix uses the token itself rather than a gas subsidy: GOAT's USDC is a Circle-style
 * FiatTokenV2 (`version()` = "2") that implements EIP-3009, so the recipient signs a
 * `TransferWithAuthorization` — a signature, not a transaction, costing them nothing and needing no
 * gas — and Sage's operator submits it and pays the gas (a fraction of a cent). The signature is
 * the money: it pins from, to, value, and a single-use nonce, so the operator submitting it cannot
 * alter the amount, redirect it, or replay it.
 *
 * FAIL-CLOSED DOMAIN CHECK: before anything is signed, the EIP-712 domain we are about to sign
 * under is recomputed from the token's OWN `name()`/`version()` and compared byte-for-byte with the
 * contract's `DOMAIN_SEPARATOR()`. A mismatch (wrong chain, wrong token, an upgraded contract)
 * throws BEFORE a signature exists, instead of producing one the chain would reject at withdrawal
 * time with the recipient's real balance on the line.
 *
 * This is also the exact primitive OKX's rail uses (X Layer + USD₮0 + EIP-3009), so the same code
 * path carries over.
 */

const EIP712_DOMAIN_TYPEHASH = keccak256(
  stringToHex("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
);

/** Minimal FiatTokenV2 surface: the metadata we verify with, and the authorization we submit. */
const TOKEN_ABI = [
  { type: "function", name: "name", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
  { type: "function", name: "version", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
  { type: "function", name: "DOMAIN_SEPARATOR", stateMutability: "view", inputs: [], outputs: [{ type: "bytes32" }] },
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }] },
  {
    type: "function",
    name: "transferWithAuthorization",
    stateMutability: "nonpayable",
    inputs: [
      { name: "from", type: "address" },
      { name: "to", type: "address" },
      { name: "value", type: "uint256" },
      { name: "validAfter", type: "uint256" },
      { name: "validBefore", type: "uint256" },
      { name: "nonce", type: "bytes32" },
      { name: "v", type: "uint8" },
      { name: "r", type: "bytes32" },
      { name: "s", type: "bytes32" },
    ],
    outputs: [],
  },
] as const satisfies Abi;

export const TRANSFER_WITH_AUTHORIZATION_TYPE = [
  { name: "from", type: "address" },
  { name: "to", type: "address" },
  { name: "value", type: "uint256" },
  { name: "validAfter", type: "uint256" },
  { name: "validBefore", type: "uint256" },
  { name: "nonce", type: "bytes32" },
];

/** How long a signed authorization stays valid. Short: it is submitted immediately. */
export const VALID_FOR_SECONDS = 900;

export interface RecipientWithdrawDeps {
  signTypedData?: typeof signTypedDataViaPrivy;
  submit?: typeof sendVaultWrite;
  readToken?: (chainId: number, token: Address) => Promise<{ name: string; version: string; domainSeparator: Hex; balance: bigint }>;
  randomNonce?: () => Hex;
  now?: () => number;
}

export async function readTokenState(
  chainId: number,
  token: Address,
  holder: Address,
): Promise<{ name: string; version: string; domainSeparator: Hex; balance: bigint }> {
  const client = publicClient(chainId);
  const abi = TOKEN_ABI as unknown as Abi;
  const [name, version, domainSeparator, balance] = await Promise.all([
    client.readContract({ address: token, abi, functionName: "name" }) as Promise<string>,
    client.readContract({ address: token, abi, functionName: "version" }) as Promise<string>,
    client.readContract({ address: token, abi, functionName: "DOMAIN_SEPARATOR" }) as Promise<Hex>,
    client.readContract({ address: token, abi, functionName: "balanceOf", args: [holder] }) as Promise<bigint>,
  ]);
  return { name, version, domainSeparator, balance };
}

/** The domain separator the token itself would compute for this name/version/chain/address. */
export function computeDomainSeparator(name: string, version: string, chainId: number, token: Address): Hex {
  return keccak256(
    encodeAbiParameters(
      [{ type: "bytes32" }, { type: "bytes32" }, { type: "bytes32" }, { type: "uint256" }, { type: "address" }],
      [EIP712_DOMAIN_TYPEHASH, keccak256(stringToHex(name)), keccak256(stringToHex(version)), BigInt(chainId), token],
    ),
  );
}

/** Split a 65-byte signature, normalising v to 27/28 (Privy may return 0/1). */
export function splitSignature(sig: Hex): { v: number; r: Hex; s: Hex } {
  const r = slice(sig, 0, 32);
  const s = slice(sig, 32, 64);
  const raw = hexToNumber(slice(sig, 64, 65));
  return { v: raw < 27 ? raw + 27 : raw, r, s };
}

export interface RecipientWithdrawResult {
  txHash: Hash;
  amountBase: bigint;
  to: Address;
}

/**
 * Move `amountBase` USDC out of a recipient's chat-bound wallet to an address they chose. The
 * recipient signs; the operator pays the gas. Throws (never partially applies) on: an insufficient
 * balance, a domain mismatch, a refused signature, or a failed submission.
 */
export async function withdrawRecipientEarnings(
  wallet: RecipientWallet,
  to: Address,
  amountBase: bigint,
  chainId = 2345,
  deps: RecipientWithdrawDeps = {},
): Promise<RecipientWithdrawResult> {
  if (amountBase <= BigInt(0)) throw new Error("withdrawal amount must be positive");
  const token = getAddress(GOAT_USDC);
  const from = getAddress(wallet.address);
  const target = getAddress(to);
  if (target.toLowerCase() === from.toLowerCase()) throw new Error("that is the same wallet the money is already in");

  const state = await (deps.readToken ?? readTokenState)(chainId, token, from);
  if (state.balance < amountBase) {
    throw new Error(`balance is ${state.balance} base units, less than the ${amountBase} requested`);
  }

  // FAIL CLOSED before any signature exists.
  const expected = computeDomainSeparator(state.name, state.version, chainId, token);
  if (expected.toLowerCase() !== state.domainSeparator.toLowerCase()) {
    throw new Error("token EIP-712 domain does not match the contract — refusing to sign a withdrawal");
  }

  const now = Math.floor((deps.now?.() ?? Date.now()) / 1000);
  const nonce =
    deps.randomNonce?.() ??
    (`0x${Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) => b.toString(16).padStart(2, "0")).join("")}` as Hex);

  const message = {
    from,
    to: target,
    value: amountBase.toString(),
    validAfter: "0",
    validBefore: String(now + VALID_FOR_SECONDS),
    nonce,
  };

  const signature = await (deps.signTypedData ?? signTypedDataViaPrivy)(wallet.privyWalletId, {
    // Privy requires EIP712Domain in `types` (learned building the recipient evidence claim).
    types: {
      EIP712Domain: [
        { name: "name", type: "string" },
        { name: "version", type: "string" },
        { name: "chainId", type: "uint256" },
        { name: "verifyingContract", type: "address" },
      ],
      TransferWithAuthorization: TRANSFER_WITH_AUTHORIZATION_TYPE,
    },
    domain: { name: state.name, version: state.version, chainId, verifyingContract: token },
    primary_type: "TransferWithAuthorization",
    message,
  });

  const { v, r, s } = splitSignature(signature);
  const txHash = await (deps.submit ?? sendVaultWrite)(chainId, {
    address: token,
    abi: TOKEN_ABI as unknown as Abi,
    functionName: "transferWithAuthorization",
    args: [from, target, amountBase, BigInt(0), BigInt(now + VALID_FOR_SECONDS), nonce, v, r, s],
  });

  return { txHash, amountBase, to: target };
}

/**
 * THE SAME AUTHORIZATION, SIGNED IN A BROWSER. A worker who signed in by email holds a Privy
 * embedded wallet whose key lives client-side, and a worker with a browser wallet holds their own —
 * neither can be asked to sign through Privy's server API. They sign this exact typed data
 * themselves; the operator verifies the signature against `from` and submits it, paying the gas.
 * Nothing about the money changes: the signature still pins from, to, value and a single-use nonce.
 */
export function transferAuthorizationTypedData(input: {
  chainId: number;
  token: Address;
  tokenName: string;
  tokenVersion: string;
  from: Address;
  to: Address;
  amountBase: bigint;
  validBefore: number;
  nonce: Hex;
}) {
  return {
    domain: { name: input.tokenName, version: input.tokenVersion, chainId: input.chainId, verifyingContract: input.token },
    types: { TransferWithAuthorization: TRANSFER_WITH_AUTHORIZATION_TYPE },
    primaryType: "TransferWithAuthorization" as const,
    message: {
      from: input.from,
      to: input.to,
      value: input.amountBase,
      validAfter: BigInt(0),
      validBefore: BigInt(input.validBefore),
      nonce: input.nonce,
    },
  };
}

/** Submit a signed authorization: the operator pays the gas, the signature is the money. */
export async function submitTransferAuthorization(
  chainId: number,
  token: Address,
  a: { from: Address; to: Address; amountBase: bigint; validBefore: number; nonce: Hex; signature: Hex },
  submit: typeof sendVaultWrite = sendVaultWrite,
): Promise<Hash> {
  const { v, r, s } = splitSignature(a.signature);
  return submit(chainId, {
    address: token,
    abi: TOKEN_ABI as unknown as Abi,
    functionName: "transferWithAuthorization",
    args: [a.from, a.to, a.amountBase, BigInt(0), BigInt(a.validBefore), a.nonce, v, r, s],
  });
}

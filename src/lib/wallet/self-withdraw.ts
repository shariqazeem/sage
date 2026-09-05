import "server-only";
import { getAddress, verifyTypedData, type Address, type Hash, type Hex } from "viem";
import { GOAT_USDC } from "@/lib/deputy/networks";
import {
  VALID_FOR_SECONDS,
  computeDomainSeparator,
  readTokenState,
  submitTransferAuthorization,
  transferAuthorizationTypedData,
} from "@/lib/privy/recipient-withdraw";

/**
 * YOUR WALLET, INSIDE SAGE — deposit is the address; withdraw is gasless.
 *
 * A worker paid into an email-embedded wallet (or any wallet signed in here) holds USDC on GOAT and
 * no BTC for gas, so without this they could receive money and never move it — the same gap the
 * Telegram cash-out closed for chat wallets. Two calls: `prepare` reads the token and hands back the
 * exact EIP-3009 typed data to sign; `submit` verifies that the signature is the wallet's own, that
 * the authorization is fresh and within balance, and hands it to the operator, who pays the gas.
 * The server never holds a key; the signature pins from, to, value and a single-use nonce.
 */
export interface PreparedWithdrawal {
  chainId: number;
  token: Address;
  from: Address;
  to: Address;
  amountBase: string;
  validBefore: number;
  nonce: Hex;
  /** what the wallet signs — viem/Privy shape */
  typedData: ReturnType<typeof transferAuthorizationTypedData>;
  balanceBase: string;
}

export interface SelfWithdrawDeps {
  readToken?: typeof readTokenState;
  submit?: Parameters<typeof submitTransferAuthorization>[3];
  now?: () => number;
  randomNonce?: () => Hex;
}

const randomNonce = (): Hex =>
  `0x${Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) => b.toString(16).padStart(2, "0")).join("")}` as Hex;

function checkShape(from: Address, to: Address, amountBase: bigint) {
  if (amountBase <= BigInt(0)) throw new Error("the amount must be positive");
  if (to.toLowerCase() === from.toLowerCase()) throw new Error("that is the same wallet the money is already in");
}

export async function prepareSelfWithdrawal(
  input: { chainId?: number; from: string; to: string; amountBase: bigint },
  deps: SelfWithdrawDeps = {},
): Promise<PreparedWithdrawal> {
  const chainId = input.chainId ?? 2345;
  const token = getAddress(GOAT_USDC);
  const from = getAddress(input.from);
  const to = getAddress(input.to);
  checkShape(from, to, input.amountBase);
  const state = await (deps.readToken ?? readTokenState)(chainId, token, from);
  if (state.balance < input.amountBase) throw new Error(`the balance is ${Number(state.balance) / 1e6} USDC, less than the ${Number(input.amountBase) / 1e6} asked`);
  // FAIL CLOSED before any signature exists: the domain we hand out must be the token's own.
  const expected = computeDomainSeparator(state.name, state.version, chainId, token);
  if (expected.toLowerCase() !== state.domainSeparator.toLowerCase()) throw new Error("token EIP-712 domain does not match the contract — refusing to prepare a withdrawal");
  const now = Math.floor((deps.now?.() ?? Date.now()) / 1000);
  const validBefore = now + VALID_FOR_SECONDS;
  const nonce = (deps.randomNonce ?? randomNonce)();
  return {
    chainId,
    token,
    from,
    to,
    amountBase: input.amountBase.toString(),
    validBefore,
    nonce,
    typedData: transferAuthorizationTypedData({ chainId, token, tokenName: state.name, tokenVersion: state.version, from, to, amountBase: input.amountBase, validBefore, nonce }),
    balanceBase: state.balance.toString(),
  };
}

/** One withdrawal at a time per wallet, and not more often than once a minute — the operator's gas is the only thing an attacker could spend here. */
const lastSubmit = new Map<string, number>();

export async function submitSelfWithdrawal(
  input: { chainId?: number; from: string; to: string; amountBase: bigint; validBefore: number; nonce: Hex; signature: Hex },
  deps: SelfWithdrawDeps = {},
): Promise<{ txHash: Hash; amountBase: bigint; to: Address }> {
  const chainId = input.chainId ?? 2345;
  const token = getAddress(GOAT_USDC);
  const from = getAddress(input.from);
  const to = getAddress(input.to);
  checkShape(from, to, input.amountBase);
  const now = Math.floor((deps.now?.() ?? Date.now()) / 1000);
  if (!(input.validBefore > now)) throw new Error("this authorization has expired — prepare a fresh one");
  if (input.validBefore > now + VALID_FOR_SECONDS + 60) throw new Error("this authorization is valid for too long — prepare a fresh one");
  if (!/^0x[0-9a-fA-F]{64}$/.test(input.nonce)) throw new Error("malformed nonce");
  const key = from.toLowerCase();
  const last = lastSubmit.get(key) ?? 0;
  if (now - last < 60) throw new Error("one withdrawal a minute — try again shortly");

  const state = await (deps.readToken ?? readTokenState)(chainId, token, from);
  if (state.balance < input.amountBase) throw new Error(`the balance is ${Number(state.balance) / 1e6} USDC, less than the ${Number(input.amountBase) / 1e6} asked`);
  const typed = transferAuthorizationTypedData({ chainId, token, tokenName: state.name, tokenVersion: state.version, from, to, amountBase: input.amountBase, validBefore: input.validBefore, nonce: input.nonce });
  // THE SIGNATURE MUST BE THE WALLET'S OWN. Anything else is someone spending the operator's gas on a
  // transaction the token would refuse anyway — refuse it here, before it costs anything.
  const ok = await verifyTypedData({ address: from, domain: typed.domain, types: typed.types, primaryType: typed.primaryType, message: typed.message, signature: input.signature });
  if (!ok) throw new Error("that signature is not this wallet's — sign from the wallet you are signed in with");
  lastSubmit.set(key, now);
  const txHash = await submitTransferAuthorization(chainId, token, { from, to, amountBase: input.amountBase, validBefore: input.validBefore, nonce: input.nonce, signature: input.signature }, deps.submit);
  return { txHash, amountBase: input.amountBase, to };
}

/** Test seam. */
export function __clearWithdrawCooldowns(): void {
  lastSubmit.clear();
}

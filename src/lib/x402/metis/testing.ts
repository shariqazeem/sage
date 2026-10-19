import { getAddress, type Address, type Hex, type LocalAccount } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  M_USDC,
  METIS_CHAIN_ID,
  METIS_NETWORK,
  PERMIT2_ADDRESS,
  PERMIT2_WITNESS_TYPES,
  PROXY_BUILDS,
} from "./constants";
import type { FacilitatorRequestWire } from "./types";

/**
 * TEST FIXTURES (imported by the *.test.ts files only): a real Permit2 witness payment, signed by a
 * viem local account exactly as an x402 client signs it (reference shared/permit2.ts
 * createPermit2PayloadForProxy), with every field overridable so each test bends one thing.
 */

export const PAYER_KEY: Hex = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";
export const OTHER_KEY: Hex = "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a";
export const FACILITATOR_KEY: Hex = "0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6";
export const PAY_TO: Address = getAddress("0x209693bc6afc0c5328ba36faf03c514ef312287c");
export const NOW = 1_792_400_000;

export interface PaymentOptions {
  amount?: bigint;
  requirementAmount?: bigint;
  asset?: Address;
  token?: Address;
  payTo?: Address;
  witnessTo?: Address;
  spender?: Address;
  nonce?: bigint;
  deadline?: bigint;
  validAfter?: bigint;
  network?: string;
  acceptedNetwork?: string;
  /** The chain id in the EIP-712 domain the payer signs over. */
  signedChainId?: number;
  /** Who signs, when it should not be the payer. */
  signer?: LocalAccount;
  assetTransferMethod?: string | null;
}

export async function signedPayment(
  opts: PaymentOptions = {},
): Promise<{ body: FacilitatorRequestWire; payer: LocalAccount }> {
  const payer = privateKeyToAccount(PAYER_KEY);
  const asset = opts.asset ?? M_USDC.address;
  const requirementAmount = opts.requirementAmount ?? BigInt(10_000);
  const amount = opts.amount ?? requirementAmount;
  const token = opts.token ?? asset;
  const payTo = opts.payTo ?? PAY_TO;
  const witnessTo = opts.witnessTo ?? payTo;
  const spender = opts.spender ?? PROXY_BUILDS.paris.address;
  const nonce = opts.nonce ?? BigInt("33247007178036348590600198031289925668252061821958005840077069883511451257277");
  const deadline = opts.deadline ?? BigInt(NOW + 300);
  const validAfter = opts.validAfter ?? BigInt(0);
  const network = opts.network ?? METIS_NETWORK;

  const signature = await (opts.signer ?? payer).signTypedData({
    domain: { name: "Permit2", chainId: opts.signedChainId ?? METIS_CHAIN_ID, verifyingContract: PERMIT2_ADDRESS },
    types: PERMIT2_WITNESS_TYPES,
    primaryType: "PermitWitnessTransferFrom",
    message: {
      permitted: { token, amount },
      spender,
      nonce,
      deadline,
      witness: { to: witnessTo, validAfter },
    },
  });

  const method = opts.assetTransferMethod === undefined ? "permit2" : opts.assetTransferMethod;
  const extra = method === null ? undefined : { assetTransferMethod: method };
  const requirements = {
    scheme: "exact",
    network,
    amount: requirementAmount.toString(),
    asset,
    payTo,
    maxTimeoutSeconds: 300,
    ...(extra ? { extra } : {}),
  };
  const body: FacilitatorRequestWire = {
    x402Version: 2,
    paymentPayload: {
      x402Version: 2,
      resource: { url: "https://called.example/api/oracle", description: "one call", mimeType: "application/json" },
      accepted: { ...requirements, network: opts.acceptedNetwork ?? network },
      payload: {
        signature,
        permit2Authorization: {
          from: payer.address,
          permitted: { token, amount: amount.toString() },
          spender,
          nonce: nonce.toString(),
          deadline: deadline.toString(),
          witness: { to: witnessTo, validAfter: validAfter.toString() },
        },
      },
    },
    paymentRequirements: requirements,
  };
  return { body, payer };
}

/** A deep copy with one edit, for tests that tamper with a signed body after the fact. */
export function edited(body: FacilitatorRequestWire, edit: (b: FacilitatorRequestWire) => void): FacilitatorRequestWire {
  const copy = JSON.parse(JSON.stringify(body)) as FacilitatorRequestWire;
  edit(copy);
  return copy;
}

import { getAddress, parseAbi, type Address, type Hex } from "viem";

/**
 * x402 ON METIS ANDROMEDA: the constants every other file in this folder reads.
 *
 * Pure (no `server-only`, no I/O), so the tests and the deploy script's drift check can read it.
 *
 * THE SPEC THIS FOLLOWS. github.com/coinbase/x402 at commit 0e6e8c55d86b4f14234fb6e49a4052074fb93e57
 * (15 Oct 2026; coinbase/x402 is now a fork that syncs x402-foundation/x402):
 *   - specs/x402-specification-v2.md: the types (§5), the facilitator API (§7: /verify, /settle,
 *     /supported) and the error codes (§9);
 *   - specs/schemes/exact/scheme_exact.md and scheme_exact_evm.md §2: the `exact` scheme,
 *     AssetTransferMethod `permit2`;
 *   - specs/transports-v2/http.md;
 *   - contracts/evm/src/x402ExactPermit2Proxy.sol and x402BasePermit2Proxy.sol: the proxy;
 *   - typescript/packages/mechanisms/evm/src/exact/facilitator/permit2.ts, errors.ts and
 *     constants.ts: the reference facilitator. Its reason strings are reused verbatim below, so a
 *     resource server built on the reference SDK reads the same codes from this facilitator.
 *
 * WHY PERMIT2 AND NOT EIP-3009. m.USDC and m.USDT on Andromeda are plain `L2StandardERC20`s: no
 * `transferWithAuthorization` and no EIP-2612 `permit` (measured 19 Oct 2026: `authorizationState`,
 * `DOMAIN_SEPARATOR` and `nonces` all revert, and the dispatchers hold neither selector). Permit2 is
 * the spec's "universal fallback", and the canonical Permit2 is live on 1088 with a domain separator
 * built for 1088.
 *
 * WHY THE PROXY ON METIS IS NOT THE CANONICAL ONE (measured 19 Oct 2026, read-only eth_call against
 * three public RPCs). Andromeda executes PUSH0 but NOT MCOPY (EIP-5656), TSTORE/TLOAD (EIP-1153) or
 * BASEFEE. The canonical x402ExactPermit2Proxy (0x402085…0001) is solc 0.8.28 built for Cancun, and
 * its ABI encoder copies the witness type string with MCOPY on every settle. Deployed on Metis it
 * would answer PERMIT2() and WITNESS_TYPEHASH() correctly, and revert, with no data, on
 * WITNESS_TYPE_STRING() and on every settle(): a contract that looks deployed and can never pay.
 * Simulated with state overrides, a correctly signed payment reverts through the canonical build and
 * settles through the `paris` build below.
 *
 * The `paris` build is the same audited source (x402 @ 0e6e8c55, OpenZeppelin @ fcbae539 = v5.5.0),
 * the same solc 0.8.28, optimizer 200 runs, via_ir off, cbor_metadata off, bytecode_hash none, with
 * ONE change: evm_version = "paris". The same recipe with evm_version = "cancun" reproduces the
 * canonical runtime byte for byte (less its CBOR metadata tail), so the paris bytecode differs from
 * the audited deployment only in the opcodes the compiler may use. It deploys through the same
 * CREATE2 deployer with the same salt, so its address is as deterministic as the canonical one.
 */

/** Metis Andromeda. */
export const METIS_CHAIN_ID = 1088;
/** The CAIP-2 identifier x402 v2 uses for it (spec §11.1). */
export const METIS_NETWORK = "eip155:1088" as const;
export const METIS_DEFAULT_RPC = "https://andromeda.metis.io/?owner=1088";
export const METIS_EXPLORER = "https://andromeda-explorer.metis.io";

/** Uniswap's canonical Permit2. Live on 1088 (9152 bytes of code, measured 19 Oct 2026). */
export const PERMIT2_ADDRESS: Address = getAddress("0x000000000022D473030F116dDEE9F6B43aC78BA3");
/**
 * Permit2's DOMAIN_SEPARATOR as read from 1088 on 19 Oct 2026, equal to
 * keccak256(abi.encode(keccak256("EIP712Domain(string name,uint256 chainId,address verifyingContract)"),
 * keccak256("Permit2"), 1088, PERMIT2_ADDRESS)). constants.test.ts recomputes it.
 */
export const PERMIT2_DOMAIN_SEPARATOR_1088: Hex =
  "0x55927daba8f95df73da537f4d02fbc6f1e611c904f58e25a7a0cf8395596b6e8";

/** Arachnid's deterministic deployer, the one x402's Deploy.s.sol uses. Present on 1088. */
export const CREATE2_DEPLOYER: Address = getAddress("0x4e59b44847b379578588920cA78FbF26c0B4956C");
/** x402's EXACT_SALT (contracts/evm/script/Deploy.s.sol), reused for the paris build. */
export const PROXY_SALT: Hex = "0x0000000000000000000000000000000000000000000000003000000007263b0e";

export type ProxyBuildName = "canonical" | "paris";

export interface ProxyBuild {
  name: ProxyBuildName;
  /** CREATE2(CREATE2_DEPLOYER, PROXY_SALT, initCodeHash). */
  address: Address;
  /** keccak256 of the initcode (creation code ++ abi.encode(PERMIT2_ADDRESS)). */
  initCodeHash: Hex;
  /** keccak256 of the deployed runtime (immutables filled), the same on every chain. */
  runtimeCodeHash: Hex;
  evmVersion: "cancun" | "paris";
  /** Whether its settle() can execute on Metis Andromeda today. */
  runsOnMetis: boolean;
  /** The vendored initcode the deploy script sends, relative to the repo root. */
  initCodeFile: string;
}

export const PROXY_BUILDS: Readonly<Record<ProxyBuildName, ProxyBuild>> = {
  canonical: {
    name: "canonical",
    address: getAddress("0x402085c248EeA27D92E8b30b2C58ed07f9E20001"),
    initCodeHash: "0xe774d1d5a07218946ab54efe010b300481478b86861bb17d69c98a57f68a604c",
    runtimeCodeHash: "0xce6429c0bb49284660683287c0a8fe548a88379072327d026626909d202048b9",
    evmVersion: "cancun",
    runsOnMetis: false,
    initCodeFile: "contracts/script/data/x402-exact-permit2-proxy.canonical.initcode.hex",
  },
  paris: {
    name: "paris",
    address: getAddress("0xC5Df359394de02F8E04bfb650E250b20a33BEe6a"),
    initCodeHash: "0x8ae99ed2d883dd962ff32f75cacad05f2259012ffb7aaf7c37926321c5fbf6c9",
    runtimeCodeHash: "0x471bf94146d66f9cf16eb685be3342b030a7cdf25938c549a53df2d0ed3f1452",
    evmVersion: "paris",
    runsOnMetis: true,
    initCodeFile: "contracts/script/data/x402-exact-permit2-proxy.paris.initcode.hex",
  },
};

/** The proxy build whose deployed code has this runtime hash, or null for anything else. */
export function proxyBuildByRuntimeHash(hash: string): ProxyBuild | null {
  const h = hash.toLowerCase();
  for (const b of Object.values(PROXY_BUILDS)) if (b.runtimeCodeHash === h) return b;
  return null;
}

export interface MetisToken {
  address: Address;
  symbol: string;
  decimals: number;
}

/** Bridged USDC on Andromeda. symbol() "m.USDC", decimals() 6, read 19 Oct 2026. */
export const M_USDC: MetisToken = {
  address: getAddress("0xEA32A96608495e54156Ae48931A7c20f0dcc1a21"),
  symbol: "m.USDC",
  decimals: 6,
};
/** Bridged USDT on Andromeda. symbol() "m.USDT", decimals() 6, read 19 Oct 2026. Opt-in. */
export const M_USDT: MetisToken = {
  address: getAddress("0xbB06DCA3AE6887fAbF931640f67cab3e3a16F4dC"),
  symbol: "m.USDT",
  decimals: 6,
};

/** x402ExactPermit2Proxy.WITNESS_TYPE_STRING, the stub Permit2 appends to its witness typehash. */
export const WITNESS_TYPE_STRING =
  "Witness witness)TokenPermissions(address token,uint256 amount)Witness(address to,uint256 validAfter)";
/** keccak256("Witness(address to,uint256 validAfter)"), x402ExactPermit2Proxy.WITNESS_TYPEHASH. */
export const WITNESS_TYPEHASH: Hex =
  "0xd97b3239a7f32295517bd14cb074edfdd188dfe5eb42f802bb26d4fd1eb12c37";

/**
 * The EIP-712 types the payer signs (reference constants.ts `permit2WitnessTypes`). Permit2 hashes
 * `PermitWitnessTransferFrom(TokenPermissions permitted,address spender,uint256 nonce,uint256
 * deadline,` ++ WITNESS_TYPE_STRING; constants.test.ts proves viem's encoding of these types is that
 * exact string, so a signature this facilitator accepts is one Permit2 accepts.
 */
export const PERMIT2_WITNESS_TYPES = {
  PermitWitnessTransferFrom: [
    { name: "permitted", type: "TokenPermissions" },
    { name: "spender", type: "address" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint256" },
    { name: "witness", type: "Witness" },
  ],
  TokenPermissions: [
    { name: "token", type: "address" },
    { name: "amount", type: "uint256" },
  ],
  Witness: [
    { name: "to", type: "address" },
    { name: "validAfter", type: "uint256" },
  ],
} as const;

/** Permit2's EIP-712 domain on Metis: no `version` field, by Permit2's own construction. */
export const PERMIT2_DOMAIN = {
  name: "Permit2",
  chainId: METIS_CHAIN_ID,
  verifyingContract: PERMIT2_ADDRESS,
} as const;

/** The x402ExactPermit2Proxy surface this facilitator calls (reference constants.ts, trimmed). */
export const EXACT_PROXY_ABI = [
  {
    type: "function",
    name: "PERMIT2",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "WITNESS_TYPEHASH",
    inputs: [],
    outputs: [{ name: "", type: "bytes32" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "WITNESS_TYPE_STRING",
    inputs: [],
    outputs: [{ name: "", type: "string" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "settle",
    inputs: [
      {
        name: "permit",
        type: "tuple",
        components: [
          {
            name: "permitted",
            type: "tuple",
            components: [
              { name: "token", type: "address" },
              { name: "amount", type: "uint256" },
            ],
          },
          { name: "nonce", type: "uint256" },
          { name: "deadline", type: "uint256" },
        ],
      },
      { name: "owner", type: "address" },
      {
        name: "witness",
        type: "tuple",
        components: [
          { name: "to", type: "address" },
          { name: "validAfter", type: "uint256" },
        ],
      },
      { name: "signature", type: "bytes" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  { type: "event", name: "Settled", inputs: [], anonymous: false },
  { type: "error", name: "InvalidAmount", inputs: [] },
  { type: "error", name: "InvalidDestination", inputs: [] },
  { type: "error", name: "InvalidOwner", inputs: [] },
  { type: "error", name: "PaymentTooEarly", inputs: [] },
  { type: "error", name: "ReentrancyGuardReentrantCall", inputs: [] },
] as const;

/** Permit2 reads plus the errors its SignatureTransfer path can raise (Uniswap/permit2). */
export const PERMIT2_ABI = parseAbi([
  "function nonceBitmap(address owner, uint256 wordPos) view returns (uint256)",
  "function DOMAIN_SEPARATOR() view returns (bytes32)",
  "error SignatureExpired(uint256 signatureDeadline)",
  "error InvalidNonce()",
  "error InvalidAmount(uint256 maxAmount)",
  "error InvalidSigner()",
  "error InvalidSignature()",
  "error InvalidSignatureLength()",
  "error InvalidContractSignature()",
]);

export const ERC20_ABI = parseAbi([
  "function balanceOf(address owner) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "event Transfer(address indexed from, address indexed to, uint256 value)",
]);

/**
 * The reason codes this facilitator answers with. Spec §9 codes where the spec has one; otherwise the
 * reference facilitator's strings (exact/facilitator/errors.ts), character for character.
 */
export const REASON = {
  // x402-specification-v2.md §9
  invalidX402Version: "invalid_x402_version",
  invalidPayload: "invalid_payload",
  invalidPaymentRequirements: "invalid_payment_requirements",
  unsupportedScheme: "unsupported_scheme",
  invalidNetwork: "invalid_network",
  invalidTransactionState: "invalid_transaction_state",
  unexpectedVerifyError: "unexpected_verify_error",
  unexpectedSettleError: "unexpected_settle_error",
  settlementPending: "settlement_pending",
  // reference errors.ts
  networkMismatch: "invalid_exact_evm_network_mismatch",
  eip3009NotSupported: "invalid_exact_evm_eip3009_not_supported",
  transactionFailed: "invalid_exact_evm_transaction_failed",
  transferEventMismatch: "invalid_exact_evm_transfer_event_mismatch",
  permit2InvalidSpender: "invalid_permit2_spender",
  permit2RecipientMismatch: "invalid_permit2_recipient_mismatch",
  permit2DeadlineExpired: "permit2_deadline_expired",
  permit2NotYetValid: "permit2_not_yet_valid",
  permit2AmountMismatch: "permit2_amount_mismatch",
  permit2TokenMismatch: "permit2_token_mismatch",
  permit2InvalidSignature: "invalid_permit2_signature",
  permit2AllowanceRequired: "permit2_allowance_required",
  permit2SimulationFailed: "permit2_simulation_failed",
  permit2InsufficientBalance: "permit2_insufficient_balance",
  permit2ProxyNotDeployed: "permit2_proxy_not_deployed",
  permit2InvalidNonce: "permit2_invalid_nonce",
} as const;

export type ReasonCode = (typeof REASON)[keyof typeof REASON];

/**
 * A payment must still have this many seconds before its Permit2 deadline. 6 at verify is the
 * reference's own margin (permit2.ts: `deadline < now + 6`). Settle asks for more, because the
 * transaction must also be mined before the deadline, and one that is not reverts with
 * SignatureExpired on the facilitator's gas.
 */
export const VERIFY_DEADLINE_MARGIN_SECONDS = 6;
export const SETTLE_DEADLINE_MARGIN_SECONDS = 15;

/**
 * The most gas a settle may be given. Measured 19 Oct 2026 by simulating a real signed settle through
 * the paris proxy on Andromeda (eth_call with state overrides): ~104k gas, ~121k when the payee holds
 * no m.USDC yet. About 0.002 METIS each at ~16 gwei. The cap is twice the worst case.
 */
export const SETTLE_GAS_CAP = 250_000;

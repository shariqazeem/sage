import "server-only";

import {
  encodeFunctionData,
  getAddress,
  keccak256,
  parseEventLogs,
  stringToHex,
  type Abi,
  type Address,
  type Hash,
  type PublicClient,
} from "viem";

import { chainConfig, explorerTxUrl } from "./networks";
import { publicClient as realPublicClient } from "./chain";
import { operatorAddress as realOperatorAddress, sendVaultWrite } from "./signer";
import type { ChainCampaignSnapshot } from "@/lib/campaigns/vault-agreement";

/**
 * The CampaignVault V2 chain adapter — the ONLY place Sage talks to a V2 vault.
 *
 * Everything here goes through the checked-in Foundry ABI (never a hand-written
 * fragment). It reads the full agreement snapshot, proposes a mission payout with
 * the operator key (`requestPayout` — four args, NO amount, NO vendor approval),
 * decodes the vault's own PayoutSettled / PayoutRejected event as the single
 * source of truth, and — crucially — validates that the decoded event came from
 * the EXPECTED vault on the EXPECTED chain before it is ever trusted.
 *
 * The adapter is built through {@link makeCampaignVaultAdapter} so tests can inject
 * a transport (a fake viem client) and a signer (a fake broadcast) and exercise the
 * REAL decode path against the real ABI; production uses the real viem client +
 * the real operator signer, with no mock/demo settlement path.
 */

/* ─────────────────────────────────────────────────────────── the ABI ────── */

// Sourced from the Foundry build artifacts in contracts/out (JSON-imported, then
// normalized to a viem Abi — no `any`, no hand-written fragments). Requires
// `forge build` to have produced them (out/ is gitignored).
import campaignVaultArtifact from "../../../contracts/out/CampaignVault.sol/CampaignVault.json";
import campaignVaultFactoryArtifact from "../../../contracts/out/CampaignVaultFactory.sol/CampaignVaultFactory.json";

export const campaignVaultAbi = campaignVaultArtifact.abi as unknown as Abi;
export const campaignVaultFactoryAbi =
  campaignVaultFactoryArtifact.abi as unknown as Abi;

/** On-chain VaultState enum order (shared with PolicyVault V1). */
const VAULT_STATE = ["created", "funded", "active", "paused", "revoked"] as const;
type VaultLifecycle = (typeof VAULT_STATE)[number];

/** A harmless, deterministic probe used to prove `isIntentUsed` exists (replay-safe). */
const CAPABILITY_PROBE: Hash = keccak256(stringToHex("sage.capability.probe.v1"));

/* ─────────────────────────────────────────── the decoded payout outcome ──── */

/**
 * A V2 payout outcome, decoded from the vault's own event and already validated to
 * have come from the expected vault + chain. `amountBase` is the EXACT reward the
 * vault derived from the immutable mission (base units) — never an operator input.
 */
export interface CampaignPayoutOutcome {
  status: "settled" | "rejected";
  txHash: Hash;
  blockNumber: number | null;
  /** the emitting contract, validated to equal the expected vault. */
  vault: Address;
  chainId: number;
  missionId: Hash;
  recipient: Address;
  intentHash: Hash;
  decisionDigest: Hash;
  /** the exact reward the vault paid / would have paid, in token base units. */
  amountBase: number;
  /** 1..10 when rejected (mission language), else null. */
  failedCheckIndex: number | null;
  explorerUrl: string;
}

/**
 * SpendRejected → human reason for CampaignVault V2. The check order is the
 * contract's: 1=state, 2=caller, 3=mission, 4=recipient, 5=digests,
 * 6=recipient-already-completed, 7=no-remaining-completions, 8=replay, 9=budget,
 * 10=velocity. Distinct from the V1 map (which has 7 checks in a different order).
 */
export const CAMPAIGN_CHECK_REASONS: Record<number, string> = {
  1: "the vault is paused, expired, or revoked",
  2: "the caller is not the authorized operator",
  3: "the mission does not exist on this vault",
  4: "the recipient is not a valid payable address",
  5: "the decision or intent commitment did not match",
  6: "this recipient has already been paid for this mission",
  7: "this mission has no remaining completions",
  8: "this committed payout intent has already settled",
  9: "the payout would exceed the remaining budget",
  10: "the payout would exceed the 24h velocity cap",
};

export function campaignFailedCheckReason(index: number | null | undefined): string {
  return CAMPAIGN_CHECK_REASONS[index ?? 0] ?? "a mission policy check failed";
}

/** The replay soft-reject index (check 8) — a rejection at 8 implies a prior settlement. */
export const V2_REPLAY_CHECK_INDEX = 8;

/**
 * Deterministic canonical outcome for one intent across ALL its on-chain logs.
 * A settled transaction may be followed by a replay rejection — the SETTLEMENT is
 * the economic truth and a later replay rejection can never override it. Rules:
 *   - exactly one PayoutSettled → that is canonical;
 *   - more than one PayoutSettled for one intent → a critical invariant violation;
 *   - no settlement but a REPLAY rejection (check 8) → a settlement exists that we did
 *     not surface — never terminal, HOLD (never conceal a settled tx);
 *   - no settlement, only non-replay rejections → the intent genuinely failed (terminal);
 *   - nothing relevant → none. Order-independent (never "whichever log came first").
 */
export type CanonicalResolution =
  | { kind: "settled"; outcome: CampaignPayoutOutcome }
  | { kind: "rejected"; outcome: CampaignPayoutOutcome }
  | { kind: "replay_no_settlement" }
  | { kind: "duplicate_settlement"; outcomes: CampaignPayoutOutcome[] }
  | { kind: "none" };

export function resolveCanonicalOutcome(
  outcomes: CampaignPayoutOutcome[],
): CanonicalResolution {
  const settled = outcomes.filter((o) => o.status === "settled");
  if (settled.length > 1) return { kind: "duplicate_settlement", outcomes: settled };
  if (settled.length === 1) return { kind: "settled", outcome: settled[0] };
  const rejections = outcomes.filter((o) => o.status === "rejected");
  if (rejections.length === 0) return { kind: "none" };
  if (rejections.some((r) => r.failedCheckIndex === V2_REPLAY_CHECK_INDEX)) {
    return { kind: "replay_no_settlement" };
  }
  return { kind: "rejected", outcome: rejections[0] };
}

/* ───────────────────────────────────────────────────────── the adapter ──── */

export interface CampaignVaultAdapter {
  /**
   * Read every field {@link checkVaultAgreement} needs: factory provenance, owner,
   * operator, guardian, token, campaignIdHash, missionPlanDigest, budget ceiling,
   * lifecycle, replay support, and each supplied mission's on-chain reward + cap.
   */
  readSnapshot(
    vault: Address,
    chainId: number,
    missionIds: Hash[],
  ): Promise<ChainCampaignSnapshot>;
  /**
   * Broadcast `requestPayout(missionId, recipient, decisionDigest, intentHash)`
   * with the operator key, await the receipt, and decode the vault's event. NO
   * amount is supplied (the vault derives it) and NO recipient allowlisting is
   * performed (V2 pays previously-unknown testers within the mission plan).
   * `onBroadcast` fires with the tx hash the instant it is sent — before the
   * receipt is awaited — so the durable attempt persists the hash for recovery.
   */
  requestPayout(args: {
    vault: Address;
    missionId: Hash;
    recipient: Address;
    decisionDigest: Hash;
    intentHash: Hash;
    chainId: number;
    /**
     * Fired with the broadcast IDENTITY (sender, reserved nonce, calldata hash) the
     * instant it is computed — BEFORE the tx is submitted — so the durable attempt
     * records "a tx may now be in flight" before the RPC can accept one. This is the
     * crash-window fix: a crash after this leaves an ambiguous durable marker,
     * reconciled from the chain, never blind-resent.
     */
    onPreflight?: (meta: {
      sender: Address;
      nonce: number | null;
      calldataHash: Hash;
    }) => void | Promise<void>;
    /** fired with the tx hash the instant it is broadcast (after submission). */
    onBroadcast?: (txHash: Hash) => void | Promise<void>;
  }): Promise<CampaignPayoutOutcome>;
  /** Read an already-broadcast requestPayout tx (crash recovery — never re-sends). */
  awaitOutcome(
    txHash: Hash,
    chainId: number,
    expectVault: Address,
  ): Promise<CampaignPayoutOutcome>;
  /**
   * Courtesy pre-flight reads for one mission payout: lifecycle, remaining budget,
   * this mission's remaining completions, and whether the recipient has already
   * been paid for it. Advisory — the vault soft-rejects each of these anyway; this
   * just avoids burning a tx we can already see will fail.
   */
  readMissionReadiness(
    vault: Address,
    chainId: number,
    missionId: Hash,
    recipient: Address,
  ): Promise<{
    state: VaultLifecycle;
    budgetRemainingBase: number;
    missionRemaining: number;
    recipientCompleted: boolean;
    /** the 24h velocity cap (base units) — contract's getDailyVelocityCap. */
    velocityCapBase: number;
    /** current rolling 24h spend (base units) — contract's getRollingDailySpend. */
    rollingSpendBase: number;
  }>;
  /** Replay guard: has this exact committed intent already settled on the vault? */
  isIntentUsed(vault: Address, intentHash: Hash, chainId: number): Promise<boolean>;
  /**
   * ALL on-chain outcomes (settled + rejected) for an intent, scoped to this vault +
   * chain, each validated to have been emitted by the expected vault. Foreign-vault
   * and wrong-chain logs are excluded. The caller resolves the canonical outcome via
   * {@link resolveCanonicalOutcome} so a later replay rejection can never override a
   * settlement and a duplicate settlement is surfaced as an invariant violation.
   */
  findAllOutcomesByIntent(
    vault: Address,
    intentHash: Hash,
    chainId: number,
  ): Promise<CampaignPayoutOutcome[]>;
  /** The operator's transaction count at a block tag — used-nonce ⟺ a tx was accepted. */
  getSenderNonce(
    sender: Address,
    chainId: number,
    blockTag: "latest" | "pending",
  ): Promise<number>;
}

/** Injectable seams. Default to the real viem client + the real operator signer. */
export interface CampaignVaultAdapterDeps {
  /** the read/receipt client for a chain (a fake transport under test). */
  client?: (chainId: number) => PublicClient;
  /** the write path (the operator signer); returns the broadcast tx hash. */
  broadcast?: (
    chainId: number,
    req: {
      address: Address;
      functionName: string;
      args: readonly unknown[];
      nonce?: number;
    },
  ) => Promise<Hash>;
  /** the operator (payout sender) for a chain — the reserved-nonce owner. */
  operatorAddress?: (chainId: number) => Address;
  /** the V2 factory address for provenance, or null when unconfigured. */
  factoryAddress?: (chainId: number) => Address | null;
}

/** The V2 factory address for a chain (provenance), from env. Null = unconfigured. */
function realFactoryAddress(chainId: number): Address | null {
  const raw =
    (chainId === 2345
      ? process.env.GOAT_CAMPAIGN_FACTORY_ADDRESS
      : process.env.METIS_CAMPAIGN_FACTORY_ADDRESS) ??
    process.env.CAMPAIGN_VAULT_FACTORY_ADDRESS;
  if (!raw) return null;
  try {
    return getAddress(raw);
  } catch {
    return null;
  }
}

const ZERO_ADDR = "0x0000000000000000000000000000000000000000" as Address;
const ZERO_HASH = `0x${"0".repeat(64)}` as Hash;

/**
 * Build a CampaignVault adapter. Pass `deps` to inject a transport/signer in tests;
 * omit for the real production adapter (real viem client + operator signer).
 */
export function makeCampaignVaultAdapter(
  deps: CampaignVaultAdapterDeps = {},
): CampaignVaultAdapter {
  const clientFor = deps.client ?? ((id: number) => realPublicClient(id));
  const broadcast =
    deps.broadcast ??
    ((
      id: number,
      req: { address: Address; functionName: string; args: readonly unknown[]; nonce?: number },
    ) => sendVaultWrite(id, { ...req, abi: campaignVaultAbi }));
  const operatorFor = deps.operatorAddress ?? ((id: number) => realOperatorAddress(id));
  const factoryFor = deps.factoryAddress ?? realFactoryAddress;

  function read<T>(
    chainId: number,
    vault: Address,
    functionName: string,
    args: readonly unknown[] = [],
  ): Promise<T> {
    return clientFor(chainId).readContract({
      address: vault,
      abi: campaignVaultAbi,
      functionName,
      args,
    }) as Promise<T>;
  }

  async function replaySupport(
    chainId: number,
    vault: Address,
  ): Promise<ChainCampaignSnapshot["replaySupport"]> {
    try {
      await read<boolean>(chainId, vault, "isIntentUsed", [CAPABILITY_PROBE]);
      return "supported";
    } catch (err) {
      const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
      // No data / a revert on this pure mapping read means the selector is absent
      // (a wrong/legacy contract at this address); a transport error is unreadable.
      if (msg.includes("returned no data") || msg.includes("reverted") || msg.includes('"0x"')) {
        return "legacy";
      }
      return "unreadable";
    }
  }

  async function factoryRecognizes(
    chainId: number,
    vault: Address,
  ): Promise<boolean> {
    const factory = factoryFor(chainId);
    if (!factory) return false; // unconfigured provenance fails closed
    try {
      return (await clientFor(chainId).readContract({
        address: factory,
        abi: campaignVaultFactoryAbi,
        functionName: "isVault",
        args: [vault],
      })) as boolean;
    } catch {
      return false;
    }
  }

  /**
   * Decode a requestPayout receipt into a validated outcome. Enforces, BEFORE
   * trusting any log: the tx succeeded, it was sent to the expected vault, the
   * decoded event was EMITTED BY the expected vault, and the client is on the
   * expected chain. A receipt whose event came from a different contract is an
   * error — never a settlement.
   */
  async function decodeReceipt(
    client: PublicClient,
    txHash: Hash,
    chainId: number,
    expectVault: Address,
  ): Promise<CampaignPayoutOutcome> {
    const receipt = await client.waitForTransactionReceipt({ hash: txHash });
    if (receipt.status !== "success") {
      throw new Error(`requestPayout reverted (tx ${txHash}).`);
    }
    if (receipt.to && getAddress(receipt.to) !== getAddress(expectVault)) {
      throw new Error(
        `requestPayout tx ${txHash} was sent to ${receipt.to}, not the expected vault ${expectVault}.`,
      );
    }
    // Only trust logs emitted BY the expected vault — a foreign contract in the
    // same tx must never be read as this vault's settlement.
    const ourLogs = receipt.logs.filter(
      (l) => getAddress(l.address) === getAddress(expectVault),
    );
    const events = parseEventLogs({
      abi: campaignVaultAbi,
      logs: ourLogs,
      eventName: ["PayoutSettled", "PayoutRejected"],
    });
    const ev = events[0];
    if (!ev) {
      throw new Error(
        `no PayoutSettled/PayoutRejected from vault ${expectVault} in tx ${txHash}.`,
      );
    }
    const a = ev.args as {
      missionId?: Hash;
      recipient?: Address;
      intentHash?: Hash;
      decisionDigest?: Hash;
      amount?: bigint;
      failedCheckIndex?: number | bigint;
    };
    const settled = ev.eventName === "PayoutSettled";
    return {
      status: settled ? "settled" : "rejected",
      txHash,
      blockNumber: receipt.blockNumber != null ? Number(receipt.blockNumber) : null,
      vault: getAddress(ev.address),
      chainId,
      missionId: a.missionId ?? ZERO_HASH,
      recipient: a.recipient ? getAddress(a.recipient) : ZERO_ADDR,
      intentHash: a.intentHash ?? ZERO_HASH,
      decisionDigest: a.decisionDigest ?? ZERO_HASH,
      amountBase: Number(a.amount ?? BigInt(0)),
      failedCheckIndex: settled ? null : Number(a.failedCheckIndex ?? 0),
      explorerUrl: explorerTxUrl(chainId, txHash),
    };
  }

  /**
   * Map ONE already-fetched Payout* log to an outcome, validated to have been emitted
   * by the expected vault on the expected chain. A log from any other contract is
   * refused (never counted toward this intent's outcomes).
   */
  function logToOutcome(
    log: {
      eventName?: string;
      args: Record<string, unknown>;
      address: Address;
      transactionHash: Hash | null;
      blockNumber: bigint | null;
    },
    chainId: number,
    expectVault: Address,
  ): CampaignPayoutOutcome {
    if (getAddress(log.address) !== getAddress(expectVault)) {
      throw new Error(`log from ${log.address} is not the expected vault ${expectVault}`);
    }
    const a = log.args as {
      missionId?: Hash;
      recipient?: Address;
      intentHash?: Hash;
      decisionDigest?: Hash;
      amount?: bigint;
      failedCheckIndex?: number | bigint;
    };
    const settled = log.eventName === "PayoutSettled";
    const txHash = (log.transactionHash ?? ZERO_HASH) as Hash;
    return {
      status: settled ? "settled" : "rejected",
      txHash,
      blockNumber: log.blockNumber != null ? Number(log.blockNumber) : null,
      vault: getAddress(log.address),
      chainId,
      missionId: a.missionId ?? ZERO_HASH,
      recipient: a.recipient ? getAddress(a.recipient) : ZERO_ADDR,
      intentHash: a.intentHash ?? ZERO_HASH,
      decisionDigest: a.decisionDigest ?? ZERO_HASH,
      amountBase: Number(a.amount ?? BigInt(0)),
      failedCheckIndex: settled ? null : Number(a.failedCheckIndex ?? 0),
      explorerUrl: explorerTxUrl(chainId, txHash),
    };
  }

  return {
    async readSnapshot(vault, chainId, missionIds) {
      const v = getAddress(vault);
      const cfg = chainConfig(chainId);
      const [
        recognized,
        owner,
        operator,
        guardian,
        token,
        campaignIdHash,
        missionPlanDigest,
        budgetCeiling,
        stateRaw,
        replay,
        missionViews,
      ] = await Promise.all([
        factoryRecognizes(cfg.chainId, v),
        read<Address>(cfg.chainId, v, "getOwner"),
        read<Address>(cfg.chainId, v, "getOperator"),
        read<Address>(cfg.chainId, v, "getGuardian"),
        read<Address>(cfg.chainId, v, "getToken"),
        read<Hash>(cfg.chainId, v, "getCampaignIdHash"),
        read<Hash>(cfg.chainId, v, "getMissionPlanDigest"),
        read<bigint>(cfg.chainId, v, "getBudgetCeiling"),
        read<number>(cfg.chainId, v, "getState"),
        replaySupport(cfg.chainId, v),
        Promise.all(
          missionIds.map((m) =>
            read<{
              exists: boolean;
              rewardAmount: bigint;
              maxCompletions: bigint;
              paidCompletions: bigint;
            }>(cfg.chainId, v, "getMission", [m]).then((mv) => [m, mv] as const),
          ),
        ),
      ]);

      const missions: ChainCampaignSnapshot["missions"] = {};
      for (const [m, mv] of missionViews) {
        missions[m.toLowerCase()] = {
          exists: mv.exists,
          rewardBase: mv.rewardAmount,
          maxCompletions: mv.maxCompletions,
        };
      }

      return {
        factoryRecognizes: recognized,
        owner,
        operator,
        guardian,
        token,
        campaignIdHash,
        missionPlanDigest,
        budgetCeiling,
        chainId: cfg.chainId,
        state: (VAULT_STATE[stateRaw] ?? "created") as VaultLifecycle,
        replaySupport: replay,
        missions,
      };
    },

    async requestPayout(args) {
      const chainId = chainConfig(args.chainId).chainId;
      const vault = getAddress(args.vault);
      const callArgs = [
        args.missionId,
        getAddress(args.recipient),
        args.decisionDigest,
        args.intentHash,
      ] as const;
      // Reserve the sender + nonce and compute the exact calldata, then persist the
      // broadcast IDENTITY BEFORE we submit. A crash after onPreflight leaves an
      // ambiguous durable marker (a tx may be in flight) that recovery reconciles —
      // it never blind-resends, since a consumed nonce proves a tx was accepted.
      const sender = operatorFor(chainId);
      const calldataHash = keccak256(
        encodeFunctionData({ abi: campaignVaultAbi, functionName: "requestPayout", args: callArgs }),
      );
      let nonce: number | null = null;
      try {
        nonce = await clientFor(chainId).getTransactionCount({ address: sender, blockTag: "pending" });
      } catch {
        nonce = null; // best-effort; ambiguity still fails closed on the intent events
      }
      if (args.onPreflight) await args.onPreflight({ sender, nonce, calldataHash });

      const txHash = await broadcast(chainId, {
        address: vault,
        functionName: "requestPayout",
        args: callArgs,
        ...(nonce != null ? { nonce } : {}),
      });
      if (args.onBroadcast) await args.onBroadcast(txHash);
      return decodeReceipt(clientFor(chainId), txHash, chainId, vault);
    },

    async awaitOutcome(txHash, chainId, expectVault) {
      const id = chainConfig(chainId).chainId;
      return decodeReceipt(clientFor(id), txHash, id, getAddress(expectVault));
    },

    async readMissionReadiness(vault, chainId, missionId, recipient) {
      const id = chainConfig(chainId).chainId;
      const v = getAddress(vault);
      const [stateRaw, stats, remaining, completed, velocityCap, rollingSpend] =
        await Promise.all([
          read<number>(id, v, "getState"),
          read<readonly [bigint, bigint, bigint]>(id, v, "getSpendStats"),
          read<bigint>(id, v, "getMissionRemaining", [missionId]),
          read<boolean>(id, v, "hasRecipientCompleted", [missionId, getAddress(recipient)]),
          read<bigint>(id, v, "getDailyVelocityCap"),
          read<bigint>(id, v, "getRollingDailySpend"),
        ]);
      return {
        state: (VAULT_STATE[stateRaw] ?? "created") as VaultLifecycle,
        budgetRemainingBase: Number(stats[1]),
        missionRemaining: Number(remaining),
        recipientCompleted: completed,
        velocityCapBase: Number(velocityCap),
        rollingSpendBase: Number(rollingSpend),
      };
    },

    async isIntentUsed(vault, intentHash, chainId) {
      return read<boolean>(chainConfig(chainId).chainId, getAddress(vault), "isIntentUsed", [
        intentHash,
      ]);
    },

    async findAllOutcomesByIntent(vault, intentHash, chainId) {
      const id = chainConfig(chainId).chainId;
      const v = getAddress(vault);
      const [settled, rejected] = await Promise.all([
        clientFor(id).getContractEvents({
          address: v,
          abi: campaignVaultAbi,
          eventName: "PayoutSettled",
          args: { intentHash },
          fromBlock: "earliest",
          toBlock: "latest",
        }),
        clientFor(id).getContractEvents({
          address: v,
          abi: campaignVaultAbi,
          eventName: "PayoutRejected",
          args: { intentHash },
          fromBlock: "earliest",
          toBlock: "latest",
        }),
      ]);
      return [...settled, ...rejected].map((l) =>
        logToOutcome(
          {
            eventName: l.eventName,
            args: l.args as Record<string, unknown>,
            address: l.address,
            transactionHash: l.transactionHash,
            blockNumber: l.blockNumber,
          },
          id,
          v,
        ),
      );
    },

    async getSenderNonce(sender, chainId, blockTag) {
      return clientFor(chainConfig(chainId).chainId).getTransactionCount({
        address: getAddress(sender),
        blockTag,
      });
    },
  };
}

/** The production adapter — real viem client + real operator signer. */
export const realCampaignVaultAdapter: CampaignVaultAdapter =
  makeCampaignVaultAdapter();

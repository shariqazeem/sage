import "server-only";

import {
  BaseError,
  ContractFunctionZeroDataError,
  keccak256,
  stringToHex,
  type Address,
  type Hex,
} from "viem";

import { chainConfig } from "./networks";
import { isIntentUsed } from "./chain";

/**
 * Whether a deployed Policy Vault enforces on-chain intent replay protection
 * (check 7 / `isIntentUsed`). Vaults deployed before that upgrade lack the
 * function entirely — the app must not present them as replay-safe, and must not
 * auto-pay real money from them.
 *
 * Three states, deliberately NOT a boolean:
 *   - "supported"  — the guard exists; autonomous payout is replay-safe.
 *   - "legacy"     — CONFIRMED pre-upgrade vault (the function is absent).
 *   - "unreadable" — we could not read it (RPC down / timeout). NOT proof of
 *                    legacy status; it must hold safely, never proceed.
 */
export type VaultReplaySupport = "supported" | "legacy" | "unreadable";

/**
 * A harmless, deterministic probe intent. Reading `isIntentUsed(probe)` moves no
 * funds and (astronomically) will not match a real settled intent — and even if
 * it did, the answer is still a boolean, which is all we need to prove the
 * function EXISTS. We only care whether the selector is present, not its value.
 */
const CAPABILITY_PROBE: Hex = keccak256(stringToHex("sage.capability.probe.v1"));

/** Real-money chains (GOAT mainnet, Metis Andromeda) require a replay-safe vault. */
export function requiresReplayProtection(chainId: number): boolean {
  return chainConfig(chainId).isMainnet;
}

/**
 * The exact autopilot hold reason for a capability state, or null when the vault
 * is safe to auto-pay from. Pure — unit-testable without a chain.
 */
export function replayHoldReason(support: VaultReplaySupport): string | null {
  switch (support) {
    case "supported":
      return null;
    case "legacy":
      return "Legacy vault — replay-protected autonomy requires an upgraded vault.";
    case "unreadable":
      return "vault replay-protection status temporarily unreadable — held for review";
    default: {
      const _exhaustive: never = support;
      void _exhaustive;
      return "vault replay-protection status temporarily unreadable — held for review";
    }
  }
}

/**
 * Classify a failed capability probe. A missing function (a pre-upgrade vault)
 * makes the node return no data ("0x") or revert — a CONFIRMED legacy vault. A
 * transport error (RPC down, timeout, HTTP failure) is NOT proof of legacy
 * status; it is UNREADABLE and must hold safely. `isIntentUsed` is a pure mapping
 * read that never reverts on a real upgraded vault, so a revert/no-data on THIS
 * call reliably means the selector is absent. Pure — unit-testable.
 */
export function classifyReplaySupportError(err: unknown): "legacy" | "unreadable" {
  if (err instanceof BaseError) {
    // The call reached the contract but returned no data ("0x") — the selector
    // isn't there. viem raises ContractFunctionZeroDataError for exactly this.
    if (err.walk((e) => e instanceof ContractFunctionZeroDataError)) return "legacy";
    const msg = `${err.shortMessage ?? err.message}`.toLowerCase();
    if (
      msg.includes("returned no data") ||
      msg.includes('("0x")') ||
      msg.includes("execution reverted")
    ) {
      return "legacy";
    }
    return "unreadable";
  }
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
  if (msg.includes("returned no data") || msg.includes("execution reverted")) {
    return "legacy";
  }
  return "unreadable";
}

interface CacheEntry {
  status: VaultReplaySupport;
  expiresAt: number;
}
const CACHE = new Map<string, CacheEntry>();
const TTL_MS = 5 * 60 * 1000; // brief — a deployed contract can't change its code, but never cache permanently

function cacheKey(vault: string, chainId: number): string {
  return `${chainId}:${vault.toLowerCase()}`;
}

/**
 * Does this vault enforce on-chain intent replay protection? Probes `isIntentUsed`
 * with a harmless deterministic value and classifies the outcome. "supported" and
 * "legacy" are cached briefly (definitive facts about deployed code); "unreadable"
 * is NEVER cached, so a transient RPC blip can never stick as a false answer.
 */
export async function supportsIntentReplayProtection(
  vault: Address,
  chainId: number,
): Promise<VaultReplaySupport> {
  const key = cacheKey(vault, chainId);
  const hit = CACHE.get(key);
  if (hit && hit.expiresAt > Date.now()) return hit.status;

  let status: VaultReplaySupport;
  try {
    // A boolean answer of ANY value proves the function exists.
    await isIntentUsed(vault, CAPABILITY_PROBE, chainId);
    status = "supported";
  } catch (err) {
    status = classifyReplaySupportError(err);
  }

  if (status !== "unreadable") {
    CACHE.set(key, { status, expiresAt: Date.now() + TTL_MS });
  }
  return status;
}

/** Test-only: clear the capability cache between cases. */
export function __clearVaultCapabilityCache(): void {
  CACHE.clear();
}

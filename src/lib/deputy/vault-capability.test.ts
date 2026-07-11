import { beforeEach, describe, expect, it, vi } from "vitest";
import { BaseError, ContractFunctionZeroDataError, type Address } from "viem";

vi.mock("@/lib/deputy/chain", () => ({ isIntentUsed: vi.fn() }));

import { isIntentUsed } from "@/lib/deputy/chain";
import {
  __clearVaultCapabilityCache,
  classifyReplaySupportError,
  replayHoldReason,
  requiresReplayProtection,
  supportsIntentReplayProtection,
} from "./vault-capability";

const VAULT = `0x${"1".repeat(40)}` as Address;
const VAULT_B = `0x${"2".repeat(40)}` as Address;

beforeEach(() => {
  vi.clearAllMocks();
  __clearVaultCapabilityCache();
});

describe("requiresReplayProtection — real-money chains only", () => {
  it("is true for mainnet chains, false for testnet", () => {
    expect(requiresReplayProtection(2345)).toBe(true); // GOAT mainnet
    expect(requiresReplayProtection(1088)).toBe(true); // Metis Andromeda
    expect(requiresReplayProtection(59902)).toBe(false); // Metis Sepolia (testnet)
  });
});

describe("replayHoldReason — the exact autopilot hold copy", () => {
  it("supported → no hold", () => {
    expect(replayHoldReason("supported")).toBeNull();
  });
  it("legacy → the explicit upgrade-required reason", () => {
    expect(replayHoldReason("legacy")).toBe(
      "Legacy vault — replay-protected autonomy requires an upgraded vault.",
    );
  });
  it("unreadable → holds safely with a temporary reason", () => {
    expect(replayHoldReason("unreadable")).toMatch(/temporarily unreadable/i);
  });
});

describe("classifyReplaySupportError — legacy vs unreadable", () => {
  it("a no-data contract error (missing function) is CONFIRMED legacy", () => {
    const err = new ContractFunctionZeroDataError({ functionName: "isIntentUsed" });
    expect(classifyReplaySupportError(err)).toBe("legacy");
  });

  it('"execution reverted" is legacy (the selector is absent on old vaults)', () => {
    expect(classifyReplaySupportError(new BaseError("Execution reverted"))).toBe(
      "legacy",
    );
  });

  it("a transport error is UNREADABLE, never assumed legacy", () => {
    expect(classifyReplaySupportError(new BaseError("HTTP request failed"))).toBe(
      "unreadable",
    );
    expect(classifyReplaySupportError(new Error("socket hang up"))).toBe(
      "unreadable",
    );
    expect(classifyReplaySupportError("timeout")).toBe("unreadable");
  });
});

describe("supportsIntentReplayProtection — probe + classify + cache", () => {
  it("a boolean answer proves the guard exists → supported", async () => {
    vi.mocked(isIntentUsed).mockResolvedValue(false);
    expect(await supportsIntentReplayProtection(VAULT, 2345)).toBe("supported");
  });

  it("a missing function → legacy", async () => {
    vi.mocked(isIntentUsed).mockRejectedValue(
      new ContractFunctionZeroDataError({ functionName: "isIntentUsed" }),
    );
    expect(await supportsIntentReplayProtection(VAULT, 2345)).toBe("legacy");
  });

  it("an RPC failure → unreadable (holds safely, not assumed legacy)", async () => {
    vi.mocked(isIntentUsed).mockRejectedValue(new BaseError("HTTP request failed"));
    expect(await supportsIntentReplayProtection(VAULT, 2345)).toBe("unreadable");
  });

  it("caches a definitive answer (supported/legacy) — no second chain read", async () => {
    vi.mocked(isIntentUsed).mockResolvedValue(true);
    await supportsIntentReplayProtection(VAULT, 2345);
    await supportsIntentReplayProtection(VAULT, 2345);
    expect(isIntentUsed).toHaveBeenCalledTimes(1);
  });

  it("NEVER caches unreadable — a transient blip cannot stick", async () => {
    vi.mocked(isIntentUsed).mockRejectedValue(new BaseError("HTTP request failed"));
    await supportsIntentReplayProtection(VAULT_B, 2345);
    await supportsIntentReplayProtection(VAULT_B, 2345);
    expect(isIntentUsed).toHaveBeenCalledTimes(2); // re-read, not cached
  });
});

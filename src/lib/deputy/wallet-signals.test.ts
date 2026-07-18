import { describe, expect, it, vi } from "vitest";

vi.mock("./chain", () => ({ publicClient: vi.fn() }));
vi.mock("./networks", () => ({ chainLabel: () => "GOAT Mainnet" }));

import { walletFreshnessSignal } from "./wallet-signals";
import { isAutoPayQualifying } from "./brain-core";
import { publicClient } from "./chain";

const WALLET = "0x" + "a".repeat(40);

function withNonce(n: number | Error) {
  vi.mocked(publicClient).mockReturnValue({
    getTransactionCount:
      n instanceof Error ? vi.fn().mockRejectedValue(n) : vi.fn().mockResolvedValue(n),
  } as never);
}

describe("walletFreshnessSignal (P18 wallet heuristic — signal only)", () => {
  it("a brand-new wallet (nonce 0) → a 'med' fresh-wallet caution", async () => {
    withNonce(0);
    const s = await walletFreshnessSignal(WALLET, 2345);
    expect(s?.signal).toBe("fresh wallet");
    expect(s?.severity).toBe("med");
    expect(s?.reason).toMatch(/no prior transactions/i);
  });

  it("a young wallet (nonce 2) → a 'low' caution", async () => {
    withNonce(2);
    expect((await walletFreshnessSignal(WALLET, 2345))?.severity).toBe("low");
  });

  it("an established wallet (nonce 20) → NO signal (stays silent)", async () => {
    withNonce(20);
    expect(await walletFreshnessSignal(WALLET, 2345)).toBeNull();
  });

  it("an RPC failure → NO signal (an infra blip must never become an accusation)", async () => {
    withNonce(new Error("rpc down"));
    expect(await walletFreshnessSignal(WALLET, 2345)).toBeNull();
  });

  it("a fresh-wallet signal ALONE never blocks autopay (never a sole block)", async () => {
    withNonce(0);
    const fresh = await walletFreshnessSignal(WALLET, 2345);
    // pay + high confidence + ONLY the fresh-wallet caution → still auto-pay-qualifying. It bites only
    // when the brief ALSO carries a high-severity signal (which the model, not freshness, provides).
    expect(
      isAutoPayQualifying({ recommendation: "pay", confidence: 0.95, fraudSignals: [fresh!] }),
    ).toBe(true);
    expect(
      isAutoPayQualifying({
        recommendation: "pay",
        confidence: 0.95,
        fraudSignals: [fresh!, { signal: "evidence contradiction", severity: "high", reason: "x" }],
      }),
    ).toBe(false); // combined with a real high-severity signal, it holds
  });
});

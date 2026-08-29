import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

import { discoverStarknetWallets } from "./use-starknet-wallet";

/**
 * THE BUG THIS PINS: a wallet's `request` was lifted off its own object and stored as a bare
 * function, then called as a method of OURS. A wallet that reaches through `this` for its message
 * channel then has nowhere to send the request — it resolves against nothing, and about a second
 * later the wallet reports "Timeout" with no other symptom. Reported from a real browser with
 * Ready installed; invisible in every mock that used an arrow function.
 */

const original = { ...globalThis } as Record<string, unknown>;

beforeEach(() => {
  for (const k of Object.keys(window)) {
    if (k.toLowerCase().startsWith("starknet")) {
      delete (window as unknown as Record<string, unknown>)[k];
    }
  }
});
afterEach(() => void original);

describe("discoverStarknetWallets", () => {
  it("keeps `this` bound to the wallet, not to Sage's own object", async () => {
    // A wallet written the ordinary way: `request` uses `this` to reach its own state.
    const realWallet = {
      id: "ready",
      name: "Ready",
      secretChannel: "connected",
      request(this: { secretChannel?: string }, { type }: { type: string }) {
        if (!this?.secretChannel) throw new Error("Timeout");
        return Promise.resolve(type === "wallet_requestAccounts" ? ["0x1"] : null);
      },
    };
    (window as unknown as Record<string, unknown>).starknet_ready = realWallet;

    const [found] = discoverStarknetWallets();
    expect(found).toBeTruthy();
    // Called exactly as the sign-in calls it — as a method of the object discovery returned.
    await expect(found.request({ type: "wallet_requestAccounts" })).resolves.toEqual(["0x1"]);
  });

  it("deduplicates one extension that arrives through both routes", () => {
    // The same wallet reaching us twice rendered as two buttons for one extension.
    const w = { id: "a", name: "Ready", request: () => Promise.resolve(null) };
    (window as unknown as Record<string, unknown>).starknet_ready = w;
    (window as unknown as Record<string, unknown>).starknet_readyDuplicate = { ...w, id: "b" };
    expect(discoverStarknetWallets().filter((x) => x.name === "Ready")).toHaveLength(1);
  });

  it("ignores a global that is not a wallet", () => {
    (window as unknown as Record<string, unknown>).starknet_notAWallet = { name: "nope" };
    expect(discoverStarknetWallets().some((w) => w.name === "nope")).toBe(false);
  });
});

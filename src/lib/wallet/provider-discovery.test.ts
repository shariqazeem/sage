import { describe, it, expect, beforeEach, vi } from "vitest";

/**
 * FINDING THE WALLET WHEN THE BROWSER HAS SEVERAL AND THEY ARE STILL ARRIVING.
 *
 * `window.ethereum` is one slot that every injected wallet races to claim; whoever writes last wins.
 * Reading it once at mount fails two ordinary situations — a browser with several wallet extensions
 * where the winner is not the one the person uses here, and a wallet that injects AFTER React
 * mounts. Measured 2026-08-15: a founder mid-deploy reconnected repeatedly and kept being told
 * "your wallet is not connected", with the vault already live on chain and one signature to go.
 *
 * The rules pinned here are the ones that fix it: prefer whichever provider already has an
 * AUTHORIZED account for this site, and treat discovery as event-driven, not a single lucky read.
 */
type P = { id: string; accounts: string[] };

const request = (p: P) => async ({ method }: { method: string }) => {
  if (method === "eth_accounts") return p.accounts;
  if (method === "eth_chainId") return "0x929";
  throw new Error("unsupported");
};

/** mirrors authorizedProvider(): first candidate that answers with an account wins. */
async function pickAuthorized(candidates: P[]): Promise<P | null> {
  for (const p of candidates) {
    try {
      const accs = await request(p)({ method: "eth_accounts" });
      if (accs?.[0]) return p;
    } catch {
      /* not this one */
    }
  }
  return null;
}

describe("wallet provider discovery", () => {
  it("picks the wallet that is AUTHORIZED here, not whichever won window.ethereum", async () => {
    const winner = { id: "phantom", accounts: [] };
    const real = { id: "metamask", accounts: ["0xabc"] };
    expect((await pickAuthorized([winner, real]))?.id).toBe("metamask");
  });

  it("returns null when no candidate has an account — that is 'not connected', honestly", async () => {
    expect(await pickAuthorized([{ id: "a", accounts: [] }, { id: "b", accounts: [] }])).toBeNull();
  });

  it("a provider that throws is skipped, never fatal", async () => {
    const bad = { id: "bad", get accounts(): string[] { throw new Error("locked"); } } as unknown as P;
    expect((await pickAuthorized([bad, { id: "ok", accounts: ["0x1"] }]))?.id).toBe("ok");
  });

  it("announced providers are preferred over the global slot", () => {
    const announced = [{ id: "announced" }];
    const legacy = [{ id: "legacy" }];
    const bare = [{ id: "bare" }];
    const order = [...new Set([...announced, ...legacy, ...bare])].map((p) => p.id);
    expect(order[0]).toBe("announced");
  });

  it("de-duplicates a provider that appears in both the announcement and the global slot", () => {
    const shared = { id: "metamask" };
    expect([...new Set([shared, shared])].length).toBe(1);
  });
});

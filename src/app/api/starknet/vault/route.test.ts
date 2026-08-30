import { beforeEach, describe, expect, it, vi } from "vitest";

const readVaultState = vi.fn();
const readVaultBalance = vi.fn();
vi.mock("@/lib/starknet/vault", () => ({
  readVaultState: (...a: unknown[]) => readVaultState(...a),
  readVaultBalance: (...a: unknown[]) => readVaultBalance(...a),
}));

const VAULT = "0x6c70a9842ea760e65070b9af0029439550b87a22323de4a28817f47f8d5a19a";

const get = async (address: string) => {
  const { GET } = await import("./route");
  const res = await GET(new Request(`https://x/api/starknet/vault?address=${address}`));
  return { status: res.status, body: await res.json() };
};

beforeEach(() => {
  readVaultState.mockReset().mockResolvedValue({
    owner: "0x4f1f",
    operator: "0x46a1",
    status: 1,
    statusLabel: "active",
  });
  readVaultBalance.mockReset().mockResolvedValue(BigInt(1_000_000));
});

describe("GET /api/starknet/vault", () => {
  it("reports the balance a founder is trying to withdraw", async () => {
    const { body } = await get(VAULT);
    expect(body).toMatchObject({ ok: true, balanceUsd: "1.00", statusLabel: "active" });
  });

  it("says a read FAILED rather than leaving the console spinning", async () => {
    // The EVM card threw on a felt and sat on "reading vault balance…" forever. An error a
    // person can see beats a spinner that never resolves.
    readVaultBalance.mockRejectedValue(new Error("rpc down"));
    const { status, body } = await get(VAULT);
    expect(status).toBe(502);
    expect(body.ok).toBe(false);
    expect(body.error).toMatch(/could not read/i);
  });

  it("refuses anything that is not an address", async () => {
    for (const bad of ["nonsense", "", "0x"]) {
      expect((await get(bad)).status).toBe(400);
    }
  });

  it("needs no session, so an expired cookie cannot lock a founder out of their own balance", async () => {
    // Everything returned is already public on chain.
    expect((await get(VAULT)).status).toBe(200);
  });

  it("returns the owner, so the console can refuse to sign with the wrong account", async () => {
    expect((await get(VAULT)).body.owner).toBe("0x4f1f");
  });
});

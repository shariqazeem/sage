import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * THE SIGNED-IN OWNER PROVES A FLOOR WITHOUT A SECOND SIGNATURE (26 Oct 2026). An email sign-in has no
 * MetaMask to sign with; its session already proves the record is theirs, as the privacy route accepts.
 * Nobody else can ask, by session or by signature, so the binary-search oracle stays closed.
 */
const session = vi.hoisted(() => ({ addr: null as string | null }));
vi.mock("@/lib/auth/session", () => ({ getSessionAddress: async () => session.addr }));
vi.mock("@/lib/campaigns/credit", () => ({ walletCreditSignals: () => ({ record: {}, signals: {} }) }));
vi.mock("@/lib/campaigns/attestation", () => ({
  buildAttestation: () => ({ statement: "earned at least $5.00" }),
  signAttestation: async (u: object) => ({ ...u, signature: "0x01" }),
  DEFAULT_TTL_SECONDS: 60,
}));

import { POST } from "./route";

const W = "0x00000000000000000000000000000000000000aa";
const call = (body: unknown) => POST(new Request("http://x", { method: "POST", body: JSON.stringify(body) }), { params: Promise.resolve({ wallet: W }) });

beforeEach(() => { session.addr = null; });

describe("a floor attestation", () => {
  it("is issued to the record's own signed-in wallet with no signature", async () => {
    session.addr = "0x00000000000000000000000000000000000000AA";
    const res = await call({ earnedAtLeastUsd: 5 });
    expect(res.status).toBe(200);
    expect((await res.json()).attestation).toMatchObject({ statement: "earned at least $5.00" });
  });

  it("is refused to anyone else without the wallet's own signature", async () => {
    expect((await call({ earnedAtLeastUsd: 5 })).status).toBe(401); // signed out
    session.addr = "0x00000000000000000000000000000000000000bb";
    expect((await call({ earnedAtLeastUsd: 5 })).status).toBe(401); // someone else's session
    expect((await call({ earnedAtLeastUsd: 5, issuedAt: Math.floor(Date.now() / 1000), signature: `0x${"1".repeat(130)}` })).status).toBe(403);
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * WHO MAY CHANGE WHETHER A RECORD'S AMOUNTS ARE PUBLIC (26 Oct 2026): the person signed in as that
 * wallet (an email sign-in or MetaMask: the session proves the address), or anyone holding a fresh
 * signature from it. Nobody else.
 */
const h = vi.hoisted(() => ({ session: null as string | null, set: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ getSessionAddress: async () => h.session }));
vi.mock("@/lib/campaigns/record-preference", () => ({ setRecordPrivate: (...a: unknown[]) => h.set(...a) }));

import { POST } from "./route";

const WALLET = "0x1111111111111111111111111111111111111111";
const call = (body: unknown) =>
  POST(new Request(`http://x/api/record/${WALLET}/privacy`, { method: "POST", body: JSON.stringify(body) }), { params: Promise.resolve({ wallet: WALLET }) });

beforeEach(() => {
  h.session = null;
  h.set.mockClear();
});

describe("changing a record's privacy", () => {
  it("signed in as the record's wallet: saved with no signature, the session is the proof", async () => {
    h.session = WALLET.toUpperCase().replace("0X", "0x");
    const res = await call({ amountsPrivate: true });
    expect(res.status).toBe(200);
    expect(h.set).toHaveBeenCalledWith(WALLET, true);
  });

  it("signed in as someone else: still needs a signature from the record's wallet", async () => {
    h.session = "0x2222222222222222222222222222222222222222";
    const res = await call({ amountsPrivate: true });
    expect(res.status).toBe(401);
    expect(h.set).not.toHaveBeenCalled();
  });

  it("signed out, with a signature that is not the wallet's: refused", async () => {
    const res = await call({ amountsPrivate: false, issuedAt: Math.floor(Date.now() / 1000), signature: `0x${"ab".repeat(65)}` });
    expect([401, 403]).toContain(res.status);
    expect(h.set).not.toHaveBeenCalled();
  });
});

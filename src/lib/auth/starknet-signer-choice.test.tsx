import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";

/**
 * THE SIGNATURE MUST GO TO THE WALLET THAT SIGNED IN.
 *
 * REPORTED FROM THE LIVE CAMPAIGN: signed in with Ready, pressed submit, and Xverse opened.
 *
 * `signTypedData` took `discovery.wallets[0]` — so DISCOVERY ORDER decided who was asked to sign.
 * A signature from the wrong account is refused server-side as a wallet mismatch, which reads to
 * the person as the product being broken, on a page that had everything it needed to prevent it.
 *
 * Two guards, because there is more than one way to reach the wrong extension: resolve the wallet
 * by the id that signed in, and — whatever the resolution — confirm it holds the account that will
 * be paid before asking it to sign.
 */

const ready = { id: "Ready", name: "Ready", request: vi.fn() };
const xverse = { id: "Xverse", name: "Xverse", request: vi.fn() };
const discovery = {
  wallets: [xverse, ready], // Xverse first on purpose: this is the reported ordering
  connected: null as unknown,
  connecting: false,
  error: null as string | null,
  connect: vi.fn(),
  disconnect: vi.fn(),
};

vi.mock("@/lib/starknet/use-starknet-wallet", () => ({
  useStarknetWallet: () => discovery,
}));
vi.mock("./use-founder-session", () => ({ refreshFounderSession: vi.fn() }));

import { useStarknetSiwe } from "./use-starknet-siwe";

const ADDRESS = "0x4f1f6530f84e4a1db7fa35bafc313174a2482a54c775c4321487eb0fe91f434";
const TYPED = { domain: {}, types: {}, primaryType: "EvidenceCommitment", message: {} };

/** A hook already holding a live session for ADDRESS. */
const signedInHook = async () => {
  const h = renderHook(() => useStarknetSiwe());
  await waitFor(() => expect(h.result.current.loading).toBe(false));
  return h;
};

beforeEach(() => {
  window.localStorage.clear();
  discovery.wallets = [xverse, ready];
  ready.request.mockReset().mockImplementation(async ({ type }: { type: string }) =>
    type === "wallet_requestAccounts" ? [ADDRESS] : ["0xsig1", "0xsig2"],
  );
  xverse.request.mockReset().mockImplementation(async ({ type }: { type: string }) =>
    type === "wallet_requestAccounts" ? ["0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbee"] : ["0xbad"],
  );
  vi.stubGlobal("fetch", vi.fn(async (url: string) =>
    String(url).includes("/session")
      ? new Response(JSON.stringify({ address: ADDRESS }), { status: 200 })
      : new Response(JSON.stringify({ ok: true }), { status: 200 }),
  ));
});

describe("which wallet is asked to sign the evidence", () => {
  it("asks the wallet remembered from sign-in, not the first one discovered", async () => {
    window.localStorage.setItem("sage.starknet.walletId", "Ready");
    const { result } = await signedInHook();
    let sig: string[] | null = null;
    await act(async () => { sig = await result.current.signTypedData(TYPED); });
    expect(sig).toEqual(["0xsig1", "0xsig2"]);
    expect(xverse.request).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: "wallet_signTypedData" }),
    );
  });

  it("REFUSES rather than guessing when two wallets are installed and none is remembered", async () => {
    // Picking one on the person's behalf is exactly what caused the report.
    const { result } = await signedInHook();
    let sig: string[] | null = ["unset"];
    await act(async () => { sig = await result.current.signTypedData(TYPED); });
    expect(sig).toBeNull();
    expect(result.current.error).toMatch(/which of your wallets/i);
    expect(xverse.request).not.toHaveBeenCalled();
    expect(ready.request).not.toHaveBeenCalled();
  });

  it("uses the only wallet when there is exactly one, with nothing remembered", async () => {
    discovery.wallets = [ready];
    const { result } = await signedInHook();
    let sig: string[] | null = null;
    await act(async () => { sig = await result.current.signTypedData(TYPED); });
    expect(sig).toEqual(["0xsig1", "0xsig2"]);
  });

  it("refuses when the remembered wallet now holds a DIFFERENT account", async () => {
    // Someone switched accounts in the extension. Signing would produce a valid signature from an
    // address the vault can never pay.
    window.localStorage.setItem("sage.starknet.walletId", "Ready");
    ready.request.mockImplementation(async ({ type }: { type: string }) =>
      type === "wallet_requestAccounts" ? ["0x123456789abcdef123456789abcdef123456789abcdef123456789abcdef12"] : ["0xsig1"],
    );
    const { result } = await signedInHook();
    let sig: string[] | null = ["unset"];
    await act(async () => { sig = await result.current.signTypedData(TYPED); });
    expect(sig).toBeNull();
    expect(result.current.error).toMatch(/different account/i);
  });

  it("treats the same address written with and without leading zeros as a match", async () => {
    window.localStorage.setItem("sage.starknet.walletId", "Ready");
    ready.request.mockImplementation(async ({ type }: { type: string }) =>
      type === "wallet_requestAccounts" ? [`0x0${ADDRESS.slice(2)}`] : ["0xsig1"],
    );
    const { result } = await signedInHook();
    let sig: string[] | null = null;
    await act(async () => { sig = await result.current.signTypedData(TYPED); });
    expect(sig).toEqual(["0xsig1"]);
  });
});

/**
 * ONE SIGN-IN FAILURE HAS A DIFFERENT REMEDY, AND SAYING THE WRONG THING COSTS REAL TIME.
 *
 * A Starknet account is counterfactual until its first OUTGOING transaction: it has an address and
 * no contract, so nothing exists that can check a signature. REPORTED live with a fresh Xverse
 * wallet — the server logged `undeployed` and returned a paragraph explaining it, and the client
 * threw that away and said "That signature could not be verified. Try signing in again", which is
 * advice that can never work.
 *
 * Every OTHER failure keeps one message on purpose: telling a prober whether the nonce or the
 * signature was wrong tells them which one to change.
 */
describe("what a failed sign-in tells you", () => {
  const attempt = async (body: unknown, status = 401) => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (String(url).includes("/nonce")) {
        return new Response(JSON.stringify({ issuedAt: 1788000000, typedData: { message: {} } }), { status: 200 });
      }
      if (String(url).includes("/verify")) return new Response(JSON.stringify(body), { status });
      return new Response(JSON.stringify({ address: null }), { status: 200 });
    }));
    const { result } = await signedInHook();
    await act(async () => { await result.current.signIn(ready as never); });
    return result.current.error;
  };

  it("explains an undeployed account instead of asking for another signature", async () => {
    const err = await attempt({
      reason: "undeployed",
      error: "This wallet has no account contract on Starknet mainnet yet — the account is created when the wallet SENDS its first transaction.",
    });
    expect(err).toMatch(/no account contract/i);
    expect(err).toMatch(/first transaction/i);
    expect(err).not.toMatch(/try signing in again/i);
  });

  it("keeps ONE message for every other failure, so a prober learns nothing", async () => {
    expect(await attempt({ error: "could not verify that signature" })).toMatch(
      /could not be verified/i,
    );
  });
});

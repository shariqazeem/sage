import { afterEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import type { WalletClient } from "viem";
import type { WalletApi } from "@/lib/wallet/use-wallet";

/**
 * A SIGN-IN NEVER SWAPS WHO IS SIGNED IN BEHIND THEIR BACK (Demo Day, 10 Oct 2026).
 *
 * A founder signed in by email clicked a wallet button on the plan page. The plain sign-in replaced
 * the email session, and the account (it belongs to the email identity) vanished mid-demo. A plain
 * sign-in now refuses to replace a session that belongs to a different wallet; linking is
 * `mode: "bind"`, and switching accounts is an explicit `replace`.
 */
vi.mock("@/lib/wallet/use-wallet", () => ({ useWallet: () => null }));

import { useSiwe } from "./use-siwe";

const EMAIL_ACCOUNT = "0x1111111111111111111111111111111111111111";
const BROWSER_WALLET = "0x2222222222222222222222222222222222222222";

const json = (b: unknown) => new Response(JSON.stringify(b), { status: 200, headers: { "content-type": "application/json" } });

function wallet(address: string): WalletApi {
  const client = { signMessage: vi.fn(async () => "0x5167") } as unknown as WalletClient;
  return {
    address: address as `0x${string}`, chainId: 2345, connecting: false, available: true, onMetis: false,
    onChain: () => false, connect: vi.fn(async () => address as `0x${string}`), disconnect: vi.fn(), switchToMetis: vi.fn(async () => {}),
    switchToChain: vi.fn(async () => {}), getWalletClient: () => client, getProvider: () => null,
  };
}

/** The server: who is signed in, and every verify the page asked for. */
function server(sessionAddress: string | null) {
  const verifies: Array<{ mode?: string; address?: string }> = [];
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const u = String(url);
    if (u === "/api/auth/session") return json({ address: sessionAddress });
    if (u === "/api/auth/nonce") return json({ nonce: "n0nce" });
    if (u === "/api/auth/founder") return json({ address: sessionAddress, chain: sessionAddress ? "evm" : null });
    if (u === "/api/auth/verify") {
      const body = JSON.parse(String(init?.body ?? "{}")) as { mode?: string; address?: string };
      verifies.push(body);
      return json({ ok: true, address: body.mode === "bind" ? sessionAddress : body.address });
    }
    return json({});
  });
  vi.stubGlobal("fetch", fetchMock);
  return { verifies };
}

afterEach(() => vi.unstubAllGlobals());

describe("signing in with a wallet while someone else is signed in", () => {
  it("a plain sign-in is refused, says who is signed in, and never reaches the server's verify", async () => {
    const { verifies } = server(EMAIL_ACCOUNT);
    const w = wallet(BROWSER_WALLET);
    const { result } = renderHook(() => useSiwe(w));
    let ok: boolean | undefined;
    await act(async () => { ok = await result.current.signIn(); });
    expect(ok).toBe(false);
    expect(result.current.conflict).toBe(EMAIL_ACCOUNT);
    expect(verifies).toHaveLength(0);
  });

  it("switching accounts is possible, but only as an explicit replace", async () => {
    const { verifies } = server(EMAIL_ACCOUNT);
    const w = wallet(BROWSER_WALLET);
    const { result } = renderHook(() => useSiwe(w));
    let ok: boolean | undefined;
    await act(async () => { ok = await result.current.signIn({ replace: true }); });
    expect(ok).toBe(true);
    expect(verifies).toEqual([expect.objectContaining({ mode: "signin" })]);
    expect(result.current.conflict).toBeNull();
  });

  it("linking the wallet to the signed-in account is not a conflict: the session stays", async () => {
    const { verifies } = server(EMAIL_ACCOUNT);
    const w = wallet(BROWSER_WALLET);
    const { result } = renderHook(() => useSiwe(w));
    await act(async () => { await result.current.signIn({ mode: "bind" }); });
    expect(verifies).toEqual([expect.objectContaining({ mode: "bind" })]);
    expect(result.current.authedAddress).toBe(EMAIL_ACCOUNT);
  });

  it("the same wallet signing in again, or a first sign-in, goes straight through", async () => {
    for (const session of [BROWSER_WALLET, null]) {
      const { verifies } = server(session);
      const w = wallet(BROWSER_WALLET);
      const { result } = renderHook(() => useSiwe(w));
      let ok: boolean | undefined;
      await act(async () => { ok = await result.current.signIn(); });
      expect(ok, `session ${session}`).toBe(true);
      expect(verifies).toHaveLength(1);
    }
  });
});

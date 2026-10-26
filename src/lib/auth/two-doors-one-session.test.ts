import { beforeEach, describe, expect, it, vi } from "vitest";
import { privateKeyToAccount } from "viem/accounts";

/**
 * TWO DOORS, ONE SESSION (26 Oct 2026: "if we connect with email or MetaMask, things should be the same on
 * both"). An email sign-in (Privy) and a MetaMask sign-in (SIWE) must leave the server with exactly the
 * same session for the same address, so every route downstream (launch, account, submit, payout, records)
 * treats the two people identically. Any difference between them lives in the browser, never here.
 */
const jar = vi.hoisted(() => new Map<string, string>());
vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({
    get: (name: string) => (jar.has(name) ? { name, value: jar.get(name) as string } : undefined),
    set: (name: string, value: string) => void jar.set(name, value),
    delete: (name: string) => void jar.delete(name),
  })),
}));

import { createSessionForVerifiedAddress, getSessionAddress, verifyAndCreateSession } from "./session";
import { buildSiweMessage, NONCE_COOKIE, SESSION_COOKIE } from "./message";

const account = privateKeyToAccount(`0x${"5".repeat(64)}`);
const sessionToken = () => jar.get(SESSION_COOKIE) ?? null;

beforeEach(() => {
  jar.clear();
  vi.stubEnv("SAGE_SESSION_SECRET", "test-secret-for-two-doors-0123456789");
});

describe("an email sign-in and a MetaMask sign-in", () => {
  it("resolve to the same signed-in address", async () => {
    await createSessionForVerifiedAddress(account.address.toLowerCase()); // the email door (Privy reports the wallet)
    const viaEmail = await getSessionAddress();
    jar.clear();

    const nonce = "abcdef0123456789";
    jar.set(NONCE_COOKIE, nonce);
    const issuedAt = new Date().toISOString();
    const signature = await account.signMessage({ message: buildSiweMessage({ address: account.address, nonce, issuedAt }) });
    const viaWallet = await verifyAndCreateSession({ address: account.address, signature, issuedAt });

    expect(viaEmail).toBe(account.address);
    expect(viaWallet).toBe(account.address);
    expect(await getSessionAddress()).toBe(account.address);
  });

  it("write a session token of the same shape", async () => {
    await createSessionForVerifiedAddress(account.address);
    const a = sessionToken();
    expect(a).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    expect(await getSessionAddress()).toBe(account.address);
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";

// No real session cookie in any of these cases, so a non-null result can ONLY come from the dev bypass.
vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({ get: () => undefined, set: () => {}, delete: () => {} })),
}));

import { getSessionAddress } from "./session";

const WALLET = "0x3a60aF43c67dd9D552f180d30d9A042948078341";

/**
 * Auth-adjacent negative test (P19): the dev-session bypass is DOUBLY gated and must be inert anywhere
 * but a development runtime with the explicit flag. This pins the gate so a future refactor can't widen
 * it — the case that matters is "production with the var set → still logged out".
 */
describe("getSessionAddress — dev bypass double gate", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("is INERT in production even with DEV_SESSION_WALLET set (the widening we must never allow)", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("DEV_SESSION_WALLET", WALLET);
    expect(await getSessionAddress()).toBeNull();
  });

  it("is INERT under any NODE_ENV that isn't exactly 'development'", async () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("DEV_SESSION_WALLET", WALLET);
    expect(await getSessionAddress()).toBeNull();
  });

  it("is INERT in development WITHOUT the explicit flag", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("DEV_SESSION_WALLET", "");
    expect(await getSessionAddress()).toBeNull();
  });

  it("activates ONLY in development WITH the flag", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("DEV_SESSION_WALLET", WALLET);
    expect(await getSessionAddress()).toBe(WALLET);
  });
});

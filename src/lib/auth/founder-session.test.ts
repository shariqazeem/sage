import { beforeEach, describe, expect, it, vi } from "vitest";

const evmSession = vi.fn();
const starknetSession = vi.fn();

vi.mock("./session", () => ({ getSessionAddress: () => evmSession() }));
vi.mock("./starknet-session", () => ({ getStarknetSessionAddress: () => starknetSession() }));

const EVM = "0x3a60aF43c67dd9D552f180d30d9A042948078341";
const SN = "0x05db1a00fa6ad44e82de90cae46d82cd5ce052394320d60946ef661db68e3048";

beforeEach(() => {
  evmSession.mockReset().mockResolvedValue(null);
  starknetSession.mockReset().mockResolvedValue(null);
});

describe("getFounderAddress", () => {
  it("accepts a Starknet founder — the whole point of this work", async () => {
    const { getFounderAddress } = await import("./founder");
    starknetSession.mockResolvedValue(SN);
    // Canonicalised on the way out, so it matches whatever spelling the wallet used later.
    expect(await getFounderAddress()).toBe(SN.replace("0x0", "0x"));
  });

  it("accepts an EVM founder exactly as before", async () => {
    const { getFounderAddress } = await import("./founder");
    evmSession.mockResolvedValue(EVM);
    expect(await getFounderAddress()).toBe(EVM.toLowerCase());
  });

  it("prefers the EVM session when BOTH exist, so a returning founder keeps their history", async () => {
    // Switching an existing founder to a Starknet identity because a second cookie happened to be
    // present would orphan every campaign already filed under their EVM address.
    const { getFounderAddress } = await import("./founder");
    evmSession.mockResolvedValue(EVM);
    starknetSession.mockResolvedValue(SN);
    expect(await getFounderAddress()).toBe(EVM.toLowerCase());
  });

  it("is null when nobody is signed in", async () => {
    const { getFounderAddress } = await import("./founder");
    expect(await getFounderAddress()).toBeNull();
  });

  it("rejects a malformed session value rather than passing it through", async () => {
    const { getFounderAddress } = await import("./founder");
    starknetSession.mockResolvedValue("not-an-address");
    expect(await getFounderAddress()).toBeNull();
  });
});

describe("getFounderIdentity", () => {
  it("reports which chain the founder signed in from", async () => {
    const { getFounderIdentity } = await import("./founder");
    starknetSession.mockResolvedValue(SN);
    expect(await getFounderIdentity()).toMatchObject({ chain: "starknet" });

    evmSession.mockResolvedValue(EVM);
    expect(await getFounderIdentity()).toMatchObject({ chain: "evm" });
  });

  it("is null when nobody is signed in", async () => {
    const { getFounderIdentity } = await import("./founder");
    expect(await getFounderIdentity()).toBeNull();
  });
});

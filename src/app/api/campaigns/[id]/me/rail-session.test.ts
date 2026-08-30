import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A RECIPIENT MUST BE ABLE TO SEE THEIR OWN WORK.
 *
 * This route read the EVM session unconditionally. On a Starknet campaign that meant a recipient
 * who had just submitted got `authed: false` and their own submission back as null — invisible to
 * the only person entitled to see it, on a board that would then offer to let them submit it
 * again. It is the same rule the submit route already applies: the CAMPAIGN decides which session
 * counts, because the campaign is what says which wallet gets paid.
 */

const getSessionAddress = vi.fn(async (): Promise<string | null> => null);
const getStarknetSessionAddress = vi.fn(async (): Promise<string | null> => null);
const getWalletMissionSubmission = vi.fn((_m: string, _w: string) => null as unknown);
const getWalletSubmission = vi.fn((_c: string, _w: string) => null as unknown);
const SECRET = "0x496ae11a90f6691a436928269b2e187d7eba99e7051a92673094b7ab80b33f";
let rail: string | undefined = "evm";

vi.mock("@/lib/auth/session", () => ({ getSessionAddress: () => getSessionAddress() }));
vi.mock("@/lib/auth/starknet-session", () => ({
  getStarknetSessionAddress: () => getStarknetSessionAddress(),
}));
vi.mock("@/lib/db/campaigns", () => ({
  getCampaign: (id: string) => (id === "missing" ? null : { id, settlementRail: rail }),
  getDecisionBySubmission: () => null,
  getWalletSubmission: (...a: unknown[]) => getWalletSubmission(...(a as [string, string])),
  getWalletMissionSubmission: (...a: unknown[]) => getWalletMissionSubmission(...(a as [string, string])),
  getMissionByHash: () => null,
  listCampaignEvents: () => [],
}));
vi.mock("@/lib/deputy/decisions", () => ({ briefFromRow: () => null, observationFromRow: () => null }));
vi.mock("@/lib/deputy/observation-verify", () => ({ OBS_MAX_ATTEMPTS: 3 }));
vi.mock("@/lib/deputy/reason-copy", () => ({
  observationCoaching: () => null, observationCriteriaCoaching: () => null,
}));
vi.mock("@/lib/campaigns/slot-reservation", () => ({ RETRY_RESERVATION_MINUTES: 30 }));
vi.mock("@/lib/campaigns/journal", () => ({ decodeDetail: (d: string) => d }));
vi.mock("@/lib/site", () => ({ siteUrl: () => "https://sagepays.xyz" }));

import { GET } from "./route";

const EVM = "0x3a60af43c67dd9d552f180d30d9a042948078341";
const FELT = "0x4f1f6530f84e4a1db7fa35bafc313174a2482a54c775c4321487eb0fe91f434";

const call = async (id = "c1") =>
  (await GET(
    { nextUrl: { searchParams: new URLSearchParams() } } as never,
    { params: Promise.resolve({ id }) },
  )) as Response;

beforeEach(() => {
  rail = "evm";
  getSessionAddress.mockReset().mockResolvedValue(null);
  getStarknetSessionAddress.mockReset().mockResolvedValue(null);
  getWalletSubmission.mockReset().mockReturnValue(null);
  getWalletMissionSubmission.mockReset().mockReturnValue(null);
});

describe("which session a campaign's own board reads", () => {
  it("reads the STARKNET session on a Starknet campaign", async () => {
    rail = "starknet";
    getStarknetSessionAddress.mockResolvedValue(FELT);
    getSessionAddress.mockResolvedValue(EVM); // also connected, and must NOT be the one used
    const json = (await (await call()).json()) as { authed: boolean };
    expect(json.authed).toBe(true);
    expect(getStarknetSessionAddress).toHaveBeenCalled();
    expect(getWalletSubmission).toHaveBeenCalledWith("c1", FELT);
  });

  it("does not fall back to an EVM session on a Starknet campaign", async () => {
    // Falling back would show one wallet's board to a different wallet — and that other wallet is
    // the one that would be paid.
    rail = "starknet";
    getStarknetSessionAddress.mockResolvedValue(null);
    getSessionAddress.mockResolvedValue(EVM);
    const json = (await (await call()).json()) as { authed: boolean; submission: unknown };
    expect(json).toEqual({ authed: false, submission: null });
    expect(getWalletSubmission).not.toHaveBeenCalled();
  });

  it("reads the EVM session on an EVM campaign, exactly as before", async () => {
    getSessionAddress.mockResolvedValue(EVM);
    getStarknetSessionAddress.mockResolvedValue(FELT);
    await call();
    expect(getWalletSubmission).toHaveBeenCalledWith("c1", EVM);
    expect(getStarknetSessionAddress).not.toHaveBeenCalled();
  });

  it("treats a campaign with no rail recorded as EVM", async () => {
    rail = undefined;
    getSessionAddress.mockResolvedValue(EVM);
    await call();
    expect(getWalletSubmission).toHaveBeenCalledWith("c1", EVM);
  });

  it("still 404s an unknown campaign before reading any session", async () => {
    const res = await call("missing");
    expect(res.status).toBe(404);
    expect(getSessionAddress).not.toHaveBeenCalled();
    expect(getStarknetSessionAddress).not.toHaveBeenCalled();
  });
});

/**
 * THE CLAIM LINK REACHES EXACTLY ONE PERSON.
 *
 * A private-rail payout is escrowed behind a commitment rather than sent to an address, so the
 * link IS the money — whoever holds it collects. That is what makes the collection unlinkable, and
 * it is why the secret is confined rather than hardened: this route already resolves a submission
 * from the SESSION WALLET, so it can only ever answer the worker it belongs to.
 */
describe("handing over a private payout", () => {
  const paidPrivately = {
    id: "s1", status: "paid", payoutTx: "0xvault", evidenceUrl: null,
    claimSecret: SECRET, claimCommitment: "12345", claimEscrowTx: "0xescrow",
    attempt: 1,
  };

  it("returns the claim link to the worker whose submission it is", async () => {
    rail = "starknet";
    getStarknetSessionAddress.mockResolvedValue(FELT);
    getWalletSubmission.mockReturnValue(paidPrivately);
    const json = (await (await call()).json()) as {
      submission: { claim: { url: string; commitment: string } | null };
    };
    expect(json.submission.claim?.url).toBe(`https://sagepays.xyz/claim#${SECRET}`);
    expect(json.submission.claim?.commitment).toBe("12345");
  });

  it("returns no claim for a public payout", async () => {
    getSessionAddress.mockResolvedValue(EVM);
    getWalletSubmission.mockReturnValue({ ...paidPrivately, claimSecret: null, claimCommitment: null });
    const json = (await (await call()).json()) as { submission: { claim: unknown } };
    expect(json.submission.claim).toBeNull();
  });

  it("answers nobody at all when the session is not the worker's", async () => {
    // The route resolves the submission FROM the session wallet, so a different wallet simply has
    // no submission here — there is no branch in which someone else's secret is reachable.
    rail = "starknet";
    getStarknetSessionAddress.mockResolvedValue(null);
    getWalletSubmission.mockReturnValue(paidPrivately);
    const json = (await (await call()).json()) as { authed: boolean; submission: unknown };
    expect(json).toEqual({ authed: false, submission: null });
    expect(getWalletSubmission).not.toHaveBeenCalled();
  });
});

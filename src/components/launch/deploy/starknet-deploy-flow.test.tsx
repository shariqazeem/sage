import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { StarknetDeployFlow } from "./starknet-deploy-flow";
import type { PlanView } from "../types";

const PLAN = {
  revision: 1,
  totalBudgetBase: "2000000",
  missions: [
    { missionKey: "m1", title: "Sign up", rewardBase: "500000", maxCompletions: 2 },
    { missionKey: "m2", title: "Report a bug", rewardBase: "500000", maxCompletions: 2 },
  ],
} as unknown as PlanView;

const DEPLOY_PLAN = {
  ok: true,
  classHash: "0x603be1eb",
  operator: "0x46a1747d",
  token: "0x33068f65",
  totalBase: "2000000",
  missions: [
    { title: "Sign up", missionId: "0xaa", rewardBase: "500000", maxCompletions: 2 },
    { title: "Report a bug", missionId: "0xbb", rewardBase: "500000", maxCompletions: 2 },
  ],
  vaultAddress: "0x622f779490fbd8b81e330bea2683608022f7d9f849678288bed21a3db7f9a23",
  calls: [{ contractAddress: "0x41a78e7", entrypoint: "deployContract", calldata: ["0x1"] }],
  deployed: false,
};

const request = vi.fn();
const connect = vi.fn();
let connected: { wallet: { name: string; request: typeof request }; address: string } | null = null;
/** Several installed extensions — the case that dead-ended on "Choose which wallet". */
let installed = [{ id: "ready", name: "Ready", request }];

/** The Fund button renders once a founder is SIGNED IN — `address` falls back to the session, not
 *  to `discovery.connected`. That gap is the bug under test: signed in, button shown, no wallet
 *  resolvable when it is pressed. */
let founderChain: "starknet" | "evm" | null = null;
vi.mock("@/lib/auth/use-founder-session", () => ({
  useFounderSession: () => ({
    address: founderChain ? "0x4f1f65" : null,
    chain: founderChain,
    loading: false,
  }),
}));
vi.mock("@/lib/starknet/use-starknet-wallet", () => ({
  useStarknetWallet: () => ({
    wallets: installed,
    connected,
    connecting: false,
    error: null,
    connect,
    disconnect: vi.fn(),
  }),
}));

const jsonOnce = (body: unknown) => ({ ok: true, json: async () => body }) as Response;

beforeEach(() => {
  connected = null;
  installed = [{ id: "ready", name: "Ready", request }];
  founderChain = null;
  window.localStorage.clear();
  request.mockReset();
  connect.mockReset();
});
afterEach(() => vi.unstubAllGlobals());

describe("the private-capable launch flow", () => {
  it("shows the cost and who owns the vault BEFORE asking to connect a wallet", async () => {
    // A founder should be able to see what this commits them to without connecting anything.
    vi.stubGlobal("fetch", vi.fn(async () => jsonOnce({ ...DEPLOY_PLAN, vaultAddress: undefined, calls: undefined })));
    render(<StarknetDeployFlow jobId="job-1" plan={PLAN} />);

    expect(await screen.findByText("$2.00")).toBeTruthy();
    expect(screen.getByText(/You fund and own this vault/i)).toBeTruthy();
    expect(screen.getByText(/cannot withdraw/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: /Connect Ready/i })).toBeTruthy();
  });

  it("names the amount on the button, so nobody signs a payment blind", async () => {
    connected = { wallet: { name: "Ready", request }, address: "0x05db1a00" };
    vi.stubGlobal("fetch", vi.fn(async () => jsonOnce(DEPLOY_PLAN)));
    render(<StarknetDeployFlow jobId="job-1" plan={PLAN} />);

    expect(await screen.findByRole("button", { name: /Fund \$2\.00 and go live/i })).toBeTruthy();
  });

  it("sends the server's own calls, converted to the shape a wallet accepts", async () => {
    // The mission ids in these calls are the ones settlement will look up. A flow that rebuilt
    // them here could drift, and the vault would refuse every payout after the work was done — so
    // the VALUES pass through untouched.
    //
    // The FIELD NAMES must not. This test previously asserted the calls went "unmodified", which
    // encoded the defect: starknet.js writes `{ contractAddress, entrypoint }` and the wallet RPC
    // requires `{ contract_address, entry_point }`. Ready answered the camelCase payload with
    // INVALID_REQUEST_PAYLOAD at the moment a founder pressed "Fund $1.00 and go live".
    connected = { wallet: { name: "Ready", request }, address: "0x05db1a00" };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) =>
        init?.method === "POST"
          ? jsonOnce({ ok: true, campaignId: "camp-1" })
          : jsonOnce(DEPLOY_PLAN),
      ),
    );
    request.mockResolvedValue({ transaction_hash: "0xfeed" });

    render(<StarknetDeployFlow jobId="job-1" plan={PLAN} />);
    await userEvent.click(await screen.findByRole("button", { name: /Fund/i }));

    await waitFor(() => expect(request).toHaveBeenCalled());
    expect(request.mock.calls[0][0]).toMatchObject({
      type: "wallet_addInvokeTransaction",
      params: {
        calls: DEPLOY_PLAN.calls.map((c) => ({
          contract_address: c.contractAddress,
          entry_point: c.entrypoint,
          calldata: c.calldata,
        })),
      },
    });
  });

  it("goes live only after Sage has verified the vault on chain", async () => {
    connected = { wallet: { name: "Ready", request }, address: "0x05db1a00" };
    // The GET reports the vault once the chain has it. Attaching now WAITS for that, because the
    // wallet answers on submission and the vault does not exist yet at that moment.
    let seenGets = 0;
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === "POST") return jsonOnce({ ok: true, campaignId: "camp-1" });
      seenGets += 1;
      return jsonOnce({ ...DEPLOY_PLAN, deployed: seenGets > 1 });
    });
    vi.stubGlobal("fetch", fetchMock);
    request.mockResolvedValue({ transaction_hash: "0xfeed" });

    render(<StarknetDeployFlow jobId="job-1" plan={PLAN} />);
    await userEvent.click(await screen.findByRole("button", { name: /Fund/i }));

    expect(await screen.findByText(/Your campaign is live/i, {}, { timeout: 8000 })).toBeTruthy();
    const posted = fetchMock.mock.calls.find((c) => (c[1] as RequestInit)?.method === "POST");
    expect(JSON.parse((posted?.[1] as RequestInit).body as string)).toEqual({
      vaultAddress: DEPLOY_PLAN.vaultAddress,
      ownerAddress: "0x05db1a00",
    });
  });

  it("refuses to claim success when Sage rejects the vault", async () => {
    // The verification is the product. A UI that says "live" over a refusal would be worse
    // than no verification at all.
    connected = { wallet: { name: "Ready", request }, address: "0x05db1a00" };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) =>
        init?.method === "POST"
          ? jsonOnce({ error: "That vault is $2.00 short of this plan's budget." })
          : jsonOnce({ ...DEPLOY_PLAN, deployed: true }),
      ),
    );
    request.mockResolvedValue({ transaction_hash: "0xfeed" });

    render(<StarknetDeployFlow jobId="job-1" plan={PLAN} />);
    await userEvent.click(await screen.findByRole("button", { name: /Fund/i }));

    expect(await screen.findByRole("alert", {}, { timeout: 8000 })).toHaveTextContent(/\$2\.00 short/);
    expect(screen.queryByText(/Your campaign is live/i)).toBeNull();
  });

  it("does not ask a founder to pay twice for a vault they already funded", async () => {
    // Resuming an interrupted launch: the vault exists, so the only thing left is attaching.
    connected = { wallet: { name: "Ready", request }, address: "0x05db1a00" };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) =>
        init?.method === "POST"
          ? jsonOnce({ ok: true, campaignId: "camp-1" })
          : jsonOnce({ ...DEPLOY_PLAN, deployed: true }),
      ),
    );

    render(<StarknetDeployFlow jobId="job-1" plan={PLAN} />);
    expect(await screen.findByText(/already funded this vault/i)).toBeTruthy();

    await userEvent.click(screen.getByRole("button", { name: /Open the campaign/i }));
    await waitFor(() => expect(screen.getByText(/Your campaign is live/i)).toBeTruthy());
    // The wallet was never asked to sign anything.
    expect(request).not.toHaveBeenCalled();
  });

  it("says a cancelled signature was cancelled, and lets the founder retry", async () => {
    connected = { wallet: { name: "Ready", request }, address: "0x05db1a00" };
    vi.stubGlobal("fetch", vi.fn(async () => jsonOnce(DEPLOY_PLAN)));
    request.mockRejectedValue(new Error("User rejected request"));

    render(<StarknetDeployFlow jobId="job-1" plan={PLAN} />);
    await userEvent.click(await screen.findByRole("button", { name: /Fund/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/cancelled/i);
    expect(screen.getByRole("button", { name: /Fund \$2\.00 and go live/i })).toBeTruthy();
  });

  it("points a founder without a wallet somewhere useful", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonOnce(DEPLOY_PLAN)));
    vi.resetModules();
    vi.doMock("@/lib/starknet/use-starknet-wallet", () => ({
      useStarknetWallet: () => ({
        wallets: [],
        connected: null,
        connecting: false,
        error: null,
        connect,
        disconnect: vi.fn(),
      }),
    }));
    const { StarknetDeployFlow: Fresh } = await import("./starknet-deploy-flow");
    render(<Fresh jobId="job-1" plan={PLAN} />);
    expect(await screen.findByText(/No Starknet wallet found/i)).toBeTruthy();
  });
});

describe("attaching waits for the chain, not the wallet", () => {
  it("does not attach while the vault is still landing", async () => {
    /**
     * THE DEFECT, PINNED. The wallet answers on SUBMISSION; the vault does not exist yet at that
     * moment. Attaching then read an address with no contract at it and refused with "That address
     * is not a Sage vault" — after the founder had already paid, with the money safely in a vault
     * that was about to appear.
     */
    connected = { wallet: { name: "Ready", request }, address: "0x05db1a00" };
    let gets = 0;
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === "POST") return jsonOnce({ ok: true, campaignId: "camp-1" });
      gets += 1;
      // Not on chain for the first few polls — exactly the window the wallet used to win.
      return jsonOnce({ ...DEPLOY_PLAN, deployed: gets > 2 });
    });
    vi.stubGlobal("fetch", fetchMock);
    // The wallet returns immediately, as a real one does on submission.
    request.mockResolvedValue({ transaction_hash: "0xfeed" });

    render(<StarknetDeployFlow jobId="job-1" plan={PLAN} />);
    await userEvent.click(await screen.findByRole("button", { name: /Fund/i }));

    await screen.findByText(/Your campaign is live/i, {}, { timeout: 8000 });

    // The POST must have happened only after a GET reported the vault deployed.
    const postIndex = fetchMock.mock.calls.findIndex(
      (c) => (c[1] as RequestInit)?.method === "POST",
    );
    const getsBeforePost = fetchMock.mock.calls
      .slice(0, postIndex)
      .filter((c) => (c[1] as RequestInit)?.method !== "POST").length;
    expect(getsBeforePost, "attached before the chain confirmed").toBeGreaterThan(2);
  });
});

/**
 * THE VAULT IS OWNED BY THE WALLET THAT SIGNED IN.
 *
 * This resolved the deployer from `discovery.connected` and a name picked inside this component.
 * Sign-in sets neither, so a founder with Ready, Xverse and MetaMask installed hit "Choose which
 * wallet should own this vault" — an instruction with nothing offering a choice. REPORTED live
 * while funding a gig, already signed in with Ready.
 */
describe("which wallet deploys the vault", () => {
  const multiWallet = () => {
    installed = [
      { id: "xverse", name: "Xverse", request },
      { id: "ready", name: "Ready", request },
      { id: "metamask", name: "MetaMask", request },
    ];
  };
  /** The deploy plan has to load before any button exists to press. */
  const withPlan = () => vi.stubGlobal("fetch", vi.fn(async () => jsonOnce(DEPLOY_PLAN)));
  const fundButton = () => screen.findByRole("button", { name: /Fund|Connect/i });

  it("uses the wallet this session signed in with, not discovery order", async () => {
    multiWallet();
    founderChain = "starknet";
    window.localStorage.setItem("sage.starknet.walletId", "ready");
    connect.mockResolvedValue("0x4f1f65");
    withPlan();
    render(<StarknetDeployFlow jobId="job-1" plan={PLAN} />);
    await userEvent.click(await fundButton());
    await waitFor(() => expect(connect).toHaveBeenCalled());
    // Xverse enumerates first; the wallet that signed in is the one asked.
    expect((connect.mock.calls[0]![0] as { id: string }).id).toBe("ready");
  });

  it("still refuses when nothing identifies the wallet — rather than guessing an owner", async () => {
    // Picking one here would deploy a founder's vault from a wallet they did not choose.
    founderChain = "starknet";
    multiWallet();
    withPlan();
    render(<StarknetDeployFlow jobId="job-1" plan={PLAN} />);
    await userEvent.click(await fundButton());
    expect(await screen.findByText(/choose which wallet/i)).toBeTruthy();
    expect(connect).not.toHaveBeenCalled();
  });

  it("needs no hint when only one wallet is installed", async () => {
    founderChain = "starknet";
    connect.mockResolvedValue("0x4f1f65");
    withPlan();
    render(<StarknetDeployFlow jobId="job-1" plan={PLAN} />);
    await userEvent.click(await fundButton());
    await waitFor(() => expect(connect).toHaveBeenCalled());
  });
});

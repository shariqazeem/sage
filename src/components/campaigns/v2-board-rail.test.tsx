import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

/**
 * A SIGNED-IN STARKNET TESTER MUST BE ABLE TO SUBMIT.
 *
 * REPORTED FROM THE LIVE CAMPAIGN: connected with Ready, signed in, and the mission card offered
 * nothing at all — no button, no form. The rail branch handled BOTH the signed-out and signed-in
 * cases, and the signed-in one rendered `null`:
 *
 *     rail === "starknet" ? (starknet.authed ? null : <Gate/>)
 *       : !siwe.authed ? (EVM sign-in)
 *       : !open ? (<button>Submit evidence</button>)   <- only reachable on EVM
 *       : (formBlock)
 *
 * So the SNIP-12 signing path added the night before was unreachable: the callback existed and
 * nothing could ever call it. Only the signed-OUT case may branch by rail; once a wallet has
 * proved itself, both rails converge on the same submit UI.
 */

const snState = {
  wallets: [{ id: "ready", name: "Ready", request: vi.fn() }],
  address: null as string | null,
  authed: false,
  signingIn: false,
  loading: false,
  error: null as string | null,
  signIn: vi.fn(),
  signOut: vi.fn(),
  signTypedData: vi.fn(async () => ["0x1"]),
};
const siweState = {
  authed: false,
  address: null as string | null,
  authedAddress: null as string | null,
  signingIn: false,
  signIn: vi.fn(),
  signOut: vi.fn(),
  refresh: vi.fn(async () => undefined),
};
/** the embedded wallet an email sign-in holds — null until a test sets one */
const embeddedState = { wallet: null as { address: `0x${string}`; getWalletClient: () => Promise<null> } | null };

vi.mock("@/lib/auth/use-starknet-siwe", () => ({ useStarknetSiwe: () => snState }));
vi.mock("@/lib/auth/use-siwe", () => ({ useSiwe: () => siweState }));
vi.mock("@/components/auth/email-sign-in", () => ({ EmailSignIn: () => <button type="button">Continue with email</button> }));
vi.mock("./embedded-wallet-bridge", async () => {
  const React = await import("react");
  return {
    EmbeddedWalletBridge: ({ onChange }: { onChange: (w: unknown) => void }) => {
      React.useEffect(() => { onChange(embeddedState.wallet); }, [onChange]);
      return null;
    },
  };
});
vi.mock("@/lib/wallet/use-wallet", () => ({
  useWallet: () => ({ address: null, getWalletClient: () => null }),
}));

import { V2Board } from "./v2-board";

const mission = {
  missionKey: "contract-token-transfers-tab",
  missionIdHash: `0x${"3a".repeat(32)}`,
  specDigest: `0x${"bb".repeat(32)}`,
  title: "Verify a contract's Token Transfers tab loads",
  objective: "Check the transfers tab",
  instructions: "Open the tab and report what you saw.",
  targetSurface: "https://starkscan.co/",
  criteria: ["The rows are populated"],
  evidenceList: ["Describe what you saw"],
  rewardBase: 500_000,
  maxCompletions: 2,
  paidCompletions: 0,
  full: false,
  verifiabilityClass: "observation-based",
};

const board = (rail: "evm" | "starknet") =>
  render(
    <V2Board
      campaignId="launch-starkscan-co-s2k7yd"
      campaignIdHash={`0x${"cc".repeat(32)}`}
      chainId={900_001}
      live
      missions={[mission as never]}
      rail={rail}
    />,
  );

beforeEach(() => {
  Object.assign(snState, { address: null, authed: false, signingIn: false, loading: false, error: null });
  Object.assign(siweState, { authed: false, address: null, authedAddress: null, signingIn: false });
  embeddedState.wallet = null;
  process.env.NEXT_PUBLIC_PRIVY_LOGIN_APP_ID = "app_test";
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ submission: null }), { status: 200 })));
});

describe("the submit control a Starknet tester is offered", () => {
  it("offers a way to SUBMIT once the Starknet wallet is signed in", async () => {
    snState.authed = true;
    snState.address = "0x4f1f6530f84e4a1db7fa35bafc313174a2482a54c775c4321487eb0fe91f434";
    board("starknet");
    // The exact failure reported: signed in, and the card rendered nothing to act on.
    expect(await screen.findByRole("button", { name: /submit evidence/i })).toBeTruthy();
  });

  it("offers the STARKNET sign-in when not signed in — never the EVM one", async () => {
    board("starknet");
    expect(screen.queryByRole("button", { name: /submit evidence/i })).toBeNull();
    // Ready is discovered; the EVM "Connect wallet" copy must not appear on this rail.
    expect(screen.queryByText(/connect wallet to submit/i)).toBeNull();
  });

  it("does not accept an EVM session as sign-in on the private rail", async () => {
    // The wallet that signs in is the wallet that gets PAID. Letting an EVM session through here
    // would offer the form to a wallet the vault can never pay.
    siweState.authed = true;
    siweState.address = "0x3a60af43c67dd9d552f180d30d9a042948078341";
    board("starknet");
    expect(screen.queryByRole("button", { name: /submit evidence/i })).toBeNull();
  });

  it("leaves the EVM rail exactly as it was", async () => {
    siweState.authed = true;
    siweState.address = "0x3a60af43c67dd9d552f180d30d9a042948078341";
    board("evm");
    expect(await screen.findByRole("button", { name: /submit evidence/i })).toBeTruthy();
  });

  it("still shows the EVM sign-in on the EVM rail when signed out", async () => {
    board("evm");
    expect(await screen.findByText(/connect wallet to submit|sign in to submit/i)).toBeTruthy();
  });
});

/**
 * EARN WITH AN EMAIL. A worker who signed in by email holds a Privy embedded wallet and a Sage
 * session bound to it. The board read that as signed OUT — it only knew the injected provider — so
 * the one control that pays never appeared. The injected wallet keeps precedence; the email door is
 * offered only where there is no wallet at all, and only on the public rail (an embedded wallet is
 * an EVM wallet, which the private rail can never pay).
 */
describe("a worker who signed in by email", () => {
  it("is signed in on the public rail when the session is the embedded wallet's own", async () => {
    embeddedState.wallet = { address: "0x3a60af43c67dd9d552f180d30d9a042948078341", getWalletClient: async () => null };
    siweState.authedAddress = "0x3A60AF43C67DD9D552F180D30D9A042948078341";
    board("evm");
    expect(await screen.findByRole("button", { name: /submit evidence/i })).toBeTruthy();
    expect(screen.queryByText(/connect wallet to submit/i)).toBeNull();
  });

  it("is offered the email door beside the wallet one when signed out on the public rail", async () => {
    board("evm");
    expect(await screen.findByText(/connect wallet to submit/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: /continue with email/i })).toBeTruthy();
  });

  it("is not offered the email door on the private rail — an embedded wallet cannot be paid there", async () => {
    board("starknet");
    await waitFor(() => expect(screen.queryByRole("button", { name: /continue with email/i })).toBeNull());
  });

  it("an embedded wallet that is not the session's own is not signed in", async () => {
    embeddedState.wallet = { address: "0x3a60af43c67dd9d552f180d30d9a042948078341", getWalletClient: async () => null };
    siweState.authedAddress = "0x0000000000000000000000000000000000000001";
    board("evm");
    expect(await screen.findByText(/connect wallet to submit/i)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /submit evidence/i })).toBeNull();
  });
});

/**
 * WHAT A PAID WORKER IS SHOWN, PER RAIL.
 *
 * A public payout is announced — it already landed at their address, and the receipt is a link to
 * the transaction. A private one is HANDED OVER: the money is escrowed behind a commitment and
 * they open it themselves, so what they need is the link and the warning that comes with it.
 * Showing the wrong one leaves someone either hunting a transaction that does not exist, or
 * holding a bearer secret nobody told them was a bearer secret.
 */
describe("what a paid worker is shown", () => {
  const paid = (over: Record<string, unknown>) => ({
    id: "s1", status: "paid", payoutTx: "0xvault", brief: null, observation: null,
    retry: null, autopay: null, claim: null, ...over,
  });

  const withMine = (sub: Record<string, unknown>) => {
    vi.stubGlobal("fetch", vi.fn(async () =>
      new Response(JSON.stringify({ authed: true, submission: sub }), { status: 200 })));
  };

  it("hands over the link, and says the link IS the money", async () => {
    snState.authed = true;
    snState.address = "0x4f1f6530f84e4a1db7fa35bafc313174a2482a54c775c4321487eb0fe91f434";
    withMine(paid({ claim: { url: "https://sagepays.xyz/claim#0xabc", commitment: "1" } }));
    board("starknet");
    expect(await screen.findByText(/is yours to collect/i)).toBeTruthy();
    // Someone who does not know it is a bearer secret will paste it somewhere.
    expect(await screen.findByText(/this link is the money/i)).toBeTruthy();
    expect(screen.getByRole("link", { name: /collect/i }).getAttribute("href")).toBe(
      "https://sagepays.xyz/claim#0xabc",
    );
  });

  it("does not show a transaction receipt for money that has not been collected yet", async () => {
    snState.authed = true;
    snState.address = "0x4f1f6530f84e4a1db7fa35bafc313174a2482a54c775c4321487eb0fe91f434";
    withMine(paid({ claim: { url: "https://sagepays.xyz/claim#0xabc", commitment: "1" } }));
    board("starknet");
    await screen.findByText(/is yours to collect/i);
    // The vault paid Sage, not them. A receipt here would be pointing at somebody else's payment.
    expect(screen.queryByText(/share/i)).toBeNull();
  });

  it("shows the ordinary receipt when there is no claim — the public rail is untouched", async () => {
    siweState.authed = true;
    siweState.address = "0x3a60af43c67dd9d552f180d30d9a042948078341";
    withMine(paid({ claim: null }));
    board("evm");
    // Whatever the paid state renders on the public rail, it is NOT the handover.
    await waitFor(() => expect(screen.queryByText(/is yours to collect/i)).toBeNull());
  });
});

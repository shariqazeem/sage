import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";

import { SubmitPanel } from "./submit-panel";

/**
 * THE SIGN-IN A TESTER IS OFFERED MUST MATCH THE RAIL THAT PAYS THEM.
 *
 * Before this, a private-capable campaign showed the EVM connect button, the tester signed in,
 * did the work, and the submit API refused them: "use a Starknet wallet" — on a page with no way
 * to do that. A dead end reached only after the work was finished.
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
};

vi.mock("@/lib/auth/use-starknet-siwe", () => ({ useStarknetSiwe: () => snState }));
vi.mock("@/lib/auth/use-siwe", () => ({
  useSiwe: () => ({
    authed: false,
    address: null,
    signingIn: false,
    signIn: vi.fn(),
    signOut: vi.fn(),
  }),
}));

beforeEach(() => {
  Object.assign(snState, {
    wallets: [{ id: "ready", name: "Ready", request: vi.fn() }],
    address: null,
    authed: false,
    signingIn: false,
    loading: false,
    error: null,
  });
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ submission: null }) })));
});
afterEach(() => vi.unstubAllGlobals());

describe("which wallet a tester is asked for", () => {
  it("asks for a Starknet wallet on a Starknet campaign, by name", () => {
    render(<SubmitPanel campaignId="c1" live rail="starknet" />);
    expect(screen.getByRole("button", { name: /Ready/i })).toBeTruthy();
  });

  it("offers several wallets as ONE list, not as competing primary buttons", () => {
    // The design property, asserted rather than described: two installed wallets are a choice with
    // a single visual weight. A row of primary buttons gives a person two identical calls to
    // action and nothing to choose between them.
    snState.wallets = [
      { id: "ready", name: "Ready", request: vi.fn() },
      { id: "braavos", name: "Braavos", request: vi.fn() },
    ];
    const { container } = render(<SubmitPanel campaignId="c1" live rail="starknet" />);
    expect(container.querySelector(".wc-list")).toBeTruthy();
    expect(container.querySelectorAll(".wc-row")).toHaveLength(2);
    // …and no filled primary button competing with the list.
    expect(container.querySelector(".wc-single")).toBeNull();
  });

  it("keeps the primary-button weight when there is exactly one wallet", () => {
    // One option is one action — a single-item list would be a menu with nothing to decide.
    const { container } = render(<SubmitPanel campaignId="c1" live rail="starknet" />);
    expect(container.querySelector(".wc-single")).toBeTruthy();
    expect(container.querySelector(".wc-list")).toBeNull();
  });

  it("renders both rails through the SAME component, so they cannot drift apart", () => {
    const sn = render(<SubmitPanel campaignId="c1" live rail="starknet" />);
    expect(sn.container.querySelector(".wc")).toBeTruthy();
    sn.unmount();
    const evm = render(<SubmitPanel campaignId="c2" live rail="evm" />);
    expect(evm.container.querySelector(".wc")).toBeTruthy();
  });

  it("says WHY, so the wallet switch does not read as an obstacle", () => {
    render(<SubmitPanel campaignId="c1" live rail="starknet" />);
    expect(screen.getByText(/that is the address you.{0,3}ll be paid at/i)).toBeTruthy();
  });

  it("keeps the EVM sign-in on a public campaign", () => {
    render(<SubmitPanel campaignId="c1" live rail="evm" />);
    expect(screen.getByRole("button", { name: /Connect your wallet/i })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Ready/i })).toBeNull();
  });

  it("defaults to the EVM sign-in when no rail is given", () => {
    render(<SubmitPanel campaignId="c1" live />);
    expect(screen.getByRole("button", { name: /Connect your wallet/i })).toBeTruthy();
  });

  it("points a tester with no Starknet wallet somewhere they can get one", () => {
    snState.wallets = [];
    render(<SubmitPanel campaignId="c1" live rail="starknet" />);
    expect(screen.getByText(/No Starknet wallet found/i)).toBeTruthy();
    expect(screen.getByRole("link", { name: /Ready/i })).toBeTruthy();
  });

  it("waits rather than asking a signed-in tester to sign again", () => {
    // The session cookie is still being read. A connect button here would ask someone who is
    // already signed in to sign a second time for no reason.
    snState.loading = true;
    render(<SubmitPanel campaignId="c1" live rail="starknet" />);
    expect(screen.getByText(/Checking your wallet/i)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Sign in with/i })).toBeNull();
  });

  it("shows a failed signature instead of silently doing nothing", () => {
    snState.error = "You cancelled the signature.";
    render(<SubmitPanel campaignId="c1" live rail="starknet" />);
    expect(screen.getByRole("alert")).toHaveTextContent(/cancelled/i);
  });

  it("lets a signed-in Starknet tester through to the form", () => {
    snState.authed = true;
    snState.address = "0x05db1a00fa6ad44e82de90cae46d82cd5ce052394320d60946ef661db68e3048";
    const { container } = render(<SubmitPanel campaignId="c1" live rail="starknet" />);
    expect(screen.queryByText(/No Starknet wallet found/i)).toBeNull();
    expect(container.querySelector(".wc")).toBeNull();
  });
});

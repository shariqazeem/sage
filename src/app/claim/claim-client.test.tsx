import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ClaimClient } from "./claim-client";

/**
 * The states a worker can land in, pinned.
 *
 * This screen is the last thing standing between someone and money they have earned, and most of
 * its states are failure states. Each one has to say something true and act-on-able — "already
 * collected" and "never existed" are different facts and must not collapse into one message.
 */

const SECRET = "0x0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f";

function landOn(hash: string): void {
  window.history.replaceState({}, "", `/claim${hash}`);
}

const okStatus = (over: Record<string, unknown> = {}) => ({
  ok: true,
  json: async () => ({ exists: true, claimed: false, amountUsd: 1.4, ...over }),
});

beforeEach(() => landOn(""));
afterEach(() => vi.unstubAllGlobals());

describe("the collection screen", () => {
  it("says so plainly when the link carries no secret", async () => {
    render(<ClaimClient claims={null} token={null} />);
    expect(await screen.findByText(/isn.t a claim link/i)).toBeTruthy();
  });

  it("offers the payout when one is waiting", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => okStatus()));
    landOn(`#${SECRET}`);
    render(<ClaimClient claims={null} token={null} />);
    expect(await screen.findByText("$1.40")).toBeTruthy();
    expect(screen.getByRole("button", { name: /collect \$1\.40/i })).toBeTruthy();
  });

  /** Only the commitment may leave the browser — never the thing that owns the money. */
  it("never puts the secret in the status request", async () => {
    const seen: string[] = [];
    const f = vi.fn(async (url: string) => {
      seen.push(url);
      return okStatus();
    });
    vi.stubGlobal("fetch", f);
    landOn(`#${SECRET}`);
    render(<ClaimClient claims={null} token={null} />);
    await screen.findByText("$1.40");
    expect(seen).toHaveLength(1);
    expect(seen[0]).not.toContain(SECRET);
    // ...and it DID send the commitment, so the check is not passing by sending nothing.
    expect(seen[0]).toMatch(/commitment=\d+/);
  });

  it("will not submit until an address looks like one", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => okStatus()));
    landOn(`#${SECRET}`);
    render(<ClaimClient claims={null} token={null} />);
    await screen.findByText("$1.40");

    const button = screen.getByRole("button", { name: /collect/i });
    expect(button.hasAttribute("disabled")).toBe(true);

    await userEvent.type(screen.getByRole("textbox"), "my paypal");
    expect(button.hasAttribute("disabled")).toBe(true);
  });

  it("tells a used link apart from a wrong one", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => okStatus({ claimed: true })));
    landOn(`#${SECRET}`);
    render(<ClaimClient claims={null} token={null} />);
    expect(await screen.findByText(/already collected/i)).toBeTruthy();

    vi.stubGlobal("fetch", vi.fn(async () => okStatus({ exists: false })));
    render(<ClaimClient claims={null} token={null} />);
    expect(await screen.findByText(/nothing is waiting/i)).toBeTruthy();
  });

  /** A network wobble must never read as "your money is gone". */
  it("reassures rather than alarms when the chain cannot be reached", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, json: async () => ({}) })));
    landOn(`#${SECRET}`);
    render(<ClaimClient claims={null} token={null} />);
    expect(await screen.findByText(/couldn.t check your link/i)).toBeTruthy();
    expect(screen.getByText(/money is unaffected/i)).toBeTruthy();
  });

  it("confirms with a verifiable transaction once it lands", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) =>
        init?.method === "POST"
          ? { ok: true, json: async () => ({ txHash: "0xdeadbeef" }) }
          : okStatus(),
      ),
    );
    landOn(`#${SECRET}`);
    render(<ClaimClient claims={null} token={null} />);
    await screen.findByText("$1.40");

    await userEvent.type(screen.getByRole("textbox"), "0x05aa");
    await userEvent.click(screen.getByRole("button", { name: /collect/i }));

    await waitFor(() => expect(screen.getByText(/on its way/i)).toBeTruthy());
    const link = screen.getByRole("link", { name: /view the transaction/i });
    expect(link.getAttribute("href")).toBe("https://voyager.online/tx/0xdeadbeef");
  });

  it("surfaces the server's refusal instead of a generic failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) =>
        init?.method === "POST"
          ? { ok: false, json: async () => ({ error: "This payout has already been collected." }) }
          : okStatus(),
      ),
    );
    landOn(`#${SECRET}`);
    render(<ClaimClient claims={null} token={null} />);
    await screen.findByText("$1.40");

    await userEvent.type(screen.getByRole("textbox"), "0x05aa");
    await userEvent.click(screen.getByRole("button", { name: /collect/i }));

    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.getByText(/already been collected/i)).toBeTruthy();
  });
});

describe("the private door", () => {
  const CLAIMS = "0x6fe4d02056825f06683604f8a98912504cf86bce0de5ff19b424995eb1cf57";
  const TOKEN = "0x033068f6539f8e6e6b131e6b2b814e6c34a5224bc66947c47dab9dfee93b35fb";

  /**
   * The public door has to work when Starknet settlement is unconfigured or misconfigured, because
   * it is the one most of Sage's recipients can actually use. A missing config must degrade the
   * page, not break it.
   */
  it("is absent when the deployment is not configured", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => okStatus()));
    landOn(`#${SECRET}`);
    render(<ClaimClient claims={null} token={null} />);
    await screen.findByText("$1.40");
    expect(screen.queryByText(/private note/i)).toBeNull();
    // ...but the public door is still fully usable.
    expect(screen.getByRole("button", { name: /collect \$1\.40/i })).toBeTruthy();
  });

  it("is offered under the public door, never instead of it", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => okStatus()));
    landOn(`#${SECRET}`);
    render(<ClaimClient claims={CLAIMS} token={TOKEN} />);
    await screen.findByText("$1.40");
    expect(screen.getByText(/private note/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: /collect \$1\.40/i })).toBeTruthy();
  });

  /** With no wallet injected there is nothing to click, and saying so beats a dead button. */
  it("explains rather than offering a button when no wallet is present", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => okStatus()));
    landOn(`#${SECRET}`);
    render(<ClaimClient claims={CLAIMS} token={TOKEN} />);
    await screen.findByText("$1.40");
    expect(screen.queryByRole("button", { name: /collect privately/i })).toBeNull();
  });
});

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { LenderClient } from "./lender-client";

const record = (over: Record<string, unknown> = {}) => ({
  ok: true,
  wallet: "0x00000000000000000000000000000000000000aa",
  completions: 3,
  amountsWithheld: false,
  entries: [
    {
      at: 1_756_000_000,
      campaignTitle: "Logo gig",
      missionTitle: "Deliver the logo",
      kind: "gig",
      amountUsd: 300,
      txHash: "0xaaa",
      proofUrl: "https://sagepays.xyz/proof/0xaaa",
    },
  ],
  signals: {
    formulaVersion: "credit-signals-v2",
    completions: 3,
    completions30d: 1,
    completions90d: 3,
    distinctPayers: 2,
    monthsActive: 3,
    verificationPassRate: 0.75,
    decidedSubmissions: 4,
    daysSinceLastVerified: 5,
    tenureDays: 70,
    topPayerShare: 0.75,
    payerConcentration: 0.625,
    verifiedInflowUsd: 900,
    inflow30dUsd: 300,
    inflow90dUsd: 900,
  },
  ...over,
});

const look = async (body: unknown, ok = true) => {
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok, json: async () => body })));
  render(<LenderClient />);
  await userEvent.type(screen.getByLabelText(/wallet address/i), "0xaa");
  await userEvent.click(screen.getByRole("button", { name: /look up/i }));
};

afterEach(() => vi.unstubAllGlobals());

describe("the lender view", () => {
  it("shows the underwriting inputs a credit decision turns on", async () => {
    await look(record());
    await waitFor(() => expect(screen.getByText(/verified inflow, 90d/i)).toBeTruthy());
    // $900 appears both as the 90d inflow and inside the calculation line, so scope to the stat.
    expect(screen.getAllByText("$900.00").length).toBeGreaterThan(0);
    expect(screen.getByText(/largest funder share/i)).toBeTruthy();
    expect(screen.getAllByText("75%").length).toBeGreaterThan(0);
  });

  /**
   * THE DISCIPLINE THIS PAGE EXISTS TO HOLD. It would be easy to print a number and call it
   * creditworthiness. Sage has no business judging a borrower it has never met, so the multiple is
   * the lender's input and the output is labelled as their calculation.
   */
  it("applies the LENDER's multiple and says whose calculation it is", async () => {
    await look(record());
    await waitFor(() => expect(screen.getAllByText("$900.00").length).toBeGreaterThan(0));
    // 900 / 3 = 300 monthly, × 2 = 600 — read from the calculation element specifically.
    const out = document.querySelector(".lend-calc-out")?.textContent ?? "";
    expect(out).toContain("$600.00");
    expect(out).toContain("$300.00 monthly");
    // The disclaimer appears in the lede AND beside the number. Both are deliberate — assert it
    // is present where the FIGURE is, which is the place it actually has to be.
    const note = document.querySelector(".lend-calc-note")?.textContent ?? "";
    expect(note).toMatch(/not Sage.s recommendation/i);
    expect(note).toMatch(/computes no credit score/i);
  });

  it("recomputes when the lender changes their multiple", async () => {
    await look(record());
    await waitFor(() =>
      expect(document.querySelector(".lend-calc-out")?.textContent).toContain("$600.00"),
    );
    const input = screen.getByLabelText(/your multiple/i);
    await userEvent.clear(input);
    await userEvent.type(input, "4");
    await waitFor(() =>
      expect(document.querySelector(".lend-calc-out")?.textContent).toContain("$1,200.00"),
    );
  });

  /** A withheld record must not read as a lender-blocking failure, nor invent a number. */
  it("explains a withheld record instead of showing a figure", async () => {
    await look(record({ amountsWithheld: true, signals: { ...record().signals, inflow90dUsd: undefined } }));
    await waitFor(() => expect(screen.getByText(/withheld their amounts/i)).toBeTruthy());
    expect(screen.getByText(/signed statement of earnings/i)).toBeTruthy();
  });

  /**
   * No history is NO SIGNAL, and must not be presented as a bad one — that is how a credit tool
   * quietly becomes a way to deny people for being new.
   */
  it("says an empty record is no signal, not a bad one", async () => {
    await look(record({ completions: 0, entries: [] }));
    await waitFor(() => expect(screen.getByText(/no signal at all/i)).toBeTruthy());
  });
});

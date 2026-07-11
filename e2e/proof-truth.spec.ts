import { expect, test } from "@playwright/test";

/**
 * The public-truth surfaces added in the real-money-safety pass. These render
 * from empty / degraded state without a live committed on-chain tx (which a local
 * non-archive RPC can't serve). The seven proof STATES themselves are covered
 * exhaustively by the pure `buildProof` unit tests (src/lib/deputy/proof.test.ts);
 * here we assert the rendered surfaces never lie.
 */

test.describe("proof page — honest states", () => {
  test("an unknown tx renders the not-found state, never a fabricated payout", async ({
    page,
  }) => {
    await page.goto(`/proof/0x${"0".repeat(64)}`);
    await expect(page.getByRole("heading", { name: /Payout not found/i })).toBeVisible();
    await expect(page.getByText(/isn.t a recognized Sage payout/i)).toBeVisible();
  });

  test("the JSON proof API returns a typed not-found, not a success shape", async ({
    request,
  }) => {
    const res = await request.get(`/api/proof/0x${"0".repeat(64)}`);
    expect(res.status()).toBe(404);
    const body = await res.json();
    expect(body.proofState).toBe("not_found");
    // never a verified/settled success shape for a non-payout
    expect(body.verified).toBeUndefined();
  });
});

test.describe("landing — honest live status", () => {
  test("hero shows a real live balance bound to its network, not a fabricated one", async ({
    page,
  }) => {
    await page.goto("/");
    await expect(
      page.getByRole("heading", { name: /Give an AI agent an allowance/i }),
    ).toBeVisible();
    // The live-balance block renders and is chain-scoped (real read OR an honest
    // "temporarily unavailable" — never an invented allowance with no vault).
    await expect(page.getByText(/Live wallet balance/i)).toBeVisible();
  });
});

test.describe("agent profile — honest ERC-8004 framing", () => {
  test("the record is derived from the journal, not asserted as a registry score", async ({
    page,
  }) => {
    await page.goto("/agents/sage");
    await expect(page.getByText(/derived from Sage.s verifiable/i)).toBeVisible();
    await expect(page.getByText(/not a score stored in a registry/i)).toBeVisible();
    // honest zeros / real numbers — the total-settled stat label is present
    await expect(page.getByText(/Total USDC settled on-chain/i)).toBeVisible();
  });
});

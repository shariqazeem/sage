import { expect, test, type Page } from "@playwright/test";
import { installInjectedWallet } from "./support/injected-wallet";

/**
 * The tester loop through the ACTUAL production board + routes + pipeline, driven by an
 * injected EIP-1193 wallet with REAL signatures (SIWE + the EIP-712 evidence commitment).
 * The E2E server has no LLM key and no operator key, so the pipeline preflight-holds — this
 * test NEVER broadcasts a real payout. It proves the signed-evidence journey: open the V2
 * board → connect → sign the exact evidence commitment → submit → the real submission is
 * created and enters the pipeline (status polling), and a duplicate is blocked.
 */

async function seedTesterCampaign(page: Page): Promise<string | null> {
  const res = await page.request.post("/api/testkit/seed?kind=tester");
  if (res.status() === 404) return null; // SAGE_E2E off — skip
  const data = await res.json();
  expect(data.ok, JSON.stringify(data)).toBeTruthy();
  return data.campaignId as string;
}

async function signInAndOpenForm(page: Page) {
  // The injected wallet is already "connected" (eth_accounts). Sign in via SIWE.
  await page.getByRole("button", { name: /Connect wallet to submit|Sign in to submit/i }).first().click();
  await expect(page.getByRole("button", { name: /Submit evidence/i }).first()).toBeVisible({ timeout: 20_000 });
  await page.getByRole("button", { name: /Submit evidence/i }).first().click();
  await page.getByPlaceholder(/public link to your proof/i).fill("https://demo.example/app");
  await page.getByPlaceholder(/Quote the exact text/i).fill('The page loads and says "a gentle world to heal".');
}

test.describe("tester loop — signed evidence → real pipeline", () => {
  test("open V2 board → connect → sign EIP-712 evidence → submit → reviewing", async ({ page }) => {
    await installInjectedWallet(page);
    const id = await seedTesterCampaign(page);
    test.skip(!id, "SAGE_E2E not enabled on the server");

    await page.goto(`/c/${id}`);
    // Real economics + testnet truth (PART B) + the mission.
    await expect(page.getByText(/test mUSDC/i).first()).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText("Verify the landing page loads")).toBeVisible();
    await expect(page.getByText(/no monetary value/i)).toBeVisible();

    await signInAndOpenForm(page);
    await page.getByRole("button", { name: /Sign \+ submit evidence/i }).click();

    // The submission was created and is in the real pipeline (no fabricated progress).
    await expect(page.getByText(/reviewing your evidence|Held|Verified|did not meet|Paid/i).first()).toBeVisible({ timeout: 30_000 });
    // The form is gone — the tester is now watching their entry, not resubmitting.
    await expect(page.getByRole("button", { name: /Sign \+ submit evidence/i })).toHaveCount(0);
  });

  test("a duplicate submission to the same mission is blocked", async ({ page }) => {
    await installInjectedWallet(page);
    const id = await seedTesterCampaign(page);
    test.skip(!id, "SAGE_E2E not enabled on the server");

    await page.goto(`/c/${id}`);
    await signInAndOpenForm(page);
    await page.getByRole("button", { name: /Sign \+ submit evidence/i }).click();
    await expect(page.getByText(/reviewing your evidence|Held|Verified|Paid/i).first()).toBeVisible({ timeout: 30_000 });

    // Reload → the tester sees their existing entry (status), not a fresh form → no resubmit.
    await page.reload();
    await expect(page.getByText(/reviewing your evidence|Held|Verified|Paid/i).first()).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole("button", { name: /^Submit evidence$/i })).toHaveCount(0);
  });

  test("mobile 375: the board + mission render without horizontal overflow", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await installInjectedWallet(page);
    const id = await seedTesterCampaign(page);
    test.skip(!id, "SAGE_E2E not enabled on the server");
    await page.goto(`/c/${id}`);
    await expect(page.getByText("Verify the landing page loads")).toBeVisible({ timeout: 15_000 });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
    expect(overflow).toBeFalsy();
  });
});

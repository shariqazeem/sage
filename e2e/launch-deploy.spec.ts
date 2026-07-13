import { expect, test, type Page } from "@playwright/test";
import { installInjectedWallet } from "./support/injected-wallet";

/**
 * The founder deployment E2E: an approved plan → a live, founder-owned campaign, driven
 * through the ACTUAL production UI + routes + durable state machine with an injected EIP-
 * 1193 wallet (real signatures) and the server's SAGE_E2E deterministic fake chain. No
 * automated test broadcasts to a real chain. Reaching "Your campaign is live." is the bar.
 */

async function seedPlan(page: Page): Promise<string | null> {
  const res = await page.request.post("/api/testkit/seed");
  if (res.status() === 404) return null; // SAGE_E2E not enabled — skip
  const data = await res.json();
  expect(data.ok, JSON.stringify(data)).toBeTruthy();
  return data.jobId as string;
}

async function openApprovedPlan(page: Page, jobId: string) {
  await page.goto(`/launch/${jobId}`);
  await expect(page.getByRole("button", { name: /Secure plan ownership/i })).toBeVisible({ timeout: 15_000 });
}

async function claimThroughPreview(page: Page) {
  await page.getByRole("button", { name: /Secure plan ownership/i }).click();
  await expect(page.getByRole("button", { name: /Review deployment/i })).toBeVisible({ timeout: 20_000 });
  await page.getByRole("button", { name: /Review deployment/i }).click();
  await expect(page.getByRole("button", { name: /Create and fund campaign/i })).toBeVisible({ timeout: 20_000 });
}

test.describe("founder deployment — approved plan → live campaign", () => {
  test("sequential wallet: claim → limits → preview → create → approve → fund → activate → live", async ({ page }) => {
    await installInjectedWallet(page);
    const jobId = await seedPlan(page);
    test.skip(!jobId, "SAGE_E2E not enabled on the server");

    await openApprovedPlan(page, jobId!);
    await claimThroughPreview(page);

    await page.getByRole("button", { name: /Create and fund campaign/i }).click();

    await expect(page.getByText("Your campaign is live.")).toBeVisible({ timeout: 40_000 });
    await expect(page.getByText(/Sage cannot withdraw these funds/i)).toBeVisible();
    // 07-C: LiveSuccess routes to the founder console, with the public board as secondary.
    await expect(page.getByRole("link", { name: /Open campaign console/i })).toBeVisible();
    await expect(page.getByRole("link", { name: /View public tester board/i })).toBeVisible();

    // Refresh: the live state must persist (durable), not restart.
    await page.reload();
    await expect(page.getByText("Your campaign is live.")).toBeVisible({ timeout: 20_000 });
  });

  test("refresh mid-flow resumes from durable state (no re-signing the claim)", async ({ page }) => {
    await installInjectedWallet(page);
    const jobId = await seedPlan(page);
    test.skip(!jobId, "SAGE_E2E not enabled on the server");

    await openApprovedPlan(page, jobId!);
    // Claim only, then reload BEFORE deploying.
    await page.getByRole("button", { name: /Secure plan ownership/i }).click();
    await expect(page.getByRole("button", { name: /Review deployment/i })).toBeVisible({ timeout: 20_000 });

    await page.reload();
    // Resumes at the limits step (deployment id persisted) — NOT back at "Secure plan ownership".
    await expect(page.getByRole("button", { name: /Review deployment/i })).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole("button", { name: /Secure plan ownership/i })).toHaveCount(0);
  });

  test("declined confirmation stops safely (no live campaign, resumable)", async ({ page }) => {
    await installInjectedWallet(page, { rejectTxIndex: 1 }); // reject the create tx
    const jobId = await seedPlan(page);
    test.skip(!jobId, "SAGE_E2E not enabled on the server");

    await openApprovedPlan(page, jobId!);
    await claimThroughPreview(page);
    await page.getByRole("button", { name: /Create and fund campaign/i }).click();

    await expect(page.getByText(/You declined/i)).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText("Your campaign is live.")).toHaveCount(0);
  });

  test("batch-capable wallet: one confirmation → live", async ({ page }) => {
    await installInjectedWallet(page, { supportsBatch: true });
    const jobId = await seedPlan(page);
    test.skip(!jobId, "SAGE_E2E not enabled on the server");

    await openApprovedPlan(page, jobId!);
    await claimThroughPreview(page);
    // Truthful copy for a batch-capable wallet.
    await expect(page.getByText(/confirm this setup as a batch/i)).toBeVisible();
    await page.getByRole("button", { name: /Create and fund campaign/i }).click();
    await expect(page.getByText("Your campaign is live.")).toBeVisible({ timeout: 40_000 });
  });

  test("mobile viewport: the flow reaches live without horizontal overflow", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await installInjectedWallet(page);
    const jobId = await seedPlan(page);
    test.skip(!jobId, "SAGE_E2E not enabled on the server");

    await openApprovedPlan(page, jobId!);
    await claimThroughPreview(page);
    await page.getByRole("button", { name: /Create and fund campaign/i }).click();
    await expect(page.getByText("Your campaign is live.")).toBeVisible({ timeout: 40_000 });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
    expect(overflow).toBeFalsy();
  });
});

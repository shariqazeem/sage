import { expect, test } from "@playwright/test";

/**
 * Landing V2 — the cinematic homepage at "/". Asserts the SEE → DESIGN → REPLAY → PAY
 * narrative renders, the primary CTAs point at real destinations, the replay toggle
 * works, and the proof section is present. Copy assertions are intentionally loose so
 * small wording tweaks don't break the suite.
 */
test.describe("landing V2", () => {
  test("renders the cinematic narrative and real CTAs", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveTitle(/Sage/);

    // Hero — above the fold, complete at first paint.
    await expect(page.getByRole("heading", { level: 1 })).toContainText("It sees the work");
    await expect(page.getByText("Autonomous product testing").first()).toBeVisible();

    // Primary CTA destinations preserved.
    const launch = page.getByRole("link", { name: /Launch a campaign/i }).first();
    await expect(launch).toHaveAttribute("href", "/dashboard");

    // The four narrative scenes exist.
    await expect(page.getByRole("heading", { name: /see, design, then verify/i })).toBeVisible();
    await expect(page.getByText(/Sage doesn.t trust the screenshot/i)).toBeVisible();
    await expect(page.getByText(/The wallet has rules/i)).toBeVisible();
    await expect(page.getByRole("heading", { name: /Every decision leaves a receipt/i })).toBeVisible();

    // Replay toggle is interactive and truthful (both outcomes reachable).
    await expect(page.getByText(/payout may continue/i)).toBeVisible();
    await page.getByRole("button", { name: /Product drift/i }).click();
    await expect(page.getByText(/payout held/i)).toBeVisible();
  });

  test("nav links resolve", async ({ page }) => {
    await page.goto("/");
    for (const href of ["#how", "#proof", "/dashboard"]) {
      await expect(page.locator(`.nav a[href="${href}"]`).first()).toBeVisible();
    }
  });
});

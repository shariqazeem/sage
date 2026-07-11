import { expect, test } from "@playwright/test";

test.describe("campaign layer — one surface (Pass 10)", () => {
  test("public flagship campaign page renders real DB data at the app's design bar", async ({
    page,
  }) => {
    // T5 renamed the flagship slug demo → founding-testers (legacy link 308-redirects).
    await page.goto("/c/founding-testers");

    // The seeded flagship campaign — real row, current production title.
    await expect(
      page.getByRole("heading", { name: /Break the Deputy/i }),
    ).toBeVisible();
    // Re-skinned surface: the submit label + the connect gate (never a fabricated submission).
    await expect(page.getByText(/Submit your entry/i)).toBeVisible();
    await expect(page.getByText(/Connect wallet to submit/i)).toBeVisible();
  });

  test("old poster routes redirect into the app shell", async ({ page }) => {
    for (const path of ["/campaigns", "/campaigns/new"]) {
      await page.goto(path);
      await expect(page).toHaveURL(/\/app$/);
    }
  });

  test("/app renders (onboarding-first shell)", async ({ page }) => {
    await page.goto("/app");
    await expect(page.locator("body")).toContainText(/Sage/i);
  });

  test("campaign detail API gates on the poster", async ({ request }) => {
    // Unauthenticated read of a campaign is refused (poster-gated).
    const res = await request.get("/api/campaigns/demo");
    expect(res.status()).toBe(401);
  });
});

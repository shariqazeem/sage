import { expect, test } from "@playwright/test";

test.describe("campaign layer — one surface (Pass 10)", () => {
  test("public campaign page renders real DB data at the app's design bar", async ({
    page,
  }) => {
    await page.goto("/c/demo");

    // The seeded dogfood campaign — real row, real title + reward.
    await expect(
      page.getByRole("heading", { name: /Break Sage's onboarding/i }),
    ).toBeVisible();
    await expect(page.getByText("$10")).toBeVisible();
    // Re-skinned surface: the settled-payout section + submit label.
    await expect(page.getByText(/Settled payouts/i)).toBeVisible();
    await expect(page.getByText(/Submit your entry/i)).toBeVisible();

    // Not signed in → the connect gate, never a fabricated submission.
    await expect(page.getByText(/Connect wallet to submit/i)).toBeVisible();
  });

  test("old poster routes redirect into the app shell", async ({ page }) => {
    for (const path of ["/campaigns", "/campaigns/new", "/campaigns/demo/review"]) {
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

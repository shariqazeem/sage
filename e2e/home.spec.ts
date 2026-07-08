import { expect, test } from "@playwright/test";

test.describe("homepage", () => {
  test("renders the Sage foundation", async ({ page }) => {
    // Deputy now owns "/"; the Sage foundation moved to /sage.
    await page.goto("/sage");

    await expect(page).toHaveTitle(/Sage/);

    // Wordmark
    await expect(page.getByTestId("wordmark")).toHaveText("SAGE");

    // Product thesis (72h scope)
    await expect(page.getByText(/72 hours/i)).toBeVisible();

    // The three placeholder sections
    await expect(page.getByRole("heading", { name: "Thesis" })).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Investigate" }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Reputation Ledger" }),
    ).toBeVisible();

    // Placeholder investigation input
    await expect(page.getByLabel("Token contract address")).toBeVisible();

    // Reputation verdict legend (target the badges, not prose mentions)
    await expect(page.locator('[data-verdict="SAFE"]')).toBeVisible();
    await expect(page.locator('[data-verdict="RISKY"]')).toBeVisible();
    await expect(page.locator('[data-verdict="SCAM"]')).toBeVisible();
  });
});

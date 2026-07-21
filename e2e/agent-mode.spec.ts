import { expect, test } from "@playwright/test";

/**
 * P25 — Agent Mode on the web. The overlay is one shared component mounted in the root layout, so the
 * "Agent" pill is on every app page (never the marketing landing). Here we drive the UI wiring end-to-
 * end with a STUBBED /api/agent (deterministic, no LLM): typing a URL + budget yields a reply whose
 * deploy link renders as a real, clickable hand-off — money is a hand-off on the web, never an action.
 */
test.describe("P25 — Agent Mode on the web", () => {
  test("the Agent pill opens a command bar; a URL+budget yields a plan link", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" }); // typewriter reveals instantly → deterministic
    await page.route("**/api/agent", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          reply:
            "Your testing plan for myapp.com is ready — 5 missions. Fund + launch it here: https://sagepays.xyz/launch/insp_demo",
        }),
      });
    });

    await page.goto("/launch");

    const pill = page.getByRole("button", { name: /Open Agent mode/i });
    await expect(pill).toBeVisible();
    await pill.click();

    // The overlay states plainly what it can do here (funding is a hand-off).
    await expect(page.getByText(/Funding happens in the deploy wizard or on Telegram/i)).toBeVisible();

    const input = page.getByRole("textbox", { name: /Message Sage/i });
    await expect(input).toBeVisible();
    await input.fill("test https://myapp.com, budget $10");
    await input.press("Enter");

    // The user's message echoes, then the agent's plan reply with a clickable deploy link.
    await expect(page.getByText("test https://myapp.com, budget $10")).toBeVisible();
    const link = page.getByRole("link", { name: /sagepays\.xyz\/launch\/insp_demo/i });
    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute("href", "https://sagepays.xyz/launch/insp_demo");
  });

  test("Agent mode is absent on the marketing landing", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("button", { name: /Open Agent mode/i })).toHaveCount(0);
  });
});

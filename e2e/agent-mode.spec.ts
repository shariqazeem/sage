import { expect, test } from "@playwright/test";

/**
 * P27 — Agent Mode on the web is now a premium LIGHT full-page route (`/agent`), reached from the
 * shell's Home|Agent pill (the dark overlay is gone). Same server (`/api/agent`), read-only, funding
 * is a hand-off. Here we drive the page with a STUBBED /api/agent (deterministic, no LLM): the empty
 * state shows the greeting + chips, and a URL+budget yields a reply whose deploy link renders both as
 * a plain link AND a prominent "Fund + launch" hand-off.
 */
test.describe("P27 — light Agent page + app shell", () => {
  test("the /agent page: greeting + chips, a message yields a reply + fund hand-off", async ({ page }) => {
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

    await page.goto("/agent");

    // Empty state: the greeting + a suggestion chip.
    await expect(page.getByRole("heading", { name: /How can we help you/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /How does Sage verify testers/i })).toBeVisible();

    const input = page.getByRole("textbox", { name: /Message Sage/i });
    await expect(input).toBeVisible();
    await input.fill("test https://myapp.com, budget $10");
    await input.press("Enter");

    // The user's message echoes, then the agent's plan reply with a clickable deploy link.
    await expect(page.getByText("test https://myapp.com, budget $10")).toBeVisible();
    const link = page.getByRole("link", { name: /sagepays\.xyz\/launch\/insp_demo/i });
    await expect(link).toBeVisible();

    // The money hand-off: a prominent same-origin "Fund + launch" action into the deploy wizard.
    const fund = page.getByRole("link", { name: /Fund \+ launch/i });
    await expect(fund).toBeVisible();
    await expect(fund).toHaveAttribute("href", "/launch/insp_demo");
  });

  test("the app shell is present on founder routes, absent on the marketing landing", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(page.locator(".mode-pill")).toBeVisible();
    await expect(page.locator(".app-rail")).toBeVisible();

    await page.goto("/");
    await expect(page.locator(".mode-pill")).toHaveCount(0);
    await expect(page.locator(".app-rail")).toHaveCount(0);
  });
});

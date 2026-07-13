import { expect, test } from "@playwright/test";

/**
 * PROMPT 07 — the unified founder journey + the ClawUp agent seam. The landing funnels into
 * /launch (never the legacy /app), the ecosystem strip asserts only true claims, and the
 * authenticated Sage Agent API fails closed without a key.
 */
test.describe("PROMPT 07 — unified journey + ClawUp seam", () => {
  test("landing primary CTA leads to the canonical /launch (not legacy /app)", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("link", { name: /Launch a testing campaign/i }).first().click();
    await expect(page).toHaveURL(/\/launch$/);
    // the launch form is testnet-truthful — budget is entered in test mUSDC, never "$".
    await expect(page.getByText(/Testing budget \(test mUSDC\)/i)).toBeVisible();
  });

  test("landing shows the honest ecosystem strip (real claims only)", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByText(/Built on Metis/i)).toBeVisible();
    // ERC-8004 #79 is a real registered identity; the chip is present (verified/claimed per RPC).
    await expect(page.getByText(/ERC-8004 #79/i)).toBeVisible();
  });

  test("the Sage Agent API fails closed without a key", async ({ request }) => {
    for (const path of ["/api/agent/campaigns/founding-testers", "/api/agent/proof/0xabc"]) {
      const res = await request.get(path);
      expect(res.status()).toBe(404);
      expect((await res.json()).error).toMatch(/not configured/i);
    }
    const post = await request.post("/api/agent/inspections", { data: {} });
    expect(post.status()).toBe(404);
  });

  test("the ecosystem JSON is honest + fails closed (never env-presence alone)", async ({ request }) => {
    const res = await request.get("/api/ecosystem");
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    // no agent key locally → honest "not_configured", never an inferred "live".
    expect(body.clawup.state).toBe("not_configured");
    // ERC-8004 state is derived from a real on-chain ownerOf check, not a flag.
    expect(["verified", "claimed", "not_configured"]).toContain(body.erc8004.state);
  });
});

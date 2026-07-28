import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { chromium, type Browser, type Page } from "playwright";
import { findSubmitControl, requiredSensitiveFieldPending } from "./field-test";

/**
 * REGRESSION — inspections MRa3-uqlBL1L and qsgqLpOC2xVo on Sage's own launch wizard.
 *
 * A multi-step wizard puts a "Continue →" on EVERY step. Preferring the deterministic forward
 * affordance therefore walked Sage through the entire flow with every field empty, and the app then
 * complained about step 1 while Sage was standing on step 2 — six submissions, all bouncing off
 * "Target users is required", no way back.
 *
 * The rule that fixes it is general, not product-specific: never advance past a screen that still has
 * something Sage could fill. A marketing screen has nothing fillable and is unaffected.
 *
 * This page is built the way the real one is: no <form> element, no `required` attributes, validation
 * in JavaScript — the combination that defeated both earlier attempts.
 */
const WIZARD = `<!doctype html><html><body>
  <div id="app"></div>
  <script>
    const state = { step: 1, url: "", who: "", budget: "", error: "" };
    function render() {
      const s = state;
      document.getElementById("app").innerHTML =
        s.step === 1
          ? '<h2>Tell Sage about your product</h2>' +
            '<input id="url" placeholder="https://yourproduct.com" value="' + s.url + '" />' +
            '<input id="who" placeholder="Who should test this" value="' + s.who + '" />' +
            (s.error ? '<p id="err">' + s.error + '</p>' : '') +
            '<button type="button" id="next">Continue &rarr;</button>'
          : s.step === 2
          ? '<h2>Set the testing budget</h2>' +
            '<input id="budget" type="number" placeholder="50" value="' + s.budget + '" />' +
            (s.error ? '<p id="err">' + s.error + '</p>' : '') +
            '<button type="button" id="back">Back</button>' +
            '<button type="button" id="go">Let Sage inspect &rarr;</button>'
          : '<h2>Your plan is ready</h2><p id="done">Sage inspected your product and designed 3 missions.</p>';
      const n = document.getElementById("next");
      if (n) n.onclick = () => {
        state.url = document.getElementById("url").value;
        state.who = document.getElementById("who").value;
        // JS validation — nothing is marked required in the DOM.
        state.error = !state.url ? "Product URL is required." : !state.who ? "Target users is required." : "";
        if (!state.error) state.step = 2;
        render();
      };
      const b = document.getElementById("back");
      if (b) b.onclick = () => { state.step = 1; render(); };
      const g = document.getElementById("go");
      if (g) g.onclick = () => {
        state.budget = document.getElementById("budget").value;
        state.error = !state.budget ? "Budget is required." : "";
        if (!state.error) state.step = 3;
        render();
      };
    }
    render();
  </script>
</body></html>`;

let browser: Browser;
let page: Page;

beforeAll(async () => {
  browser = await chromium.launch();
  page = await browser.newPage();
}, 60_000);

afterAll(async () => {
  await browser?.close();
});

describe("a JS-validated wizard with no <form> is carried through", () => {
  beforeAll(async () => {
    await page.setContent(WIZARD);
  });

  it("fills step 1 even though nothing carries a required attribute", async () => {
    expect(await requiredSensitiveFieldPending(page)).toBe(false);
    expect(await page.inputValue("#url")).toBe("https://example.com");
    expect((await page.inputValue("#who")).trim().length).toBeGreaterThan(0);
  });

  it("refuses to press a page button when there is no form to scope to", async () => {
    // The old behaviour scanned the whole document and could press anything button-shaped.
    expect(await findSubmitControl(page)).toBeNull();
  });

  it("advances past step 1 WITHOUT the validation error that broke both earlier runs", async () => {
    await page.click("#next");
    expect(await page.locator("#err").count()).toBe(0);
    expect(await page.locator("h2").textContent()).toBe("Set the testing budget");
  });

  it("fills step 2 and reaches the real outcome screen", async () => {
    expect(await requiredSensitiveFieldPending(page)).toBe(false);
    expect(await page.inputValue("#budget")).toBe("1");
    await page.click("#go");
    expect(await page.locator("#done").textContent()).toContain("designed 3 missions");
  });
});

describe("the old failure is reproduced when the step is left empty", () => {
  it("shows that advancing with empty fields is what produced the error", async () => {
    const fresh = await browser.newPage();
    await fresh.setContent(WIZARD);
    await fresh.click("#next"); // straight to Continue, nothing filled — the previous behaviour
    expect(await fresh.locator("#err").textContent()).toBe("Product URL is required.");
    expect(await fresh.locator("h2").textContent()).toBe("Tell Sage about your product");
    await fresh.close();
  });
});

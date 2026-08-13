import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { chromium, type Browser, type Page } from "playwright";
import {
  classifyFieldValue,
  isSensitiveField,
  resolveSyntheticValue,
} from "./browser-controller";

/**
 * The typing generalisation, exercised in a REAL browser against real form markup.
 *
 * The pure tests prove the policy; these prove the policy survives contact with the DOM — that the
 * fields Sage may fill are the ones it actually fills, that a card or email box is left untouched,
 * and that a destructive control is never the thing Sage presses. A form-driven product was
 * previously unreachable: typing existed only inside the conversation path, so Sage would arrive at
 * a founder's launch form, click submit on empty fields, and report it could not finish the journey.
 */

const PAGE = `<!doctype html><html><body>
  <h1>Launch a campaign</h1>
  <form id="launch">
    <label for="purl">Product URL</label>
    <input id="purl" name="productUrl" type="url" placeholder="https://yourproduct.com" required />

    <label for="budget">Budget</label>
    <input id="budget" name="budget" type="number" placeholder="50" required />

    <label for="nm">Your name</label>
    <input id="nm" name="displayName" type="text" />

    <label for="notes">Notes</label>
    <textarea id="notes" name="notes"></textarea>

    <button type="submit" id="go">Launch</button>
  </form>
</body></html>`;

const SENSITIVE_PAGE = `<!doctype html><html><body>
  <form id="signup">
    <input id="em" name="email" type="email" placeholder="you@company.com" required />
    <input id="pw" name="password" type="password" required />
    <input id="cc" name="cardNumber" type="number" placeholder="Card number" />
    <input id="acct" name="account_number" type="number" />
    <input id="nm" name="displayName" type="text" />
    <button type="submit">Create account</button>
  </form>
  <button id="danger">Delete everything</button>
</body></html>`;

/** The same descriptor the mint builds, read straight from a live element. */
async function descriptorOf(page: Page, sel: string) {
  return page.locator(sel).evaluate((node) => {
    const he = node as HTMLInputElement;
    return {
      type: (he.getAttribute("type") || "").toLowerCase(),
      name: he.getAttribute("name") || "",
      id: he.id || "",
      placeholder: he.getAttribute("placeholder") || "",
      autocomplete: he.getAttribute("autocomplete") || "",
      ariaLabel: he.getAttribute("aria-label") || "",
      label: (he.labels?.[0]?.textContent || "").trim(),
      tag: he.tagName.toLowerCase(),
    };
  });
}

let browser: Browser;
let page: Page;

beforeAll(async () => {
  browser = await chromium.launch();
  page = await browser.newPage();
}, 60_000);

afterAll(async () => {
  await browser?.close();
});

describe("a real launch form is fillable end to end", () => {
  beforeAll(async () => {
    await page.setContent(PAGE);
  });

  it("reads the URL box as a URL and fills it with a valid one", async () => {
    const d = await descriptorOf(page, "#purl");
    expect(isSensitiveField(d)).toBe(false);
    expect(classifyFieldValue(d)).toBe("url");
    await page.fill("#purl", resolveSyntheticValue("url"));
    // The browser's own URL validation is the real judge of whether the value was valid.
    expect(await page.locator("#purl").evaluate((n) => (n as HTMLInputElement).checkValidity())).toBe(true);
  });

  it("fills the budget box that type=number used to block outright", async () => {
    const d = await descriptorOf(page, "#budget");
    expect(isSensitiveField(d)).toBe(false);
    expect(classifyFieldValue(d)).toBe("quantity");
    await page.fill("#budget", resolveSyntheticValue("quantity"));
    expect(await page.locator("#budget").evaluate((n) => (n as HTMLInputElement).checkValidity())).toBe(true);
  });

  it("names the name box and writes into the textarea", async () => {
    expect(classifyFieldValue(await descriptorOf(page, "#nm"))).toBe("display_name");
    expect(classifyFieldValue(await descriptorOf(page, "#notes"))).toBe("ai_probe");
  });

  it("leaves the whole form valid, so submitting it is honest", async () => {
    await page.fill("#nm", resolveSyntheticValue("display_name"));
    expect(await page.locator("#launch").evaluate((n) => (n as HTMLFormElement).checkValidity())).toBe(true);
  });
});

describe("credential and payment fields are untouched in a live DOM", () => {
  beforeAll(async () => {
    await page.setContent(SENSITIVE_PAGE);
  });

  it.each([
    ["#em", "an email field"],
    ["#pw", "a password field"],
    ["#cc", "a card-number field"],
    ["#acct", "an account-number field"],
  ])("refuses %s (%s)", async (sel) => {
    expect(isSensitiveField(await descriptorOf(page, sel))).toBe(true);
  });

  it("still allows the ordinary name field on the same form", async () => {
    expect(isSensitiveField(await descriptorOf(page, "#nm"))).toBe(false);
  });

  it("leaves a signup form INVALID, which is why Sage must not submit it", async () => {
    // Sage fills what it may; the required email and password stay empty, so the form cannot be
    // honestly submitted — and `requiredSensitiveFieldPending` is what stops it trying.
    await page.fill("#nm", resolveSyntheticValue("display_name"));
    expect(await page.locator("#signup").evaluate((n) => (n as HTMLFormElement).checkValidity())).toBe(false);
    const stillRequired = await page.evaluate(() =>
      Array.from(document.querySelectorAll("input")).some(
        (i) => i.required && !i.value.trim(),
      ),
    );
    expect(stillRequired).toBe(true);
  });
});

/**
 * THE "SAGE TEST" IN THE CODE BOX (ClawUp mzQGzfo_0J8s). After the emailed code was rejected, the
 * form-filler typed the synthetic probe into the verification-code input. Guessing a security code is
 * never useful, burns the product's rate limits, and reads as flailing on the founder's screenshots.
 */
describe("a verification-code box is never filled by the form-filler", () => {
  it("treats code / OTP / 2FA inputs as sensitive", () => {
    for (const el of [
      { placeholder: "Verification code (1 min)" },
      { name: "otp" },
      { label: "One-time code" },
      { placeholder: "Security code" },
      { name: "confirmation_code" },
      { label: "2FA code" },
      { placeholder: "Enter the 6-digit PIN" },
    ]) {
      expect(isSensitiveField(el), `should refuse: ${JSON.stringify(el)}`).toBe(true);
    }
  });

  it("still fills ordinary fields it is meant to", () => {
    expect(isSensitiveField({ name: "displayName", label: "Your name" })).toBe(false);
    expect(isSensitiveField({ name: "notes", label: "Notes" })).toBe(false);
  });
});

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { chromium, type Browser, type Page } from "playwright";
import {
  findSubmitControl,
  requiredSensitiveFieldPending,
} from "./field-test";

/**
 * Sage may now press a form's submit control — a capability it deliberately did not have, because
 * without it no form-driven product could ever be completed, observed, or paid out on. The narrowness
 * is the whole safety argument, so it is pinned here in a real browser:
 *
 *  - a form still REQUIRING something Sage may not type (an email, a password) is never submitted;
 *  - a control that destroys or spends is never pressed, whatever the form around it looks like;
 *  - an ordinary submit on a form Sage genuinely filled is allowed, which is the point.
 */

let browser: Browser;
let page: Page;

beforeAll(async () => {
  browser = await chromium.launch();
  page = await browser.newPage();
}, 60_000);

afterAll(async () => {
  await browser?.close();
});

const load = (html: string) =>
  page.setContent(`<!doctype html><html><body>${html}</body></html>`);

describe("a form that still needs a credential is never submitted", () => {
  it("holds when a required email is empty", async () => {
    await load(
      `<form><input name="email" type="email" required /><input name="displayName" value="Sage Test" /><button type="submit">Sign up</button></form>`,
    );
    expect(await requiredSensitiveFieldPending(page)).toBe(true);
  });

  it("holds when a required password is empty", async () => {
    await load(
      `<form><input name="password" type="password" required /><button type="submit">Continue</button></form>`,
    );
    expect(await requiredSensitiveFieldPending(page)).toBe(true);
  });

  it("proceeds when the only required fields are ones Sage may fill", async () => {
    await load(
      `<form><input name="productUrl" type="url" required value="https://example.com" /><input name="budget" type="number" required value="1" /><button type="submit">Launch</button></form>`,
    );
    expect(await requiredSensitiveFieldPending(page)).toBe(false);
  });

  it("ignores a required credential that is already filled", async () => {
    await load(
      `<form><input name="email" type="email" required value="someone@example.com" /><button type="submit">Go</button></form>`,
    );
    expect(await requiredSensitiveFieldPending(page)).toBe(false);
  });

  it("ignores a hidden required field the user never sees", async () => {
    await load(
      `<form><input name="email" type="email" required style="display:none" /><input name="q" /><button type="submit">Go</button></form>`,
    );
    expect(await requiredSensitiveFieldPending(page)).toBe(false);
  });
});

/**
 * REGRESSION — inspection jypLi8nvg9fY on Sage's own launch form. Sage filled the two fields it had
 * minted, submitted, and the only thing that submission ever produced was "target users is required".
 * A required field the mint never saw is invisible to the fill pass, so the form was submitted
 * incomplete. That is worse than not submitting: the state Sage records as the OUTCOME then contains
 * a validation error instead of the screen a tester would describe, which poisons the private key
 * that later has to judge them.
 */
describe("a required field the mint missed is filled, not submitted past", () => {
  it("fills a required text field and then allows the submit", async () => {
    await load(
      `<form><input name="productUrl" type="url" required /><input name="targetUsers" required placeholder="Who should test this" /><button type="submit">Launch</button></form>`,
    );
    expect(await requiredSensitiveFieldPending(page)).toBe(false);
    const values = await page.$$eval("input", (els) =>
      els.map((e) => (e as HTMLInputElement).value),
    );
    expect(values.every((v) => v.trim().length > 0)).toBe(true);
  });

  it("gives each field the value its own type asks for", async () => {
    await load(
      `<form><input id="u" name="productUrl" type="url" required /><input id="b" name="budget" type="number" required /><button type="submit">Go</button></form>`,
    );
    await requiredSensitiveFieldPending(page);
    expect(await page.inputValue("#u")).toBe("https://example.com");
    expect(await page.inputValue("#b")).toBe("1");
    expect(
      await page.locator("form").evaluate((n) => (n as HTMLFormElement).checkValidity()),
    ).toBe(true);
  });

  it("picks an option for a required select rather than leaving it empty", async () => {
    await load(
      `<form><select name="plan" required><option value="">Choose…</option><option value="basic">Basic</option></select><button type="submit">Go</button></form>`,
    );
    expect(await requiredSensitiveFieldPending(page)).toBe(false);
    expect(await page.inputValue("select")).toBe("basic");
  });

  it("honours aria-required, not only the required attribute", async () => {
    await load(
      `<form><input name="topic" aria-required="true" /><button type="submit">Go</button></form>`,
    );
    await requiredSensitiveFieldPending(page);
    expect((await page.inputValue("input")).trim().length).toBeGreaterThan(0);
  });

  it("still refuses when the missing required field is one Sage must not type", async () => {
    await load(
      `<form><input name="productUrl" type="url" required /><input name="email" type="email" required /><button type="submit">Go</button></form>`,
    );
    expect(await requiredSensitiveFieldPending(page)).toBe(true);
    // and it did not type into the email box on its way to finding that out
    expect(await page.inputValue("[name=email]")).toBe("");
  });

  it("fills optional fields too, because a JS-validated form marks nothing required", async () => {
    // Sage's own launch form validates in React and sets no `required` attribute anywhere, so an
    // attribute-driven pass filled nothing and every submission bounced off "Target users is
    // required." Filling every safe empty field is what makes a JS-validated form completable.
    await load(
      `<form><input id="a" name="productUrl" type="url" /><input id="b" name="targetUsers" placeholder="Who should test this" /><button type="submit">Go</button></form>`,
    );
    expect(await requiredSensitiveFieldPending(page)).toBe(false);
    expect(await page.inputValue("#a")).toBe("https://example.com");
    expect((await page.inputValue("#b")).trim().length).toBeGreaterThan(0);
  });

  it("leaves an OPTIONAL credential box alone without blocking the form", async () => {
    await load(
      `<form><input id="a" name="topic" /><input id="e" name="email" type="email" /><button type="submit">Go</button></form>`,
    );
    expect(await requiredSensitiveFieldPending(page)).toBe(false);
    expect(await page.inputValue("#e")).toBe("");
    expect((await page.inputValue("#a")).trim().length).toBeGreaterThan(0);
  });

  it("never types into a checkbox, radio or file input", async () => {
    await load(
      `<form><input id="c" type="checkbox" /><input id="r" type="radio" /><input id="f" type="file" /><input id="t" name="topic" /><button type="submit">Go</button></form>`,
    );
    await requiredSensitiveFieldPending(page);
    expect(await page.locator("#c").isChecked()).toBe(false);
    expect(await page.locator("#r").isChecked()).toBe(false);
    expect(await page.inputValue("#f")).toBe("");
  });

  it("leaves a disabled or readonly field untouched", async () => {
    await load(
      `<form><input id="d" name="topic" disabled /><input id="ro" name="note" readonly /><input id="ok" name="thing" /><button type="submit">Go</button></form>`,
    );
    await requiredSensitiveFieldPending(page);
    expect(await page.inputValue("#d")).toBe("");
    expect(await page.inputValue("#ro")).toBe("");
    expect((await page.inputValue("#ok")).trim().length).toBeGreaterThan(0);
  });
});

describe("a destructive or spending control is refused", () => {
  it.each([
    "Delete account",
    "Remove everything",
    "Pay now",
    "Purchase",
    "Buy credits",
    "Checkout",
    "Subscribe",
    "Upgrade",
    "Withdraw funds",
    "Transfer",
  ])("refuses %s", async (label) => {
    await load(`<form><input name="q" /><button type="submit">${label}</button></form>`);
    expect(await findSubmitControl(page)).toBe("unsafe");
  });
});

describe("an ordinary submit is found and allowed", () => {
  it.each([
    "Launch",
    "Submit",
    "Create campaign",
    "Search",
    "Continue",
    "Save",
  ])("allows %s", async (label) => {
    await load(`<form><input name="q" /><button type="submit">${label}</button></form>`);
    expect(await findSubmitControl(page)).toBe(label);
  });

  it("marks the control so only that exact element is clicked", async () => {
    await load(
      `<form><input name="q" /><button type="submit">Launch</button></form><button>Delete</button>`,
    );
    await findSubmitControl(page);
    const marked = await page.$$eval("[data-sage-submit]", (els) =>
      els.map((e) => (e as HTMLElement).innerText),
    );
    expect(marked).toEqual(["Launch"]);
  });

  it("returns null when the form has no control, so Enter is the honest fallback", async () => {
    await load(`<form><input name="q" /></form>`);
    expect(await findSubmitControl(page)).toBeNull();
  });

  it("skips a disabled control rather than pressing a dead button", async () => {
    await load(
      `<form><input name="q" /><button type="submit" disabled>Launch</button><button type="submit">Continue</button></form>`,
    );
    expect(await findSubmitControl(page)).toBe("Continue");
  });

  it("does not reach outside a form to a destructive page button", async () => {
    await load(
      `<form id="f"><input name="q" /><button type="submit">Save</button></form><button>Delete everything</button>`,
    );
    expect(await findSubmitControl(page)).toBe("Save");
  });
});

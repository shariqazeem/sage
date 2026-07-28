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

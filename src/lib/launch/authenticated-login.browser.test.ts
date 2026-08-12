import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { chromium, type Browser, type Page } from "playwright";
import { planLoginForm, loginSucceeded, redactSecrets } from "./authenticated-exploration";

/**
 * THE TEST ACCOUNT, PROVEN IN A REAL BROWSER.
 *
 * The pure tests prove the policy; this proves it survives contact with the DOM — that Sage finds
 * the real email/password controls on ordinary login markup, signs in, correctly reports failure on
 * a wrong credential, refuses to type into an OAuth/wallet wall, and that a dashboard's secrets are
 * redacted before they could ever become a public mission anchor.
 *
 * Deliberately a page WE control: Sage must never create accounts on anyone's product, so the
 * mechanism is verified here and real founder credentials are supplied by the founder.
 */

const LOGIN_PAGE = `<!doctype html><html><body>
  <h1>Sign in to Token Ledger</h1>
  <form id="f" onsubmit="event.preventDefault();
    var e=document.getElementById('em').value, p=document.getElementById('pw').value;
    if(e==='tester@example.com'&&p==='CorrectHorse9'){
      document.body.innerHTML='<h1>Console</h1><p>Signed in as tester@example.com</p>'+
        '<p>API key: sk-live-9f8e7d6c5b4a3210zzzz</p>'+
        '<table><tr><th>Time</th><th>Endpoint</th><th>Model</th><th>Cost</th></tr></table>';
    } else {
      document.getElementById('err').textContent='Invalid email or password';
    }">
    <label for="em">Email</label>
    <input id="em" name="email" type="email" autocomplete="username" />
    <label for="pw">Password</label>
    <input id="pw" name="password" type="password" autocomplete="current-password" />
    <button type="submit" id="go">Sign in</button>
    <a href="/signup" id="su">Sign up</a>
    <button type="button" id="fg">Forgot password?</button>
  </form>
  <p id="err"></p>
</body></html>`;

const OAUTH_WALL = `<!doctype html><html><body>
  <h1>Welcome</h1>
  <button id="g">Continue with Google</button>
  <button id="w">Connect Wallet</button>
</body></html>`;

/** Mirrors the executor's DOM read (field-test.ts attemptLogin). */
async function readFields(page: Page) {
  return page.evaluate(() => {
    const out: {
      id: string; tag: string; type: string; name: string;
      placeholder: string; autocomplete: string; label: string; typable: boolean;
    }[] = [];
    let i = 0;
    for (const el of Array.from(document.querySelectorAll("input, textarea, button, [role=button]"))) {
      const he = el as HTMLElement;
      const r = he.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) continue;
      const tag = he.tagName.toLowerCase();
      out.push({
        id: `lf${i++}`, tag,
        type: (he as HTMLInputElement).type || "",
        name: he.getAttribute("name") || "",
        placeholder: he.getAttribute("placeholder") || "",
        autocomplete: he.getAttribute("autocomplete") || "",
        label: (he.getAttribute("aria-label") || he.textContent || "").trim().slice(0, 60),
        typable: tag === "input" || tag === "textarea",
      });
      he.setAttribute("data-sage-lf", `lf${i - 1}`);
    }
    return out;
  });
}

async function signIn(page: Page, email: string, password: string) {
  const plan = planLoginForm(await readFields(page));
  if (!plan) return { plan: null as null, ok: false };
  const beforeUrl = page.url();
  await page.fill(`[data-sage-lf="${plan.emailFieldId}"]`, email);
  await page.fill(`[data-sage-lf="${plan.passwordFieldId}"]`, password);
  if (plan.submitId) await page.click(`[data-sage-lf="${plan.submitId}"]`);
  else await page.press(`[data-sage-lf="${plan.passwordFieldId}"]`, "Enter");
  await page.waitForTimeout(300);
  const after = await page.evaluate(() => ({
    url: location.href,
    visibleText: (document.body?.innerText || "").slice(0, 4000),
    stillHasPasswordField: !!document.querySelector('input[type="password"]'),
  }));
  return { plan, ok: loginSucceeded({ ...after, beforeUrl }), text: after.visibleText };
}

describe("Sage signs in with the founder's test account (real browser)", () => {
  let browser: Browser;
  beforeAll(async () => { browser = await chromium.launch(); }, 120_000);
  afterAll(async () => { await browser?.close(); });

  it("finds the real controls and signs in with correct credentials", async () => {
    const page = await browser.newPage();
    await page.setContent(LOGIN_PAGE);
    const r = await signIn(page, "tester@example.com", "CorrectHorse9");
    expect(r.plan).not.toBeNull();
    expect(r.plan!.submitId).not.toBeNull();
    expect(r.ok).toBe(true);
    expect(r.text).toContain("Console");
    await page.close();
  }, 60_000);

  it("reports failure honestly on a wrong password (never claims it got in)", async () => {
    const page = await browser.newPage();
    await page.setContent(LOGIN_PAGE);
    const r = await signIn(page, "tester@example.com", "WrongPassword1");
    expect(r.ok).toBe(false);
    await page.close();
  }, 60_000);

  it("REFUSES to type anything into an OAuth / wallet wall", async () => {
    const page = await browser.newPage();
    await page.setContent(OAUTH_WALL);
    expect(planLoginForm(await readFields(page))).toBeNull();
    await page.close();
  }, 60_000);

  it("redacts the dashboard's secrets before they could become a public anchor", async () => {
    const page = await browser.newPage();
    await page.setContent(LOGIN_PAGE);
    const r = await signIn(page, "tester@example.com", "CorrectHorse9");
    expect(r.ok).toBe(true);
    const scrubbed = redactSecrets(r.text!, { email: "tester@example.com", password: "CorrectHorse9" });
    expect(scrubbed).not.toContain("sk-live-9f8e7d6c5b4a3210zzzz");
    expect(scrubbed).not.toContain("tester@example.com");
    expect(scrubbed).not.toContain("CorrectHorse9");
    // the PRODUCT knowledge Sage went in for must survive — that is the whole point
    expect(scrubbed).toContain("Console");
    expect(scrubbed).toContain("Endpoint");
    await page.close();
  }, 60_000);
});

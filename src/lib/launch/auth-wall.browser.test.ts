import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { chromium, type Browser, type Page } from "playwright";

/**
 * REGRESSION — P-GEN round 5. `ecommerce` (allbirds) went ready → needs_input with 4 states → ZERO,
 * and `login-wall` (web.telegram.org) lost its plan entirely. Both are sites that keep a login form
 * MOUNTED BUT HIDDEN on every page — a shop's account drawer, a chat app's sign-in panel.
 *
 * The auth-wall guard asked `!!document.querySelector('input[type="password"]')`, which matches a
 * hidden node exactly as readily as a visible one. So every state read as a wall, `wallHits` reached
 * its limit of 3, and exploration aborted before anything was observed.
 *
 * A hidden drawer is not a wall Sage walked into. The predicate is reproduced here verbatim against
 * real DOM, because "is this element actually on screen" is precisely the thing a unit test with a
 * fake DOM gets wrong.
 */

const visibleAuthWall = (page: Page) =>
  page.evaluate(() => {
    const shown = (el: Element) => {
      const he = el as HTMLElement;
      const rect = he.getBoundingClientRect?.();
      if (!rect || rect.width < 8 || rect.height < 8) return false;
      const st = getComputedStyle(he);
      if (st.visibility === "hidden" || st.display === "none") return false;
      if (Number(st.opacity) === 0) return false;
      let p = he.parentElement;
      for (let depth = 0; p && depth < 12; depth++) {
        const ps = getComputedStyle(p);
        if (Number(ps.opacity) === 0) return false;
        const clip = `${ps.overflow}${ps.overflowX}${ps.overflowY}`;
        if (clip.includes("hidden") || clip.includes("clip")) {
          const pr = p.getBoundingClientRect();
          if (pr.width < 8 || pr.height < 8) return false;
        }
        p = p.parentElement;
      }
      return true;
    };
    return Array.from(document.querySelectorAll('input[type="password"]')).some(shown);
  });

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

describe("a mounted-but-hidden login drawer is NOT a wall", () => {
  it.each([
    ["display:none (the classic drawer)", 'style="display:none"'],
    ["visibility:hidden", 'style="visibility:hidden"'],
    ["opacity:0", 'style="opacity:0"'],
    ["collapsed accordion (max-height:0 + overflow:hidden)", 'style="max-height:0;height:0;overflow:hidden"'],
  ])("%s", async (_label, attr) => {
    await load(
      `<main><h1>Shop</h1><p>Buy our shoes</p></main>
       <div class="account-drawer" ${attr}><input type="password" name="password" /></div>`,
    );
    expect(await visibleAuthWall(page)).toBe(false);
  });

  it("stays false when the drawer is hidden by an ancestor", async () => {
    await load(
      `<main><h1>Product page</h1></main>
       <div style="display:none"><form><input type="password" /></form></div>`,
    );
    expect(await visibleAuthWall(page)).toBe(false);
  });

  it("reproduces the shop page that collapsed exploration to zero states", async () => {
    // Every allbirds page carries this. Under the old predicate each one counted as a wall.
    await load(
      `<nav><a href="/account">Account</a></nav>
       <main><h1>Wool Runners</h1><button>Add to cart</button></main>
       <aside id="login" hidden><input type="email" /><input type="password" /></aside>`,
    );
    expect(await visibleAuthWall(page)).toBe(false);
  });
});

describe("the two the FIRST version of this fix still got wrong", () => {
  it("opacity:0 on the PARENT hides it — the child computes opacity 1", async () => {
    await load(`<div style="opacity:0"><input type="password" /></div>`);
    const childOpacity = await page.evaluate(
      () => getComputedStyle(document.querySelector("input")!).opacity,
    );
    expect(childOpacity).toBe("1"); // why the element's own style is not enough
    expect(await visibleAuthWall(page)).toBe(false);
  });

  it("a clipped-to-zero panel hides it — the child still reports a full-size rect", async () => {
    await load(`<div style="height:0;overflow:hidden"><input type="password" /></div>`);
    const h = await page.evaluate(
      () => document.querySelector("input")!.getBoundingClientRect().height,
    );
    expect(h).toBeGreaterThan(8); // why geometry on the element alone is not enough
    expect(await visibleAuthWall(page)).toBe(false);
  });
});

describe("a real login screen IS still a wall", () => {
  it("detects a plainly visible password field", async () => {
    await load(`<form><input type="email" /><input type="password" /><button>Sign in</button></form>`);
    expect(await visibleAuthWall(page)).toBe(true);
  });

  it("detects the drawer once it is actually opened", async () => {
    await load(
      `<main><h1>Shop</h1></main>
       <div id="d" style="display:none"><input type="password" /></div>`,
    );
    expect(await visibleAuthWall(page)).toBe(false);
    await page.evaluate(() => {
      (document.getElementById("d") as HTMLElement).style.display = "block";
    });
    expect(await visibleAuthWall(page)).toBe(true);
  });

  it("detects a login form rendered below the fold", async () => {
    // Off-screen vertically is still visible — it has real geometry and no hiding style.
    await load(
      `<div style="height:3000px">scroll</div><form><input type="password" /></form>`,
    );
    expect(await visibleAuthWall(page)).toBe(true);
  });
});

describe("a page with no password field at all", () => {
  it("is never a wall", async () => {
    await load(`<main><h1>Docs</h1><input type="search" /><input type="text" /></main>`);
    expect(await visibleAuthWall(page)).toBe(false);
  });
});

import { describe, it, expect } from "vitest";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { runFieldTest, type FieldTestDeps } from "./field-test";

/**
 * AUTH-WALL RECOGNITION — a controlled experiment, because the P-GEN battery cannot run one here:
 * allbirds WAF-challenges this machine and web.telegram.org does not load at all (measured:
 * `chrome-error://chromewebdata/` after a 61s timeout). Reading either as evidence about this guard
 * would be reading a load failure as a behaviour change.
 *
 * So: ONE fixture, ONE variable. The same shop, the same links, the same goal — the only difference
 * is whether the login form is `display:none` (a drawer every page keeps mounted, which is what
 * allbirds and web.telegram.org actually do) or plainly visible.
 *
 *   hidden  → NOT a wall. Sage keeps exploring.
 *   visible → a wall. Sage steps back and stops honestly.
 *
 * The guard used to ask `!!document.querySelector('input[type="password"]')`, which cannot tell those
 * apart. Every shop page counted as a wall, `wallHits` reached its limit of 3, and exploration aborted
 * before anything was observed: ecommerce went ready→needs_input with 4 states→0, login-wall lost its
 * plan entirely.
 */

const RUN = process.env.FIELD_TEST_ENABLED === "1";

const LOGIN_FORM = (hidden: boolean) =>
  `<aside id="acct"${hidden ? ' style="display:none"' : ""}>
     <h2>Sign in to your account</h2>
     <input type="email" placeholder="Email" />
     <input type="password" placeholder="Password" />
     <button>Sign in</button>
   </aside>`;

/** A shop: home + three product pages, each carrying the SAME account form. */
function shop(hidden: boolean) {
  const chrome = `<nav>
     <button onclick="location.href='/p/1'">View the Wool Runner</button>
     <button onclick="location.href='/p/2'">View the Tree Dasher</button>
     <button onclick="location.href='/p/3'">View the Trail Runner</button>
   </nav>`;
  const page = (title: string, body: string) =>
    `<!doctype html><html><head><title>${title}</title></head><body>
       ${chrome}<main>${body}</main>${LOGIN_FORM(hidden)}
       <script>window.addEventListener('keydown', function(){});</script>
     </body></html>`;
  return (url: string) => {
    const m = /^\/p\/(\d)/.exec(url);
    if (m)
      return {
        code: 200,
        body: page(
          `Product ${m[1]}`,
          `<h1>Product ${m[1]}</h1><p>Merino wool, machine washable, carbon footprint 4.2kg.</p>
           <button>Add to cart</button>`,
        ),
      };
    return {
      code: 200,
      body: page(
        "Shop",
        `<h1>Everyday shoes</h1><p>Made with natural materials.</p>`,
      ),
    };
  };
}

async function serve(
  handler: (url: string) => { code: number; body: string },
): Promise<{ server: Server; port: number }> {
  const server = createServer((req, res) => {
    const r = handler(req.url ?? "/");
    res.writeHead(r.code, { "content-type": "text/html" });
    res.end(r.body);
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const addr = server.address();
  return { server, port: typeof addr === "object" && addr ? addr.port : 0 };
}

/** Clicks product links, in order, the way a shopper would. Never touches the account form. */
const shopper: FieldTestDeps["controller"] = {
  complete: async (_sys: string, user: string) => {
    const links = [...user.matchAll(/(e\d+): <[^>]*> "([^"]*)"/g)].filter(
      ([, , label]) => /runner|dasher/i.test(label ?? ""),
    );
    const next = links[0];
    return JSON.stringify(
      next
        ? {
            action: { kind: "click_element", elementId: next[1] },
            expectedChange: "the product page opens",
            goalProgress: "advancing",
          }
        : {
            action: { kind: "stop", status: "blocked", reason: "no products left" },
            expectedChange: "",
            goalProgress: "blocked",
          },
    );
  },
};

async function run(hidden: boolean) {
  const { server, port } = await serve(shop(hidden));
  try {
    const summary = await runFieldTest(
      {
        inspectionId: `aw-${hidden ? "hidden" : "visible"}`,
        startUrl: `http://127.0.0.1:${port}/`,
        host: `127.0.0.1:${port}`,
        candidateLinks: [],
        goal: "look at the product pages and tell me what the shoes are made of",
      },
      {
        isPublicHost: async () => true,
        allowUrl: () => ({ allow: true, reason: "test" }),
        publicDir: mkdtempSync(join(tmpdir(), "sage-aw-")),
        egressAllowLoopback: new Set([`127.0.0.1:${port}`]),
        egressAllowedPorts: new Set([port]),
        controller: shopper,
      },
    );
    return summary;
  } finally {
    server.close();
  }
}

const walls = (s: { states: Array<{ trigger: string }> }) =>
  s.states.filter((st) => /login wall/i.test(st.trigger));

(RUN ? describe : describe.skip)("auth-wall recognition", () => {
  it("a mounted-but-hidden account drawer does NOT stop exploration", async () => {
    const s = await run(true);
    if (!s.ran) return; // chromium unavailable
    const trace = s.states.map((st) => `${st.trigger} @ ${st.url}`).join("\n");

    expect(walls(s), `should see no wall:\n${trace}`).toHaveLength(0);
    // It got off the entry page and read the products — the thing the old guard prevented.
    const visited = new Set(s.states.map((st) => new URL(st.url).pathname));
    expect([...visited].filter((p) => p.startsWith("/p/")).length, trace).toBeGreaterThan(0);
    expect(s.states.map((st) => st.visibleTextExcerpt).join(" ")).toMatch(/merino wool/i);
  }, 180_000);

  it("a visible login screen IS still recognised as a wall", async () => {
    const s = await run(false);
    if (!s.ran) return;
    const trace = s.states.map((st) => `${st.trigger} @ ${st.url}`).join("\n");
    expect(walls(s).length, `should see a wall:\n${trace}`).toBeGreaterThan(0);
  }, 180_000);

  it("the ONLY difference between those two runs is one CSS property", async () => {
    // Guards the experiment itself: if the fixtures ever diverge beyond `display:none`,
    // the comparison above stops meaning anything.
    const a = shop(true)("/p/1").body;
    const b = shop(false)("/p/1").body;
    expect(a.replace(' style="display:none"', "")).toBe(b);
  });
});

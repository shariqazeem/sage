/**
 * RECORD real motion on the live product. Every frame in a Sage clip is the product being used —
 * a recording, never a still — so the cut can move at the pace of a real film.
 *
 *   node scripts/video/record.mjs --scene graph [--base https://sagepays.xyz] [--size 1080x1080] [--key 0x…]
 *
 * A scene (scripts/video/scenes.mjs) drives the page and drops named MARKS (timestamps) as it goes;
 * the cut list references marks, not guessed seconds. `--key` signs a throwaway wallet in over SIWE
 * so signed-in surfaces (the composer, the operator at $0) can be recorded on prod without touching
 * anyone's account. Output: docs/posts/videos/rec/<scene>.webm + <scene>.marks.json
 */
import { chromium } from "playwright";
import { mkdirSync, renameSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { SCENES } from "./scenes.mjs";

const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : d; };
const name = arg("scene");
if (!name || !SCENES[name]) { console.error(`--scene one of: ${Object.keys(SCENES).join(", ")}`); process.exit(2); }
const base = arg("base", "https://sagepays.xyz");
const [W, H] = arg("size", "1080x1080").split("x").map(Number);
const key = arg("key", process.env.RECORD_KEY || "");
const outDir = arg("out", "docs/posts/videos/rec");
mkdirSync(outDir, { recursive: true });
const tmp = join(outDir, ".tmp-" + name);
mkdirSync(tmp, { recursive: true });

// SIWE with a throwaway key — the same handshake the battery uses (nonce → message → verify).
async function siweCookies(k) {
  const { privateKeyToAccount } = await import("viem/accounts");
  const account = privateKeyToAccount(k.startsWith("0x") ? k : `0x${k}`);
  const jar = new Map();
  const keep = (res) => { for (const c of res.headers.getSetCookie?.() ?? []) { const [kv] = c.split(";"); const i = kv.indexOf("="); jar.set(kv.slice(0, i).trim(), kv.slice(i + 1).trim()); } return res; };
  const cookie = () => [...jar].map(([a, b]) => `${a}=${b}`).join("; ");
  const call = (p, init = {}) => fetch(`${base}${p}`, { ...init, headers: { "content-type": "application/json", cookie: cookie(), ...(init.headers ?? {}) } }).then(keep);
  const { nonce } = await (await call("/api/auth/nonce")).json();
  const host = new URL(base).host;
  const issuedAt = new Date().toISOString();
  // Sage's own sign-in text (src/lib/auth) — the battery signs the same lines.
  const message = [
    "Sage — sign in",
    "",
    `Wallet: ${account.address}`,
    `Nonce: ${nonce}`,
    `Issued At: ${issuedAt}`,
    "",
    "Signing proves you control this wallet. It authorizes no transaction and moves no funds.",
  ].join("\n");
  const signature = await account.signMessage({ message });
  const res = await call("/api/auth/verify", { method: "POST", body: JSON.stringify({ address: account.address, signature, issuedAt }) });
  if (!res.ok) throw new Error(`SIWE verify ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return { address: account.address, cookies: [...jar].map(([n, v]) => ({ name: n, value: v, domain: host.split(":")[0], path: "/" })) };
}

const browser = await chromium.launch({ headless: true });
// TRUE 2× FRAMES. Playwright records the viewport in CSS pixels whatever the device scale, so a
// 2× device scale only pads the frame. Instead the viewport is opened at 2× and the document is
// zoomed 2× (CSS zoom): the page lays out as if it were W×H and paints at 2W×2H, so a punch-in to
// 2× in the cut is still pixel-true.
const SCALE = Number(arg("scale", "1")); // --scale 2 zooms the document (plain DOM pages only: the graph canvas does not draw under CSS zoom)
const context = await browser.newContext({
  viewport: { width: W * SCALE, height: H * SCALE },
  deviceScaleFactor: 1,
  recordVideo: { dir: tmp, size: { width: W * SCALE, height: H * SCALE } },
  colorScheme: "light",
  reducedMotion: "no-preference",
});
const t0 = Date.now();
const marks = {};
let signedIn = null;
if (key) { signedIn = await siweCookies(key); await context.addCookies(signedIn.cookies); }
if (SCALE !== 1) await context.addInitScript((z) => { const apply = () => { document.documentElement.style.zoom = String(z); }; if (document.documentElement) apply(); document.addEventListener("DOMContentLoaded", apply); }, SCALE);
const page = await context.newPage();

// The caption is rendered BY THE PAGE, in the product's own type, so it never fights the product.
const ctx = {
  base, page, W, H, signedIn,
  mark: (m) => { marks[m] = (Date.now() - t0) / 1000; },
  wait: (ms) => page.waitForTimeout(ms),
  go: async (path, opts = {}) => { await page.goto(`${base}${path}`, { waitUntil: "load", timeout: 60_000, ...opts }); await page.mouse.move(Math.round(W * SCALE * 0.62), Math.round(H * SCALE * 0.5)); await page.waitForTimeout(opts.settle ?? 900); },
  caption: async (text, ms = 1400) => {
    await page.evaluate(([t, d]) => {
      let el = document.getElementById("sage-cap");
      if (!el) {
        el = document.createElement("div"); el.id = "sage-cap";
        Object.assign(el.style, { position: "fixed", left: "6%", right: "6%", bottom: "7%", zIndex: 2147483647, fontFamily: "inherit", fontSize: "44px", fontWeight: "600", letterSpacing: "-0.02em", lineHeight: "1.15", color: "#fbfbf9", background: "rgba(26,29,33,.92)", padding: "18px 24px", borderRadius: "10px", transform: "translateY(18px)", opacity: "0", transition: "opacity .28s ease, transform .38s cubic-bezier(.2,.8,.2,1)", pointerEvents: "none" });
        document.body.appendChild(el);
      }
      el.textContent = t;
      requestAnimationFrame(() => { el.style.opacity = "1"; el.style.transform = "translateY(0)"; });
      setTimeout(() => { el.style.opacity = "0"; el.style.transform = "translateY(10px)"; }, d);
    }, [text, ms]);
  },
  // Smooth scroll to a selector or a y offset — real scrolling, so the page's own scroll scenes play.
  scrollTo: async (target, ms = 900) => {
    await page.evaluate(async ([tg, d]) => {
      const y = typeof tg === "number" ? tg : (document.querySelector(tg)?.getBoundingClientRect().top ?? 0) + window.scrollY - 24;
      const y0 = window.scrollY, s = performance.now();
      await new Promise((r) => { const step = (n) => { const p = Math.min((n - s) / d, 1), e = 1 - Math.pow(1 - p, 3); window.scrollTo(0, y0 + (y - y0) * e); if (p < 1) requestAnimationFrame(step); else r(); }; requestAnimationFrame(step); });
    }, [target, ms]);
  },
  // Human typing: variable cadence, so the composer's live preview is seen forming.
  type: async (selector, text, cps = 26) => {
    await page.click(selector);
    for (const ch of text) { await page.keyboard.type(ch); await page.waitForTimeout(1000 / cps + Math.random() * 40); }
  },
  hide: async (selector) => { await page.addStyleTag({ content: `${selector}{visibility:hidden!important}` }); },
};

try {
  await SCENES[name](ctx);
  ctx.mark("end");
} catch (e) {
  console.error(`[record] ${name} failed: ${e instanceof Error ? e.message : e}`);
  ctx.mark("error");
}
await page.waitForTimeout(400);
await context.close();
await browser.close();
const files = readdirSync(tmp).filter((f) => f.endsWith(".webm")).map((f) => join(tmp, f)).sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
if (!files.length) { console.error("no video written"); process.exit(1); }
renameSync(files[0], join(outDir, `${name}.webm`));
writeFileSync(join(outDir, `${name}.marks.json`), JSON.stringify({ scene: name, size: [W, H], scale: SCALE, marks }, null, 2));
console.log(`${name}.webm  ${Object.entries(marks).map(([k, v]) => `${k}=${v.toFixed(2)}`).join("  ")}`);

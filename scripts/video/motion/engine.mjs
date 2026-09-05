/**
 * THE ENGINE — renders a storyboard frame by frame. The board is an HTML page whose every
 * element carries its own CSS timeline; the engine seeks the document to t, screenshots, and
 * moves on. Deterministic, sharp, and every real recording inside a frame is seeked in sync.
 *
 *   node scripts/video/motion/engine.mjs --board operator [--out docs/posts/videos/out] [--fps 30]
 */
import { chromium } from "playwright";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { execFileSync } from "node:child_process";

const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : d; };
const name = arg("board"); if (!name) throw new Error("--board <name>");
const out = arg("out", "docs/posts/videos/out");
const FPS = Number(arg("fps", "30"));
const mod = await import(`./boards/${name}.mjs`);
const board = await mod.build();
const [W, H] = board.size;
const htmlDir = resolve("docs/posts/videos/motion"); mkdirSync(htmlDir, { recursive: true });
const htmlPath = join(htmlDir, `${name}.html`);
writeFileSync(htmlPath, board.html);
const frames = join(out, `.frames-${name}`); rmSync(frames, { recursive: true, force: true }); mkdirSync(frames, { recursive: true });

const browser = await chromium.launch({ args: ["--allow-file-access-from-files", "--autoplay-policy=no-user-gesture-required"] });
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
await page.goto(`file://${htmlPath}`, { waitUntil: "networkidle", timeout: 60000 });
await page.evaluate(async () => { await document.fonts.ready; await Promise.all([...document.querySelectorAll("video")].map((v) => v.readyState >= 2 ? null : new Promise((r) => { v.addEventListener("loadeddata", r, { once: true }); setTimeout(r, 4000); }))); });

const seek = async (ms) => {
  for (const a of document.getAnimations()) { a.pause(); a.currentTime = ms; }
  document.querySelectorAll(".count").forEach((el) => {
    const from = +el.dataset.from, to = +el.dataset.to, t0 = +el.dataset.in * 1000, d = +el.dataset.dur * 1000;
    let k = (ms - t0) / d; k = k < 0 ? 0 : k > 1 ? 1 : k; k = k * k * (3 - 2 * k);
    const v = from + (to - from) * k;
    el.textContent = el.dataset.fmt === "usd" ? "$" + v.toFixed(2) : el.dataset.fmt === "pct" ? Math.round(v) + "%" : el.dataset.fmt === "jmd" ? "J$" + Math.round(v).toLocaleString("en-US") : String(Math.round(v));
  });
  await Promise.all([...document.querySelectorAll("video.vid")].map((v) => {
    const t0 = +v.dataset.in * 1000, s = +v.dataset.seek;
    const t = Math.max(0, (ms - t0) / 1000) + s;
    if (Math.abs(v.currentTime - t) < 0.002) return null;
    return new Promise((res) => { const done = () => { v.removeEventListener("seeked", done); res(); }; v.addEventListener("seeked", done); v.currentTime = t; setTimeout(res, 500); });
  }));
};
const total = Math.round(board.duration * FPS);
const t0 = Date.now();
for (let f = 0; f < total; f++) {
  await page.evaluate(seek, (f / FPS) * 1000);
  await page.screenshot({ path: join(frames, `${String(f).padStart(5, "0")}.png`), type: "png" });
  if (f % 60 === 0) process.stdout.write(`\r${name}: frame ${f}/${total} (${((Date.now() - t0) / 1000).toFixed(0)}s)`);
}
await browser.close();
const final = join(out, `${name}.mp4`);
execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-framerate", String(FPS), "-i", join(frames, "%05d.png"), "-c:v", "libx264", "-preset", "medium", "-crf", "15", "-pix_fmt", "yuv420p", "-movflags", "+faststart", final]);
rmSync(frames, { recursive: true, force: true });
console.log(`\n${final}  ${board.duration}s  ${total} frames`);

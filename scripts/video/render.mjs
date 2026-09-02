/**
 * Render an announcement video from a storyboard of REAL screenshots.
 *
 * A storyboard is JSON: { name, size: [w,h], scenes: [{ shot, kicker, caption, seconds, motion }] }.
 * Each scene shows one screenshot with a slow Ken-Burns move and a caption in the product's own
 * type. The page is recorded in real time by Playwright, then ffmpeg makes the H.264 mp4 X wants.
 * Nothing is drawn that is not on the product: the only "animation" is the camera and the words.
 *
 *   node scripts/video/render.mjs --board docs/posts/videos/boards/opener.json [--out docs/posts/videos]
 */
import { chromium } from "playwright";
import { readFileSync, mkdirSync, unlinkSync, existsSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { execFileSync } from "node:child_process";

const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : d; };
const boardPath = arg("board");

// The frames are ~1 MB each and only exist to feed ffmpeg; two renders left 336 MB of PNGs behind and
// filled a nearly-full disk (2026-09-02). Remove them once the encode has succeeded — a failed encode
// keeps them for inspection.
rmSync(tmpDir, { recursive: true, force: true });
if (!boardPath) throw new Error("--board <storyboard.json>");
const out = arg("out", "docs/posts/videos");
const board = JSON.parse(readFileSync(boardPath, "utf8"));
const [W, H] = board.size ?? [1920, 1080];
const FPS = Number(arg("fps", "30"));
const CRF = arg("crf", "16");
const shotsDir = resolve(board.shotsDir ?? "docs/posts/videos/shots");

const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;");
const dataUrl = (file) => `data:image/png;base64,${readFileSync(join(shotsDir, file)).toString("base64")}`;

let t = 0;
const scenes = board.scenes.map((sc, i) => {
  const start = t; t += sc.seconds;
  return { ...sc, i, start, end: t };
});
const total = t;

const sceneHtml = scenes.map((sc) => {
  const motion = sc.motion ?? "zoom";
  const kb = motion === "pan-up" ? "kb-up" : motion === "pan-down" ? "kb-down" : motion === "still" ? "kb-still" : "kb-zoom";
  const img = sc.shot ? `<img class="shot ${kb}" src="${dataUrl(sc.shot)}" alt="" style="animation-duration:${sc.seconds}s">` : "";
  const title = sc.title ? `<div class="title">${esc(sc.title)}</div>` : "";
  const sub = sc.sub ? `<div class="sub">${esc(sc.sub)}</div>` : "";
  const kicker = sc.kicker ? `<div class="kicker">${esc(sc.kicker)}</div>` : "";
  const caption = sc.caption ? `<div class="caption">${esc(sc.caption)}</div>` : "";
  const dark = sc.shot ? "" : " card";
  return `<section class="scene${dark}" data-start="${sc.start}" data-end="${sc.end}" style="--fade:${sc.fade ?? 0.5}s">
    <div class="frame">${img}</div>
    <div class="overlay">${kicker}${title}${sub}${caption}</div>
  </section>`;
}).join("\n");

const html = `<!doctype html><html><head><meta charset="utf-8"><style>
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap');
  :root{--paper:#fbfbf9;--ink:#1a1d21;--ink2:#4b5057;--ink3:#8a8f98;--terra:#c2410c;--line:#e6e6e2;--ok:#15803d}
  html,body{margin:0;width:${W}px;height:${H}px;background:var(--paper);overflow:hidden;font-family:Inter,system-ui,sans-serif;color:var(--ink)}
  .scene{position:absolute;inset:0;opacity:0;visibility:hidden}
  .frame{position:absolute;inset:0;overflow:hidden}
  .shot{position:absolute;left:50%;width:${Math.round(W * 0.92)}px;transform:translateX(-50%) scale(1);transform-origin:50% 0;border-radius:14px;box-shadow:0 30px 80px rgba(26,29,33,.16);top:var(--shot-top,${Math.round(H * 0.16)}px);animation-timing-function:linear;animation-fill-mode:both;animation-play-state:paused}
  .kb-zoom{animation-name:kbz}.kb-up{animation-name:kbu}.kb-down{animation-name:kbd}.kb-still{animation-name:none}
  @keyframes kbz{from{transform:translateX(-50%) scale(1)}to{transform:translateX(-50%) scale(1.06)}}
  @keyframes kbu{from{transform:translate(-50%,0)}to{transform:translate(-50%,-${Math.round(H * 0.12)}px)}}
  @keyframes kbd{from{transform:translate(-50%,-${Math.round(H * 0.10)}px)}to{transform:translate(-50%,0)}}
  .overlay{position:absolute;left:0;right:0;top:0;padding:${Math.round(H * 0.045)}px ${Math.round(W * 0.05)}px ${Math.round(H * 0.02)}px;background:var(--paper)}
  .kicker{font-family:'JetBrains Mono',monospace;font-size:${Math.round(H * 0.022)}px;letter-spacing:.12em;text-transform:uppercase;color:var(--terra);margin-bottom:${Math.round(H * 0.012)}px}
  .title{font-size:${Math.round(H * 0.058)}px;font-weight:700;letter-spacing:-.025em;line-height:1.08;max-width:${Math.round(W * 0.7)}px}
  .sub{font-size:${Math.round(H * 0.03)}px;color:var(--ink2);margin-top:${Math.round(H * 0.014)}px;max-width:${Math.round(W * 0.66)}px;line-height:1.35}
  .caption{font-family:'JetBrains Mono',monospace;font-size:${Math.round(H * 0.024)}px;color:var(--ink3);margin-top:${Math.round(H * 0.012)}px}
  .scene.card .overlay{top:50%;transform:translateY(-50%);background:none;text-align:left}
  .scene.card .title{font-size:${Math.round(H * 0.085)}px;max-width:${Math.round(W * 0.82)}px}
  .scene.card .sub{font-size:${Math.round(H * 0.036)}px;max-width:${Math.round(W * 0.78)}px}
  .brand{position:absolute;right:${Math.round(W * 0.05)}px;top:${Math.round(H * 0.045)}px;font-weight:700;font-size:${Math.round(H * 0.03)}px;display:flex;align-items:center;gap:10px;color:var(--ink)}
  .brand i{width:${Math.round(H * 0.024)}px;height:${Math.round(H * 0.024)}px;border-radius:999px;background:var(--terra);display:inline-block}
  .brand .u{font-family:'JetBrains Mono',monospace;font-weight:500;font-size:${Math.round(H * 0.022)}px;color:var(--ink3);margin-left:6px}
</style></head><body>
${sceneHtml}
<div class="brand"><i></i>Sage<span class="u">sagepays.xyz</span></div>
<script>
  const scenes=[...document.querySelectorAll('.scene')].map(el=>({el,a:+el.dataset.start,b:+el.dataset.end,f:parseFloat(getComputedStyle(el).getPropertyValue('--fade'))||0.5}));
  const total=${total};
  window.__seek=(t)=>{
    for(const s of scenes){
      let o=0;
      // crossfade: a scene fades in over f from its start and fades OUT over f after its end,
      // so the outgoing image dissolves under the incoming one — never a cut to blank paper.
      if(t>=s.a&&t<s.b+s.f){const fin=s.a===0?1:Math.min(1,(t-s.a)/s.f);const fout=t>=s.b?Math.max(0,1-(t-s.b)/s.f):1;o=Math.min(fin,fout);if(s.b>=total-0.001&&t>s.b-s.f)o=Math.min(o,(s.b-t)/s.f);}
      // captions never overlap: the outgoing caption is gone by the boundary, the incoming one
      // arrives after it — only the SHOTS dissolve through each other.
      let oc=0;const fo=0.35,fx=0.25;
      if(t>=s.a&&t<s.b){const cin=s.a===0?1:Math.min(1,(t-s.a)/fo);const cout=t>=s.b-fx?Math.max(0,(s.b-t)/fx):1;oc=Math.min(cin,cout);}
      const fr=s.el.querySelector('.frame'),ov=s.el.querySelector('.overlay');
      if(fr)fr.style.opacity=o.toFixed(3);if(ov)ov.style.opacity=(s.el.classList.contains('card')?o:oc).toFixed(3);
      const vis=Math.max(o,oc);s.el.style.opacity='1';s.el.style.visibility=vis>0?'visible':'hidden';
      if(vis>0)for(const anim of s.el.getAnimations({subtree:true})){anim.pause();anim.currentTime=Math.max(0,t-s.a)*1000;}
    }
  };
  document.fonts.ready.then(()=>{for(const s of scenes){const o=s.el.querySelector('.overlay');const img=s.el.querySelector('.shot');if(img&&o){img.style.setProperty('--shot-top',(o.getBoundingClientRect().height+${Math.round(H * 0.02)})+'px');}}window.__ready=true;});
</script></body></html>`;

mkdirSync(out, { recursive: true });
const tmpDir = join(out, `.frames-${board.name}`);
execFileSync("rm", ["-rf", tmpDir]); mkdirSync(tmpDir, { recursive: true });
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
const page = await ctx.newPage();
await page.setContent(html, { waitUntil: "load" });
await page.waitForFunction(() => window.__ready === true, null, { timeout: 30_000 });
const frames = Math.round(total * FPS);
const t0 = Date.now();
for (let i = 0; i < frames; i++) {
  await page.evaluate((t) => window.__seek(t), i / FPS);
  await page.screenshot({ path: join(tmpDir, `f${String(i).padStart(5, "0")}.png`), type: "png", animations: "disabled", caret: "hide" });
}
await ctx.close();
await browser.close();
const mp4 = join(out, `${board.name}.mp4`);
if (existsSync(mp4)) unlinkSync(mp4);
// lossless frames → H.264 at a quality X keeps intact (crf 16, slow preset, 4:2:0 for phones)
execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-framerate", String(FPS), "-i", join(tmpDir, "f%05d.png"), "-c:v", "libx264", "-preset", "slow", "-crf", CRF, "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-an", mp4]);
execFileSync("rm", ["-rf", tmpDir]);
console.log(`frames ${frames} in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
console.log(`rendered ${mp4} · ${total}s · ${W}x${H}`);

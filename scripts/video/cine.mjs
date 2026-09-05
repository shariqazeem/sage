/**
 * CUT a clip from recordings: hard cuts, speed ramps, punch-ins, type cards. The pace of a film,
 * every frame the real product.
 *
 *   node scripts/video/cine.mjs --cut docs/posts/videos/cuts/graph.json [--out docs/posts/videos/out]
 *
 * Cut list: { name, size:[W,H], fps, shots:[ …] } where a shot is
 *   { rec:"graph", from:"m:graph", to:"m:scrolled+0.4", speed:1.6, punch:{x:.5,y:.45,z:1.8,in:.6} }
 *   { card:"One person.\nOne slot.", sub:"World ID, once", seconds:1.2, tone:"ink"|"paper"|"terra" }
 * `from`/`to` are seconds or "m:<mark>[±s]" from the recording's marks file. Punch zooms to z at
 * (x,y) fractions over `in` seconds (ease-out) and holds. Output: <out>/<name>.mp4 (H.264, yuv420p).
 */
import { chromium } from "playwright";
import { readFileSync, mkdirSync, writeFileSync, readdirSync, rmSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { execFileSync } from "node:child_process";

const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : d; };
const cutPath = arg("cut"); if (!cutPath) throw new Error("--cut <cut.json>");
const cut = JSON.parse(readFileSync(cutPath, "utf8"));
const out = arg("out", "docs/posts/videos/out");
const recDir = resolve(cut.recDir ?? "docs/posts/videos/rec");
const [W, H] = cut.size ?? [1080, 1080];
const FPS = cut.fps ?? 30;
const work = join(out, `.work-${cut.name}`);
rmSync(work, { recursive: true, force: true });
mkdirSync(work, { recursive: true });

const marksCache = new Map();
const marksOf = (rec) => { if (!marksCache.has(rec)) marksCache.set(rec, JSON.parse(readFileSync(join(recDir, `${rec}.marks.json`), "utf8")).marks); return marksCache.get(rec); };
const at = (rec, v) => {
  if (typeof v === "number") return v;
  const m = /^m:([a-zA-Z0-9_-]+)([+-][0-9.]+)?$/.exec(String(v));
  if (!m) throw new Error(`bad time ${v}`);
  const base = marksOf(rec)[m[1]]; if (base == null) throw new Error(`no mark ${m[1]} in ${rec}`);
  return base + (m[2] ? Number(m[2]) : 0);
};
const ff = (args) => execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...args], { stdio: ["ignore", "inherit", "inherit"] });

// A punch-in as a zoompan expression: z eases from 1 to Z over IN seconds, centred on (X,Y).
function punchFilter(p, speed) {
  const Z = p.z ?? 1.6, IN = Math.max(0.05, (p.in ?? 0.6)), X = p.x ?? 0.5, Y = p.y ?? 0.5;
  const DX = p.dx ?? 0, DY = p.dy ?? 0, DRIFT = Math.max(0.1, p.drift ?? 3); // a slow drift of the centre, in seconds
  const frames = IN * FPS, driftFrames = DRIFT * FPS;
  const z = `1+(${Z}-1)*(1-pow(1-min(on/${frames.toFixed(2)},1),3))`;
  const cx = `(${X}+${DX}*min(on/${driftFrames.toFixed(2)},1))`, cy = `(${Y}+${DY}*min(on/${driftFrames.toFixed(2)},1))`;
  return `zoompan=z='${z}':x='(iw-iw/zoom)*${cx}':y='(ih-ih/zoom)*${cy}':d=1:fps=${FPS}:s=${W}x${H}`;
}

async function renderCard(shot, file) {
  const tone = shot.tone ?? "ink";
  const bg = tone === "ink" ? "#1a1d21" : tone === "terra" ? "#c2410c" : "#fbfbf9";
  const fg = tone === "paper" ? "#1a1d21" : "#fbfbf9";
  const rule = tone === "terra" ? "#fbfbf9" : "#c2410c";
  const sub = shot.sub ? `<div class="sub">${esc(shot.sub)}</div>` : "";
  const size = shot.big ? 118 : 92;
  const html = `<!doctype html><html><head><meta charset="utf-8">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@500;600;700&family=JetBrains+Mono:wght@500&display=swap">
<style>
html,body{margin:0;width:${W}px;height:${H}px;background:${bg};overflow:hidden}
.wrap{position:absolute;inset:0;display:flex;flex-direction:column;justify-content:center;padding:0 ${Math.round(W * 0.09)}px;box-sizing:border-box}
.t{font-family:Inter,Helvetica,Arial,sans-serif;font-weight:600;font-size:${size}px;line-height:1.02;letter-spacing:-.035em;color:${fg};white-space:pre-line;opacity:0;transform:translateY(34px);animation:in .52s cubic-bezier(.2,.8,.2,1) .08s forwards;text-wrap:balance}
.sub{font-family:"JetBrains Mono",Menlo,monospace;font-size:${Math.round(size * 0.3)}px;color:${fg};opacity:0;margin-top:28px;letter-spacing:.01em;animation:in .5s cubic-bezier(.2,.8,.2,1) .34s forwards}
.rule{height:6px;width:0;background:${rule};margin-bottom:34px;animation:rule .55s cubic-bezier(.2,.8,.2,1) .02s forwards}
@keyframes in{to{opacity:1;transform:translateY(0)}}
@keyframes rule{to{width:${Math.round(W * 0.14)}px}}
</style></head><body><div class="wrap"><div class="rule"></div><div class="t">${esc(shot.card)}</div>${sub}</div></body></html>`;
  const browser = await chromium.launch({ headless: true });
  const dir = join(work, `card-${shot._i}`); mkdirSync(dir, { recursive: true });
  const context = await browser.newContext({ viewport: { width: W, height: H }, recordVideo: { dir, size: { width: W, height: H } } });
  const page = await context.newPage();
  await page.setContent(html, { waitUntil: "networkidle" });
  await page.waitForTimeout(Math.round((shot.seconds ?? 1.2) * 1000) + 500);
  await context.close(); await browser.close();
  const webm = readdirSync(dir).find((f) => f.endsWith(".webm"));
  // Cards begin ~0.3s in (fonts + first paint), so trim from there.
  ff(["-ss", "0.30", "-i", join(dir, webm), "-t", String(shot.seconds ?? 1.2), "-vf", `fps=${FPS},scale=${W}:${H},format=yuv420p`, "-c:v", "libx264", "-preset", "fast", "-crf", "16", file]);
}
const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;");

// LOWER-THIRD CAPTIONS on recorded shots: the narration on screen, in the product's type, so the
// film reads muted. Text is pre-wrapped into a file per shot (drawtext wraps nothing itself).
const FONT = process.env.CINE_FONT ?? "/private/tmp/claude-501/-Users-macbookair-projects-SAGE/2916cf8f-4f37-4010-95d9-25206656196f/scratchpad/fonts/Inter-600.ttf";
const fontFile = existsSync(FONT) ? FONT : "/System/Library/Fonts/HelveticaNeue.ttc";
function wrap(text, max) { const words = String(text).split(/\s+/); const lines = []; let cur = ""; for (const w of words) { if ((cur + " " + w).trim().length > max && cur) { lines.push(cur); cur = w; } else cur = (cur + " " + w).trim(); } if (cur) lines.push(cur); return lines.join("\n"); }
function captionFilter(text, idx, dur) {
  const f = join(work, `cap-${idx}.txt`);
  // drawtext expands %{…} sequences inside a text file, so a literal percent must be doubled
  writeFileSync(f, wrap(text, W >= 1600 ? 58 : 34));
  const size = Math.round(W * (W >= 1600 ? 0.024 : 0.037));
  const esc = (v) => String(v).replace(/\\/g, "\\\\").replace(/:/g, "\\:").replace(/'/g, "\\'");
  return `drawtext=expansion=none:fontfile='${esc(fontFile)}':textfile='${esc(f)}':fontsize=${size}:fontcolor=0xfbfbf9:line_spacing=${Math.round(size * 0.22)}:box=1:boxcolor=0x1a1d21@0.9:boxborderw=${Math.round(size * 0.55)}:x=(w-text_w)/2:y=h-text_h-${Math.round(H * 0.085)}:enable='between(t,0.12,${(dur - 0.08).toFixed(2)})'`;
}

const parts = [];
let i = 0;
for (const shot of cut.shots) {
  shot._i = i;
  const file = join(work, `shot-${String(i).padStart(2, "0")}.mp4`);
  if (shot.card != null) {
    await renderCard(shot, file);
  } else {
    const src = join(recDir, `${shot.rec}.webm`);
    if (!existsSync(src)) throw new Error(`missing recording ${src}`);
    const from = at(shot.rec, shot.from ?? 0), to = at(shot.rec, shot.to ?? "m:end");
    const speed = shot.speed ?? 1;
    // NARRATION PACE. A narrated cut holds each captioned shot long enough to read (or speak) its
    // caption — about 2.3 words a second plus a beat — by freezing the last frame (tpad), so a
    // three-second scroll can carry a nine-second line without slow motion.
    let dur = (to - from) / speed;
    let pad = shot.hold ?? 0;
    if (shot.caption && (cut.narrated || shot.narrated)) {
      const words = String(shot.caption).trim().split(/\s+/).length;
      const need = words / (cut.wordsPerSecond ?? 2.3) + 0.7;
      if (need > dur + pad) pad = need - dur;
    }
    const vf = [
      `trim=start=${from.toFixed(3)}:end=${to.toFixed(3)}`,
      `setpts=(PTS-STARTPTS)/${speed}`,
      shot.punch ? punchFilter(shot.punch, speed) : `fps=${FPS},scale=${W}:${H}:flags=lanczos`,
      ...(pad > 0 ? [`tpad=stop_mode=clone:stop_duration=${pad.toFixed(2)}`] : []),
      ...(shot.caption ? [captionFilter(shot.caption, i, dur + pad)] : []),
      "format=yuv420p",
    ].join(",");
    dur += pad;
    ff(["-i", src, "-vf", vf, "-an", "-c:v", "libx264", "-preset", "fast", "-crf", "16", file]);
  }
  parts.push(file);
  i++;
}
const list = join(work, "list.txt");
writeFileSync(list, parts.map((p) => `file '${resolve(p)}'`).join("\n"));
mkdirSync(out, { recursive: true });
const final = join(out, `${cut.name}.mp4`);
// --audio <file>: a voiceover track muxed under the cut (trimmed to the picture; picture never stretched).
const audio = arg("audio", cut.audio ?? "");
if (audio && existsSync(audio)) {
  ff(["-f", "concat", "-safe", "0", "-i", list, "-i", audio, "-map", "0:v:0", "-map", "1:a:0", "-c:v", "libx264", "-preset", "medium", "-crf", "17", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "160k", "-af", "loudnorm=I=-16:TP=-1.5:LRA=11", "-shortest", "-movflags", "+faststart", "-r", String(FPS), final]);
} else {
  ff(["-f", "concat", "-safe", "0", "-i", list, "-c:v", "libx264", "-preset", "medium", "-crf", "17", "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-r", String(FPS), final]);
}
const dur = execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", final]).toString().trim();
console.log(`${final}  ${Number(dur).toFixed(1)}s  ${parts.length} shots`);

/**
 * THE KIT — the visual language of a Sage clip, as HTML builders. Dark stage, paper artifacts,
 * one terracotta accent, Inter for words, JetBrains Mono for numbers. Every element carries its
 * own timeline as CSS animations (`in`, optional `out`); the engine seeks them frame by frame.
 * Nothing is timed by wall-clock, so every render is identical and every frame is sharp.
 */
export const INK = "#17191c", PAPER = "#fbfaf6", TERRA = "#c2410c", GREEN = "#15803d", MUTED = "rgba(243,241,234,.55)";

const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");

/** animation shorthand: rise in at `at` for `dur`, optional exit at `out` */
export const anim = (name, at, dur = 0.7, out = null, outDur = 0.45) =>
  `animation:${name} ${dur}s ${at.toFixed(2)}s both cubic-bezier(.2,.8,.2,1)` + (out != null ? `, out ${outDur}s ${out.toFixed(2)}s both cubic-bezier(.4,0,.8,.4)` : "") + `;`;

export const CSS = `
:root{--ink:${INK};--paper:${PAPER};--terra:${TERRA};--green:${GREEN}}
*{box-sizing:border-box}
html,body{margin:0;width:var(--W);height:var(--H);overflow:hidden;background:var(--ink);color:#f3f1ea;font-family:Inter,-apple-system,Helvetica,Arial,sans-serif;-webkit-font-smoothing:antialiased}
*{animation-play-state:paused!important}
#stage{position:absolute;inset:0;overflow:hidden}
#cam{position:absolute;inset:0;transform-origin:50% 50%}
.wash{position:absolute;inset:0;background:radial-gradient(90% 60% at 80% 0%,rgba(194,65,12,.16),transparent 60%),radial-gradient(70% 50% at 10% 100%,rgba(255,255,255,.05),transparent 60%)}
.vignette{position:absolute;inset:0;background:radial-gradient(120% 120% at 50% 50%,transparent 55%,rgba(0,0,0,.55) 100%);pointer-events:none}
.grain{position:absolute;inset:-50%;width:200%;height:200%;opacity:.07;mix-blend-mode:overlay;pointer-events:none;background-image:url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='300' height='300'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='.9' numOctaves='2' stitchTiles='stitch'/></filter><rect width='300' height='300' filter='url(%23n)' opacity='.9'/></svg>")}
.mono{font-family:"JetBrains Mono",ui-monospace,Menlo,monospace;font-variant-numeric:tabular-nums}
.layer{position:absolute;inset:0;display:flex;flex-direction:column;justify-content:center;padding:0 calc(var(--W)*.09)}
.words{display:flex;flex-wrap:wrap;gap:0 .26em;font-weight:600;letter-spacing:-.04em;line-height:1.0;color:#f3f1ea}
.words .w{display:inline-block;will-change:transform,opacity,filter}
.words .t{color:var(--terra)}
.words .m{color:${MUTED}}
.rule{height:6px;width:0;background:var(--terra);border-radius:3px;margin-bottom:34px}
.sub{margin-top:26px;font-size:calc(var(--W)*.024);color:${MUTED};letter-spacing:.01em}
.art{background:var(--paper);color:#171715;border-radius:22px;padding:34px 38px;box-shadow:0 60px 120px -40px rgba(0,0,0,.85),0 0 0 1px rgba(255,255,255,.06);position:relative;overflow:hidden}
.art-h{display:flex;justify-content:space-between;font-family:"JetBrains Mono",monospace;font-size:calc(var(--W)*.015);letter-spacing:.09em;text-transform:uppercase;color:#8a8578;margin-bottom:18px}
.art-h .real{color:var(--green)}
.art-t{font-weight:600;font-size:calc(var(--W)*.034);letter-spacing:-.02em;line-height:1.15;margin:0 0 20px;color:#171715}
.art-list{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:14px}
.art-list li{display:flex;gap:16px;align-items:flex-start;font-size:calc(var(--W)*.021);line-height:1.4;color:#4a473f}
.art-list li .k{flex:none;font-family:"JetBrains Mono",monospace;font-size:calc(var(--W)*.015);color:var(--terra);margin-top:5px;letter-spacing:.06em}
.art-list li .ok{flex:none;width:26px;height:26px;border-radius:999px;background:rgba(21,128,61,.12);color:var(--green);display:inline-flex;align-items:center;justify-content:center;margin-top:2px}
.art-list li .no{flex:none;width:26px;height:26px;border-radius:999px;background:rgba(220,38,38,.12);color:#dc2626;display:inline-flex;align-items:center;justify-content:center;margin-top:2px}
.art-q{margin:20px 0 0;padding:14px 18px;border-left:3px solid var(--terra);background:rgba(194,65,12,.05);font-style:italic;font-size:calc(var(--W)*.02);line-height:1.45;color:#171715}
.art-f{display:flex;justify-content:space-between;gap:14px;margin-top:22px;padding-top:16px;border-top:1px solid rgba(23,23,21,.1);font-family:"JetBrains Mono",monospace;font-size:calc(var(--W)*.015);color:#8a8578}
.art-f b{color:#171715}.art-f .pay{color:var(--green);font-weight:700}
.sweep{position:absolute;top:-20%;bottom:-20%;left:-40%;width:30%;background:linear-gradient(105deg,transparent,rgba(255,255,255,.55),transparent);transform:skewX(-14deg);pointer-events:none}
.device{position:relative;border-radius:22px;overflow:hidden;background:#000;box-shadow:0 70px 120px -50px rgba(0,0,0,.9),0 0 0 1px rgba(255,255,255,.08)}
.device video,.device img{display:block;width:100%;height:100%;object-fit:cover;object-position:top}
.device-cap{margin-top:18px;font-family:"JetBrains Mono",monospace;font-size:calc(var(--W)*.016);color:${MUTED};letter-spacing:.04em;display:flex;justify-content:space-between}
.big{font-family:"JetBrains Mono",monospace;font-weight:600;font-size:calc(var(--W)*.2);letter-spacing:-.05em;line-height:.9;color:#f3f1ea}
.big .t{color:var(--terra)}
.ring{transform:rotate(-90deg)}
.ring .track{stroke:rgba(23,23,21,.12)}
.ring .arc{stroke:var(--terra);stroke-linecap:round}
.beam{position:absolute;left:0;right:0;top:8%;height:3px;background:linear-gradient(90deg,transparent,var(--terra) 25%,var(--terra) 75%,transparent);box-shadow:0 0 28px 4px rgba(194,65,12,.4);pointer-events:none}
.close{display:flex;flex-direction:column;align-items:flex-start;gap:18px}
.mark{width:calc(var(--W)*.075);height:calc(var(--W)*.075);border-radius:22%;background:var(--terra);display:flex;align-items:center;justify-content:center;font-weight:800;color:#fff;font-size:calc(var(--W)*.045)}
.close .name{font-weight:600;font-size:calc(var(--W)*.075);letter-spacing:-.04em}
.close .url{font-family:"JetBrains Mono",monospace;font-size:calc(var(--W)*.026);color:${MUTED}}
.tiles{display:grid;grid-template-columns:repeat(2,1fr);gap:16px}
.tile{background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);border-radius:18px;padding:22px 24px}
.tile .v{font-family:"JetBrains Mono",monospace;font-weight:600;font-size:calc(var(--W)*.06);letter-spacing:-.03em;color:#f3f1ea}
.tile .k{margin-top:8px;font-size:calc(var(--W)*.018);color:${MUTED};letter-spacing:.06em;text-transform:uppercase;font-family:"JetBrains Mono",monospace}
.tile.ok .v{color:#3fb865}.tile.no .v{color:#e5533d}
.rows{display:flex;flex-direction:column;gap:10px}
.row{display:flex;align-items:center;gap:16px;padding:14px 18px;border-radius:14px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.07);font-family:"JetBrains Mono",monospace;font-size:calc(var(--W)*.019);color:#e8e6e0}
.row .st{flex:none;width:22px;height:22px;border-radius:999px;display:inline-flex;align-items:center;justify-content:center}
.row .st.ok{background:rgba(63,184,101,.18);color:#3fb865}.row .st.no{background:rgba(229,83,61,.18);color:#e5533d}
.row .amt{margin-left:auto;font-weight:600}.row .amt.ok{color:#3fb865}.row .amt.no{color:#e5533d}
.row .rail{color:${MUTED};font-size:.85em}
.leg{display:flex;flex-direction:column;gap:0}
.leg li{list-style:none;display:grid;grid-template-columns:28px 1fr;gap:18px;padding:0 0 26px;position:relative}
.leg li .dot{width:14px;height:14px;border-radius:999px;background:var(--terra);margin:8px 0 0 7px;box-shadow:0 0 0 6px rgba(194,65,12,.18)}
.leg li .line{position:absolute;left:13px;top:30px;bottom:0;width:2px;background:rgba(23,23,21,.15)}
.leg li .lt{font-weight:600;font-size:calc(var(--W)*.028);letter-spacing:-.02em;color:#171715}
.leg li .lh{font-family:"JetBrains Mono",monospace;font-size:calc(var(--W)*.016);color:#8a8578;margin-top:6px}
.cap{position:absolute;left:8%;right:8%;bottom:7%;text-align:center;font-weight:500;font-size:calc(var(--W)*.021);line-height:1.35;color:#fbfaf6;background:rgba(23,25,28,.88);border:1px solid rgba(255,255,255,.08);border-radius:14px;padding:16px 26px;letter-spacing:-.005em}
.cursor{position:absolute;width:26px;height:26px;color:var(--terra);filter:drop-shadow(0 4px 6px rgba(0,0,0,.35))}
@keyframes rise{from{opacity:0;transform:translateY(34px);filter:blur(8px)}to{opacity:1;transform:none;filter:blur(0)}}
@keyframes fade{from{opacity:0}to{opacity:1}}
@keyframes pop{from{opacity:0;transform:scale(.92)}to{opacity:1;transform:none}}
@keyframes stamp{0%{opacity:0;transform:scale(1.6)}60%{opacity:1;transform:scale(.96)}100%{opacity:1;transform:none}}
@keyframes out{to{opacity:0;filter:blur(6px);transform:translateY(-16px)}}
@keyframes rule{from{width:0}to{width:calc(var(--W)*.12)}}
@keyframes sweep{from{left:-40%}to{left:120%}}
@keyframes dolly{from{transform:scale(1)}to{transform:scale(1.045)}}
@keyframes dollyOut{from{transform:scale(1.03)}to{transform:scale(1)}}
@keyframes draw{from{stroke-dashoffset:var(--len)}to{stroke-dashoffset:0}}
@keyframes beam{from{top:8%}to{top:92%}}
@keyframes cursorIn{from{opacity:0;transform:translate(60px,60px)}to{opacity:1;transform:none}}
`;

/** kinetic words: each word rises on its own beat; `t:` prefix = terracotta, `m:` = muted */
export function words(text, at, { size = 0.085, step = 0.07, dur = 0.55, out = null, W = 1080 } = {}) {
  const parts = String(text).split(/\s+/).filter(Boolean);
  const spans = parts.map((raw, i) => {
    const cls = raw.startsWith("t:") ? "w t" : raw.startsWith("m:") ? "w m" : "w";
    const wd = raw.replace(/^[tm]:/, "");
    return `<span class="${cls}" style="${anim("rise", at + i * step, dur, out, 0.4)}">${esc(wd)}</span>`;
  });
  return `<div class="words" style="font-size:calc(var(--W)*${size})">${spans.join("")}</div>`;
}

export const rule = (at, out = null) => `<div class="rule" style="${anim("rule", at, 0.6, out)}"></div>`;
export const sub = (text, at, out = null) => `<div class="sub" style="${anim("rise", at, 0.6, out)}">${esc(text)}</div>`;
export const layer = (inner, { at = 0, out = null, style = "" } = {}) => `<div class="layer" style="${anim("fade", at, 0.01, out, 0.35)}${style}">${inner}</div>`;

/** a paper artifact whose rows stagger in; `rows` = [{k, text}] or [{ok, text}] */
export function artifact({ head, real = "real run", title, rows = [], quote, foot, at, out = null, stagger = 0.22, beam = false, W = 1080 }) {
  const li = rows.map((r, i) => {
    const mark = r.k != null ? `<span class="k">${esc(r.k)}</span>` : r.ok === false ? `<span class="no" style="${anim("stamp", at + 0.5 + i * stagger, 0.45)}">✕</span>` : `<span class="ok" style="${anim("stamp", at + 0.5 + i * stagger, 0.45)}">✓</span>`;
    return `<li style="${anim("rise", at + 0.45 + i * stagger, 0.6)}">${mark}<span>${esc(r.text)}</span></li>`;
  }).join("");
  return `<div class="art" style="${anim("pop", at, 0.7, out)}">
    ${beam ? `<i class="beam" style="animation:beam 2.6s ${(at + 0.3).toFixed(2)}s both linear, out .4s ${(at + 2.9).toFixed(2)}s both"></i>` : ""}
    <div class="sweep" style="animation:sweep 1.4s ${(at + 0.9).toFixed(2)}s both cubic-bezier(.4,0,.2,1)"></div>
    <div class="art-h"><span>${esc(head)}</span><span class="real">${esc(real)}</span></div>
    ${title ? `<p class="art-t" style="${anim("rise", at + 0.25, 0.6)}">${title}</p>` : ""}
    <ul class="art-list">${li}</ul>
    ${quote ? `<p class="art-q" style="${anim("rise", at + 0.6 + rows.length * stagger, 0.6)}">&ldquo;${esc(quote)}&rdquo;</p>` : ""}
    ${foot ? `<div class="art-f" style="${anim("rise", at + 0.85 + rows.length * stagger, 0.6)}">${foot}</div>` : ""}
  </div>`;
}

/** a counter: text driven by the engine from `data-*` */
export const count = (from, to, at, dur, { fmt = "int", cls = "" } = {}) => `<span class="count ${cls}" data-from="${from}" data-to="${to}" data-in="${at}" data-dur="${dur}" data-fmt="${fmt}">${fmt === "usd" ? "$" + Number(from).toFixed(2) : from}</span>`;

/** a drawn ring */
export function ring(at, dur = 1.4, size = 120) {
  const r = size * 0.42, len = (2 * Math.PI * r).toFixed(2);
  return `<svg class="ring" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}"><circle class="track" cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke-width="${size * 0.07}"/><circle class="arc" cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke-width="${size * 0.07}" stroke-dasharray="${len}" style="--len:${len};stroke-dashoffset:${len};animation:draw ${dur}s ${at.toFixed(2)}s both cubic-bezier(.2,.8,.2,1)"/></svg>`;
}

/** a real recording inside a device frame; the engine seeks the video from `seek` at `at` */
export function device({ src, at, out = null, seek = 0, cap = "", right = "", width = 0.82, ratio = 1, W = 1080, dolly = true, focus = null }) {
  const w = Math.round(W * width), h = Math.round(w / ratio);
  // focus: a static, motivated framing on the element that matters — {x, y} in % of the page, scale
  const fs = focus ? `transform:scale(${focus.scale ?? 1.5});transform-origin:${focus.x ?? 50}% ${focus.y ?? 30}%;` : "";
  return `<div style="${anim("pop", at, 0.8, out)}">
    <div class="device" style="width:${w}px;height:${h}px;${dolly ? `animation:pop .8s ${at.toFixed(2)}s both cubic-bezier(.2,.8,.2,1), dolly 6s ${(at + 0.8).toFixed(2)}s both linear` : ""}">
      <video class="vid" muted playsinline preload="auto" src="${esc(src)}" data-in="${at}" data-seek="${seek}" style="${fs}"></video>
      <div class="sweep" style="animation:sweep 1.6s ${(at + 0.6).toFixed(2)}s both cubic-bezier(.4,0,.2,1)"></div>
    </div>
    <div class="device-cap"><span>${esc(cap)}</span><span>${esc(right)}</span></div>
  </div>`;
}

export const tiles = (items, at, step = 0.14, cols = 2) => `<div class="tiles" style="grid-template-columns:repeat(${cols},1fr)">${items.map((t, i) => `<div class="tile ${t.cls ?? ""}" style="${anim("rise", at + i * step, 0.6)}"><div class="v">${t.v}</div><div class="k">${esc(t.k)}</div></div>`).join("")}</div>`;

/** the narration, on screen: a lower third in the product's type, readable with the sound off */
export const caption = (text, at, out) => `<div class="cap" style="${anim("rise", at, 0.5, out, 0.35)}">${esc(text)}</div>`;

export const closeCard = (at, url = "sagepays.xyz", line = "Sage") => `<div class="close" style="${anim("rise", at, 0.7)}"><div class="mark" style="${anim("pop", at, 0.6)}">S</div><div class="name">${esc(line)}</div><div class="url">${esc(url)}</div></div>`;

export const cursor = (at, x, y, out = null) => `<svg class="cursor" viewBox="0 0 24 24" style="left:${x};top:${y};${anim("cursorIn", at, 0.7, out, 0.3)}"><path d="M4 3l7.5 17 2.6-6.9L21 10.5 4 3z" fill="currentColor"/></svg>`;

export function page({ W, H, body, cam = "" }) {
  return `<!doctype html><html><head><meta charset="utf-8">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@500;600;700;800&family=JetBrains+Mono:wght@500;600&display=swap">
<style>:root{--W:${W}px;--H:${H}px}${CSS}</style></head><body>
<div id="stage"><div class="wash"></div><div id="cam" style="${cam}">${body}</div><div class="vignette"></div><div class="grain"></div></div>
</body></html>`;
}

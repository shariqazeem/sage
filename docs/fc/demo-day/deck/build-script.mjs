// Builds the presenter's script from script.js: ../SCRIPT.md (text) and ../Sage-DemoDay-Script.pdf
// (large type, a thumbnail of each slide beside its words, the setup checklist first).
//   node build-script.mjs            (after build-deck.js; macOS: Keynote renders the thumbnails)
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const here = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = createRequire(import.meta.url)("./script.js");
const deck = path.join(here, "..", "Sage-DemoDay.pptx");
const tmp = path.join(here, ".thumbs");

// the live refusal count, read the same way build-deck.js reads it
const page = await (await fetch("https://sagepays.xyz/caribbean", { signal: AbortSignal.timeout(30000) })).text();
const refusals = (/(\d+) refusals with the reason/.exec(page.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ")) ?? [])[1];
if (!refusals) throw new Error("could not read the refusal count from sagepays.xyz/caribbean");
const fill = (t) => t.replace("{refusals}", refusals);

// 1. thumbnails: Keynote renders the real deck to PDF, poppler slices it
rmSync(tmp, { recursive: true, force: true }); mkdirSync(tmp);
const pdf = path.join(tmp, "deck.pdf");
const as = `on run argv
  tell application id "com.apple.Keynote"
    set doc to open (POSIX file (item 1 of argv))
    delay 2
    export doc to (POSIX file (item 2 of argv)) as PDF
    close doc saving no
  end tell
end run`;
writeFileSync(path.join(tmp, "x.applescript"), as);
execFileSync("osascript", [path.join(tmp, "x.applescript"), deck, pdf], { timeout: 120000 });
execFileSync("pdftoppm", ["-jpeg", "-r", "60", pdf, path.join(tmp, "s")]);
const thumbs = readdirSync(tmp).filter((f) => /^s-\d+\.jpg$/.test(f)).sort();
const img = (n) => `data:image/jpeg;base64,${readFileSync(path.join(tmp, thumbs[n - 1])).toString("base64")}`;
const label = (e) => (e.slide ? `${e.slide} · ${e.name}` : `${e.where} · ${e.name}`);

// 2. SCRIPT.md
const md = [
  "# Sage · Demo Day script (print the PDF, this is the same text)",
  "",
  "Generated from `deck/script.js` — edit words there. 6 minutes is the hard stop; the talk runs about 4:35.",
  "Lines marked **DO** are actions. Everything else you say.",
  "",
];
let prev = "0:00";
for (const e of SCRIPT) {
  md.push(`## ${label(e)} (${prev} → ${e.by})`);
  if (e.note) md.push(`*${e.note}*`, "");
  for (const l of e.lines) md.push(l.startsWith("DO ") ? `**DO: ${fill(l.slice(3))}**` : fill(l), "");
  if (e.ifStuck) { md.push("> **If it stalls**"); for (const l of e.ifStuck) md.push(`> - ${fill(l)}`); md.push(""); }
  prev = e.by;
}
writeFileSync(path.join(here, "..", "SCRIPT.md"), md.join("\n"));

// 3. the printable PDF
const esc = (t) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const setup = [
  "Share your ENTIRE screen (not one window). Do Not Disturb on. Close every other app.",
  "Keynote: Sage-DemoDay open and playing, on slide 1. The arrow key moves forward.",
  "Chrome, BUYER window (your normal profile, signed in to sagepays.xyz). Tab 1: sagepays.xyz/launch?do=pay with the sentence already typed in “Describe the work”. Tab 2: the BACKUP job (posted and launched this morning, nobody has submitted to it).",
  "Chrome, SELLER window (a second profile or an Incognito window), signed in with the seller's email. Any sagepays.xyz page open.",
  "Know the shop link by heart: https://sagepays.xyz/stage/shop.html",
  "This paper next to the laptop. Water. Phone face down, silent.",
];
let html = `<!doctype html><html><head><meta charset="utf-8"><style>
@page { size: A4; margin: 14mm 14mm 16mm; }
body { font: 15.5px/1.5 -apple-system, Helvetica, Arial, sans-serif; color: #1a1d21; }
h1 { font-size: 26px; margin: 0 0 4px; } .sub { color: #6b6f76; margin: 0 0 18px; }
.setup { border: 2px solid #c2410c; border-radius: 12px; padding: 12px 16px 6px; margin-bottom: 20px; }
.setup h2 { font-size: 16px; margin: 0 0 6px; color: #c2410c; letter-spacing: .06em; }
.setup li { margin: 0 0 6px; }
.row { display: grid; grid-template-columns: 210px 1fr; gap: 18px; padding: 14px 0; border-top: 1px solid #e7e5df; break-inside: avoid; }
.row img { width: 210px; border: 1px solid #d9d6ce; border-radius: 6px; }
.row h3 { margin: 0 0 2px; font-size: 18px; } .t { font: 600 13px/1 ui-monospace, Menlo, monospace; color: #6b6f76; margin-bottom: 8px; }
.note { color: #6b6f76; font-style: italic; margin: 0 0 6px; }
p { margin: 0 0 7px; } .do { font-weight: 800; color: #c2410c; text-transform: uppercase; font-size: 14px; letter-spacing: .02em; }
.stuck { margin-top: 8px; border-left: 4px solid #b45309; background: #fff7ed; padding: 8px 12px; border-radius: 0 8px 8px 0; font-size: 14px; }
.stuck b { color: #b45309; }
.live { background: #fdf1ea; border-radius: 10px; padding: 14px 12px; border-top: 0; margin: 6px 0; }
.badge { width: 210px; height: 118px; border-radius: 8px; background: #1a1d21; color: #9ca0a8; display: grid; place-content: center; text-align: center; font: 700 13px/1.4 ui-monospace, Menlo, monospace; letter-spacing: .12em; }
.badge b { display: block; color: #fff; font-size: 22px; letter-spacing: .06em; }
</style></head><body>
<h1>Sage · Demo Day script</h1>
<p class="sub">Future Caribbean · Sat 10 Oct · Finance &amp; MSME Capital, 1:15–2:45 PM AST (22:15 Pakistan) · runs about 4:35 · 6:00 hard stop</p>
<div class="setup"><h2>BEFORE YOU GO ON</h2><ol>${setup.map((s) => `<li>${esc(s)}</li>`).join("")}</ol>
<p>One straight line: Keynote slides 1–4 → Chrome (buyer, then seller) → back to Keynote for 5–8. If you blank: look at the screen, say what is on it, breathe, next line.</p></div>`;
prev = "0:00";
for (const e of SCRIPT) {
  const pic = e.slide ? `<img src="${img(e.slide)}">` : `<div class="badge">CHROME<b>${esc(e.where.split("·")[1].trim().toUpperCase())}</b></div>`;
  html += `<div class="row${e.where ? " live" : ""}">${pic}<div><h3>${esc(label(e))}</h3><div class="t">${prev} → ${e.by}</div>`;
  if (e.note) html += `<p class="note">${esc(e.note)}</p>`;
  for (const l of e.lines) html += l.startsWith("DO ") ? `<p class="do">${esc(fill(l.slice(3)))}</p>` : `<p>${esc(fill(l))}</p>`;
  if (e.ifStuck) html += `<div class="stuck"><b>IF IT STALLS</b>${e.ifStuck.map((l) => `<p>${esc(fill(l))}</p>`).join("")}</div>`;
  html += `</div></div>`;
  prev = e.by;
}
html += `</body></html>`;
const browser = await chromium.launch();
const p = await browser.newPage();
await p.setContent(html, { waitUntil: "load" });
await p.pdf({ path: path.join(here, "..", "Sage-DemoDay-Script.pdf"), format: "A4", printBackground: true, margin: { top: "14mm", bottom: "16mm", left: "14mm", right: "14mm" } });
await browser.close();
rmSync(tmp, { recursive: true, force: true });
console.log("wrote SCRIPT.md and Sage-DemoDay-Script.pdf (refusals:", refusals + ")");

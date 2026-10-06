// Builds Sage-DemoDay.pptx (opens in Keynote and PowerPoint) for Future Caribbean Demo Day.
//
//   cd docs/fc/demo-day/deck && npm install && node build-deck.js
//
// The numbers on slide 5 are READ from sagepays.xyz/caribbean at build time, never typed: rebuild on
// Saturday afternoon so they are current. The build refuses to run if it can't read them.
// Screenshots (assets/receipt.png, assets/record.png) are real pages captured by capture.mjs.
// The script for each slide is in its speaker notes and in ../SCRIPT.md (same words).
const pptxgen = require("pptxgenjs");
const fs = require("fs");
const path = require("path");

const SCRIPT = require("./script.js");
// Speaker notes come from script.js (the same words as SCRIPT.md and the printable script).
function notesFor(n, N) {
  const e = SCRIPT.find((x) => x.slide === n);
  const fill = (t) => t.replace("{refusals}", N.refusals);
  const out = [`${e.slide} · ${e.name.toUpperCase()} (to ${e.by})${e.note ? ". " + e.note : ""}`, ""];
  for (const l of e.lines) out.push(l.startsWith("DO ") ? `>> ${fill(l.slice(3)).toUpperCase()}` : fill(l));
  if (e.ifStuck) { out.push("", "IF IT STALLS:"); for (const l of e.ifStuck) out.push(`- ${fill(l)}`); }
  return out.join("\n");
}
const A = (f) => path.join(__dirname, "assets", f);
const has = (f) => fs.existsSync(A(f));
const OUT = path.join(__dirname, "..", "Sage-DemoDay.pptx");

// ── palette: Sage's own ("receipt minimalism") ─────────────────────────────────────────────────
const INK = "1A1D21", INK2 = "3D4148", MUTED = "6B6F76", FAINT = "A4A7AD", LINE = "E7E5DF", LINE2 = "D9D6CE";
const PAPER = "FBFBF9", CARD = "FFFFFF", ACC = "C2410C", ACC_SOFT = "FDF1EA";
const DARK_TEXT = "E9E7E1", DARK_MUTED = "9CA0A8", DARK_CARD = "24272C";
const FONT = "Arial"; // ships with macOS, Keynote and Office: nothing gets substituted on stage
const W = 13.333;

async function liveNumbers() {
  const r = await fetch("https://sagepays.xyz/caribbean", { signal: AbortSignal.timeout(30000) });
  const t = (await r.text()).replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, "").replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ");
  const pick = (re, name) => { const m = re.exec(t); if (!m) throw new Error(`could not read "${name}" from sagepays.xyz/caribbean`); return m[1]; };
  return {
    settled: pick(/\$([\d,]+\.\d{2}) settled/, "settled"),
    payments: pick(/(\d+) payments on mainnet/, "payments"),
    refusals: pick(/(\d+) refusals with the reason/, "refusals"),
    people: pick(/(\d+) people paid/, "people paid"),
    median: pick(/(\d+) min median/, "median"),
    asOf: new Date().toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }),
  };
}

// one fresh options object per call (pptxgenjs mutates them)
const shadow = () => ({ type: "outer", color: "1A1D21", opacity: 0.18, blur: 12, offset: 4, angle: 90 });
const T = (slide, text, o) => slide.addText(text, { fontFace: FONT, isTextBox: true, margin: 0, color: INK, valign: "top", ...o });

function eyebrow(slide, text, x, y, w, color = MUTED) {
  T(slide, text, { x, y, w, h: 0.35, fontSize: 13, bold: true, charSpacing: 3, color });
}

function mark(slide, x, y, size) {
  slide.addShape("roundRect", { x, y, w: size, h: size, fill: { color: ACC }, line: { color: ACC, width: 0 }, rectRadius: size * 0.22, objectName: "Sage mark" });
}

function card(slide, x, y, w, h, o = {}) {
  slide.addShape("roundRect", { x, y, w, h, fill: { color: o.fill ?? CARD }, line: { color: o.line ?? LINE2, width: 1 }, rectRadius: 0.14, shadow: o.flat ? undefined : shadow(), objectName: o.name ?? "card" });
}

function screenshot(slide, file, x, y, w, h, label) {
  card(slide, x, y, w, h, { name: `${label} frame` });
  if (has(file)) slide.addImage({ path: A(file), x: x + 0.08, y: y + 0.08, w: w - 0.16, h: h - 0.16, sizing: { type: "contain", w: w - 0.16, h: h - 0.16 }, altText: label });
  else T(slide, `${label}\n(captured after the rehearsal run)`, { x, y: y + h / 2 - 0.4, w, h: 0.8, fontSize: 16, color: FAINT, align: "center" });
}

function numbered(slide, n, x, y, title, body, o = {}) {
  slide.addShape("ellipse", { x, y, w: 0.5, h: 0.5, fill: { color: o.fill ?? ACC }, line: { color: o.fill ?? ACC, width: 0 } });
  T(slide, String(n), { x, y, w: 0.5, h: 0.5, fontSize: 16, bold: true, color: "FFFFFF", align: "center", valign: "middle" });
  T(slide, title, { x: x + 0.75, y: y - 0.02, w: o.w ?? 3.4, h: 0.42, fontSize: o.titleSize ?? 20, bold: true, color: o.titleColor ?? INK });
  if (body) T(slide, body, { x: x + 0.75, y: y + 0.42, w: o.w ?? 3.4, h: o.bodyH ?? 0.7, fontSize: o.bodySize ?? 15, color: o.bodyColor ?? MUTED });
}

async function main() {
  const N = await liveNumbers();
  console.log("live numbers:", N);

  const pres = new pptxgen();
  pres.layout = "LAYOUT_WIDE"; // 13.333 × 7.5 in
  pres.author = "Shariq Shaukat";
  pres.title = "Sage · Future Caribbean Demo Day";
  pres.theme = { headFontFace: FONT, bodyFontFace: FONT };

  // layouts: one light content frame (with a title placeholder), one blank light, one dark stage
  const footer = [
    { rect: { x: 0.75, y: 6.86, w: 0.2, h: 0.2, fill: { color: ACC } } },
    { text: { text: "Sage", options: { x: 1.03, y: 6.78, w: 1.5, h: 0.36, fontFace: FONT, fontSize: 14, bold: true, color: INK, margin: 0, valign: "middle" } } },
  ];
  pres.defineSlideMaster({
    title: "SAGE_LIGHT_TITLE", background: { color: PAPER }, objects: footer,
    slideNumber: { x: 12.0, y: 6.8, w: 0.6, h: 0.32, fontFace: FONT, fontSize: 11, color: FAINT, align: "right" },
    placeholders: undefined,
  });
  pres.defineSlideMaster({
    title: "SAGE_LIGHT", background: { color: PAPER }, objects: footer,
    slideNumber: { x: 12.0, y: 6.8, w: 0.6, h: 0.32, fontFace: FONT, fontSize: 11, color: FAINT, align: "right" },
  });
  pres.defineSlideMaster({ title: "SAGE_DARK", background: { color: INK }, objects: [] });

  const titled = (slide, runs) => T(slide, runs, { x: 0.75, y: 0.6, w: 11.8, h: 1.0, fontSize: 36, bold: true, valign: "middle" });

  // ── 1 · OPENING ──────────────────────────────────────────────────────────────────────────────
  pres.addSection({ title: "Opening" });
  let s = pres.addSlide({ masterName: "SAGE_DARK", sectionTitle: "Opening" });
  eyebrow(s, "FUTURE CARIBBEAN 2026  ·  FINANCE, PAYMENTS & MSME CAPITAL", 0.75, 0.65, 11.8, DARK_MUTED);
  mark(s, 0.75, 1.95, 1.3);
  T(s, "Sage", { x: 2.4, y: 1.7, w: 8, h: 1.8, fontSize: 120, bold: true, color: "FFFFFF", valign: "middle" });
  T(s, "An AI agent that pays people for verified work.", { x: 0.75, y: 3.75, w: 11.8, h: 0.7, fontSize: 30, color: DARK_TEXT });
  s.addShape("roundRect", { x: 0.75, y: 4.8, w: 9.9, h: 0.78, fill: { color: DARK_CARD }, line: { color: ACC, width: 1.25 }, rectRadius: 0.39 });
  s.addShape("ellipse", { x: 1.08, y: 5.08, w: 0.22, h: 0.22, fill: { color: ACC }, line: { color: ACC, width: 0 } });
  T(s, "In the next six minutes, it will pay someone. Live, with real money.", { x: 1.5, y: 4.8, w: 9.0, h: 0.78, fontSize: 20, bold: true, color: "FFFFFF", valign: "middle" });
  T(s, "Shariq Shaukat  ·  Founder", { x: 0.75, y: 6.7, w: 6, h: 0.4, fontSize: 15, color: DARK_MUTED });
  T(s, "sagepays.xyz", { x: 8.6, y: 6.7, w: 4, h: 0.4, fontSize: 15, color: DARK_MUTED, align: "right" });
  s.addNotes(notesFor(1, N));

  // ── 2 · THE SELLER ───────────────────────────────────────────────────────────────────────────
  pres.addSection({ title: "Problem" });
  s = pres.addSlide({ masterName: "SAGE_LIGHT", sectionTitle: "Problem" });
  s.addShape("roundRect", { x: 1.3, y: 0.75, w: 3.6, h: 5.75, fill: { color: "F3F2EE" }, line: { color: INK, width: 7 }, rectRadius: 0.45, objectName: "phone" });
  s.addShape("roundRect", { x: 2.55, y: 0.95, w: 1.1, h: 0.24, fill: { color: INK }, line: { color: INK, width: 0 }, rectRadius: 0.12 });
  const bubble = (x, y, w, h, text, meta, fill) => {
    s.addShape("roundRect", { x, y, w, h, fill: { color: fill, transparency: 35 }, line: { color: fill, width: 0 }, rectRadius: 0.16 });
    T(s, [{ text, options: { breakLine: true } }, { text: meta, options: { fontSize: 10, color: FAINT } }], { x: x + 0.15, y: y + 0.12, w: w - 0.3, h: h - 0.2, fontSize: 13, color: FAINT });
  };
  bubble(1.55, 1.5, 2.75, 0.95, "Order of 40 delivered to the hotel this morning.", "Seller · 09:12", CARD);
  bubble(1.95, 2.62, 2.7, 0.9, "Got them, thank you. Sent J$48,000.", "Buyer · 11:40", "E7F2E4");
  bubble(1.55, 3.7, 2.6, 0.8, "Received. Same again next week?", "Seller · 11:42", CARD);
  T(s, "The money moved.\nThe proof stayed in a chat.", { x: 1.45, y: 5.0, w: 3.3, h: 1.0, fontSize: 15, bold: true, color: ACC, align: "center", valign: "middle" });
  eyebrow(s, "A SELLER IN KINGSTON", 5.9, 1.55, 6.5);
  T(s, "She delivers.\nShe gets paid.", { x: 5.9, y: 2.0, w: 6.7, h: 1.9, fontSize: 48, bold: true });
  T(s, "To a bank, she doesn't exist.", { x: 5.9, y: 4.05, w: 6.7, h: 1.5, fontSize: 48, bold: true, color: ACC });
  s.addNotes(notesFor(2, N));

  // ── 3 · THE GAP ──────────────────────────────────────────────────────────────────────────────
  s = pres.addSlide({ masterName: "SAGE_LIGHT", sectionTitle: "Problem" });
  eyebrow(s, "THE GAP", 0.75, 0.7, 6);
  T(s, "90%", { x: 0.75, y: 1.15, w: 5.6, h: 2.1, fontSize: 140, bold: true, valign: "middle" });
  T(s, "of jobs in Jamaica are in micro, small and medium businesses", { x: 0.75, y: 3.35, w: 5.4, h: 0.95, fontSize: 21, color: INK2 });
  T(s, "40%+", { x: 7.0, y: 1.15, w: 5.6, h: 2.1, fontSize: 140, bold: true, valign: "middle" });
  T(s, "of firms say access to finance is a major constraint", { x: 7.0, y: 3.35, w: 5.4, h: 0.95, fontSize: 21, color: INK2 });
  T(s, [{ text: "Not bad businesses. " }, { text: "Unrecorded ones.", options: { color: ACC } }], { x: 0.75, y: 4.85, w: 11.8, h: 0.8, fontSize: 38, bold: true });
  T(s, "World Bank, “From Dreams to Thriving Business”, April 2025", { x: 0.75, y: 5.8, w: 11, h: 0.4, fontSize: 12, color: FAINT });
  s.addNotes(notesFor(3, N));

  // ── 4 · WHAT SAGE IS ─────────────────────────────────────────────────────────────────────────
  pres.addSection({ title: "Sage" });
  s = pres.addSlide({ masterName: "SAGE_LIGHT_TITLE", sectionTitle: "Sage" });
  eyebrow(s, "WHAT SAGE IS", 0.75, 0.55, 6);
  T(s, "Sage fixes the record by fixing the payment", { x: 0.75, y: 0.95, w: 11.8, h: 0.9, fontSize: 40, bold: true });
  const steps = [
    ["The work", "Described once, in your own currency"],
    ["Sage checks it", "Opens the delivery itself, and can say no"],
    ["Paid in minutes", "Digital dollars, a flat fee, a public receipt"],
    ["A credit record", "Every payment becomes verified income"],
    ["A lender reads it", "In one call, no collateral needed"],
  ];
  const sx = 0.75, gap = 2.42, cy = 2.75;
  s.addShape("line", { x: sx + 0.4, y: cy + 0.4, w: gap * 4, h: 0, line: { color: LINE2, width: 2 } });
  steps.forEach(([t, d], i) => {
    const x = sx + i * gap, hot = i === 1;
    s.addShape("ellipse", { x, y: cy, w: 0.8, h: 0.8, fill: { color: hot ? ACC : CARD }, line: { color: hot ? ACC : INK, width: 1.75 } });
    T(s, String(i + 1), { x, y: cy, w: 0.8, h: 0.8, fontSize: 20, bold: true, color: hot ? "FFFFFF" : INK, align: "center", valign: "middle" });
    T(s, t, { x, y: cy + 1.1, w: 2.3, h: 0.85, fontSize: 19, bold: true });
    T(s, d, { x, y: cy + 1.95, w: 2.2, h: 1.0, fontSize: 15, color: MUTED });
  });
  s.addNotes(notesFor(4, N));

  // ── 5 · NOT A PROTOTYPE ──────────────────────────────────────────────────────────────────────
  s = pres.addSlide({ masterName: "SAGE_LIGHT", sectionTitle: "Sage" });
  s.addImage({ path: A("certificate.png"), x: 0.75, y: 0.95, w: 6.3, h: 6.3 / (1400 / 1082), rotate: -1.5, shadow: shadow(), altText: "1st Place Grand Champion certificate, OpenClaw Summer Bootcamp 2026" });
  s.addShape("roundRect", { x: 7.65, y: 0.95, w: 4.3, h: 0.55, fill: { color: ACC_SOFT }, line: { color: ACC_SOFT, width: 0 }, rectRadius: 0.27 });
  T(s, "1ST PLACE  ·  GRAND CHAMPION", { x: 7.65, y: 0.95, w: 4.3, h: 0.55, fontSize: 14, bold: true, color: ACC, charSpacing: 2, align: "center", valign: "middle" });
  T(s, "Not a prototype", { x: 7.65, y: 1.75, w: 5.2, h: 0.9, fontSize: 40, bold: true });
  T(s, "Real people, real money, since July", { x: 7.65, y: 2.75, w: 5.2, h: 0.5, fontSize: 21 });
  T(s, "OpenClaw Summer Bootcamp 2026: Metis Foundation, GOAT Network, ClawUp, CryptoChicks", { x: 7.65, y: 3.35, w: 5.0, h: 0.8, fontSize: 15, color: MUTED });
  const stats = [[`$${N.settled}`, "settled"], [N.payments, "payments"], [N.people, "people paid"], [N.refusals, "refusals, each explained"]];
  stats.forEach(([v, l], i) => {
    const x = 7.65 + (i % 2) * 2.6, y = 4.35 + Math.floor(i / 2) * 1.05;
    T(s, v, { x, y, w: 2.5, h: 0.55, fontSize: 30, bold: true });
    T(s, l, { x, y: y + 0.55, w: 2.5, h: 0.35, fontSize: 13, color: MUTED });
  });
  T(s, `Read from the public ledger at sagepays.xyz/explorer, ${N.asOf}`, { x: 7.65, y: 6.45, w: 5.2, h: 0.3, fontSize: 11, color: FAINT });
  s.addNotes(notesFor(5, N));

  // ── 6 · A BUDGET, NOT YOUR KEYS ──────────────────────────────────────────────────────────────
  s = pres.addSlide({ masterName: "SAGE_LIGHT", sectionTitle: "Sage" });
  eyebrow(s, "WHY TRUST AN AGENT WITH MONEY", 0.75, 0.55, 8);
  T(s, [{ text: "A budget, " }, { text: "not your keys", options: { color: ACC } }], { x: 0.75, y: 0.95, w: 11.8, h: 1.0, fontSize: 44, bold: true });
  card(s, 0.75, 2.3, 4.55, 2.75);
  T(s, "THE AGENT", { x: 1.1, y: 2.6, w: 3.9, h: 0.35, fontSize: 13, bold: true, charSpacing: 3, color: MUTED });
  T(s, "Decides who gets paid", { x: 1.1, y: 3.0, w: 3.9, h: 0.6, fontSize: 26, bold: true });
  T(s, "Reads the work, quotes it, and explains every yes and every no.", { x: 1.1, y: 3.7, w: 3.9, h: 1.0, fontSize: 16, color: MUTED });
  s.addShape("line", { x: 5.45, y: 3.67, w: 1.05, h: 0, line: { color: INK, width: 2, endArrowType: "triangle" } });
  card(s, 6.65, 2.3, 5.95, 2.75);
  T(s, "THE VAULT, ON CHAIN", { x: 7.0, y: 2.6, w: 5.3, h: 0.35, fontSize: 13, bold: true, charSpacing: 3, color: ACC });
  T(s, "Decides how much", { x: 7.0, y: 3.0, w: 5.3, h: 0.6, fontSize: 26, bold: true });
  const chip = (x, y, w, text, lock) => {
    s.addShape("roundRect", { x, y, w, h: 0.42, fill: { color: lock ? ACC_SOFT : PAPER }, line: { color: lock ? ACC : LINE2, width: 1 }, rectRadius: 0.21 });
    T(s, text, { x, y, w, h: 0.42, fontSize: 12, color: lock ? ACC : INK2, align: "center", valign: "middle", bold: lock });
  };
  chip(7.0, 3.78, 2.35, "fixed reward per job"); chip(9.5, 3.78, 1.75, "total budget");
  chip(7.0, 4.32, 2.45, "one payout per person"); chip(9.6, 4.32, 2.8, "the agent can't change any of it", true);
  T(s, "Every payment leaves a public receipt. Every refusal leaves its reason.", { x: 0.75, y: 5.5, w: 11.8, h: 0.6, fontSize: 24, color: INK2 });
  s.addNotes(notesFor(6, N));

  // ── 7 · LIVE ─────────────────────────────────────────────────────────────────────────────────
  pres.addSection({ title: "Live" });
  s = pres.addSlide({ masterName: "SAGE_DARK", sectionTitle: "Live" });
  s.addShape("roundRect", { x: 0.75, y: 0.7, w: 3.55, h: 0.55, fill: { color: INK }, line: { color: ACC, width: 1.25 }, rectRadius: 0.27 });
  s.addShape("ellipse", { x: 1.0, y: 0.88, w: 0.19, h: 0.19, fill: { color: ACC }, line: { color: ACC, width: 0 } });
  T(s, "LIVE  ·  REAL MONEY", { x: 1.3, y: 0.7, w: 2.9, h: 0.55, fontSize: 14, bold: true, charSpacing: 3, color: ACC, valign: "middle" });
  T(s, "Let's do it live.", { x: 0.75, y: 1.55, w: 11.8, h: 1.25, fontSize: 66, bold: true, color: "FFFFFF", valign: "middle" });
  s.addShape("roundRect", { x: 0.75, y: 3.15, w: 7.4, h: 3.0, fill: { color: PAPER }, line: { color: PAPER, width: 0 }, rectRadius: 0.16 });
  T(s, "THE JOB, POSTED EARLIER TODAY", { x: 1.15, y: 3.45, w: 6.6, h: 0.35, fontSize: 12, bold: true, charSpacing: 3, color: MUTED });
  T(s, "Put your shop's price list online", { x: 1.15, y: 3.85, w: 6.6, h: 0.6, fontSize: 28, bold: true });
  T(s, "Three items, each priced in J$, on a public page.", { x: 1.15, y: 4.5, w: 6.6, h: 0.45, fontSize: 18, color: INK2 });
  T(s, [{ text: "J$160  ", options: { fontSize: 44, bold: true, color: INK } }, { text: "≈ $1.01 in USDC  ·  Arc", options: { fontSize: 16, color: MUTED } }], { x: 1.15, y: 5.1, w: 6.6, h: 0.8, valign: "middle" });
  [["I submit my link, on my phone"], ["Sage opens the page and checks it"], ["The vault pays. Nobody approves it."]].forEach(([t], i) =>
    numbered(s, i + 1, 8.75, 3.35 + i * 0.95, t, null, { w: 3.6, titleSize: 18, titleColor: DARK_TEXT }));
  T(s, "I posted the job as the buyer. I'm the seller, on my phone. Sage decides on its own.", { x: 0.75, y: 6.55, w: 11.8, h: 0.4, fontSize: 14, color: DARK_MUTED });
  s.addNotes(notesFor(7, N));

  // ── 8 · THE RECEIPT ──────────────────────────────────────────────────────────────────────────
  s = pres.addSlide({ masterName: "SAGE_LIGHT", sectionTitle: "Live" });
  T(s, "Every payout leaves a receipt anyone can open", { x: 0.75, y: 0.6, w: 11.8, h: 0.9, fontSize: 36, bold: true });
  screenshot(s, "receipt.png", 0.75, 1.75, 7.35, 4.6, "A real decision receipt");
  T(s, "The decision Sage recorded on a rehearsal run, earlier today", { x: 0.75, y: 6.42, w: 7.35, h: 0.3, fontSize: 11, color: FAINT });
  numbered(s, 1, 8.6, 2.0, "The decision", "Pay, and how sure it was, against an 85% bar it can't lower.");
  numbered(s, 2, 8.6, 3.35, "The reason", "What it checked on the page, in plain words, item by item.");
  numbered(s, 3, 8.6, 4.7, "The transaction", "Settled on a public chain. Anyone can check it.");
  s.addNotes(notesFor(8, N));

  // ── 9 · THE RECORD ───────────────────────────────────────────────────────────────────────────
  pres.addSection({ title: "Finance" });
  s = pres.addSlide({ masterName: "SAGE_LIGHT", sectionTitle: "Finance" });
  eyebrow(s, "THE PART THAT MATTERS FOR FINANCE", 0.75, 0.5, 8);
  T(s, "That payment just became a credit record", { x: 0.75, y: 0.85, w: 11.8, h: 0.8, fontSize: 36, bold: true });
  screenshot(s, "record.png", 0.75, 1.85, 11.85, 3.55, "The seller's verified work record");
  T(s, "Excerpt of the seller's live record on sagepays.xyz/record, after this week's runs", { x: 0.75, y: 5.45, w: 11.85, h: 0.3, fontSize: 11, color: FAINT });
  numbered(s, 1, 0.75, 5.9, "Verified income", "30 and 90 days, receipts only.", { w: 3.0, titleSize: 18, bodySize: 13, bodyH: 0.4 });
  numbered(s, 2, 4.85, 5.9, "Who paid, how long", "Distinct payers, tenure, pass rate.", { w: 3.0, titleSize: 18, bodySize: 13, bodyH: 0.4 });
  numbered(s, 3, 8.95, 5.9, "One call for a lender", "JSON, CSV or a printed statement.", { w: 3.0, titleSize: 18, bodySize: 13, bodyH: 0.4 });
  s.addNotes(notesFor(9, N));

  // ── 10 · THE REGION ──────────────────────────────────────────────────────────────────────────
  s = pres.addSlide({ masterName: "SAGE_LIGHT", sectionTitle: "Finance" });
  T(s, "Priced in local money. Paid in digital dollars.", { x: 0.75, y: 0.6, w: 11.8, h: 0.9, fontSize: 34, bold: true });
  const MX = 0.75, MY = 1.75, MW = 6.3, MH = 4.85;
  const P = (x, y) => [MX + (x / 1000) * MW, MY + (y / 760) * MH];
  const places = [["B$", "The Bahamas", 330, 60, "r"], ["BZ$", "Belize", 40, 330, "r"], ["J$", "Jamaica", 230, 360, "r"], ["G", "Haiti", 440, 250, "r"], ["RD$", "Dominican Rep.", 620, 190, "r"], ["EC$", "Eastern Caribbean", 790, 330, "r"], ["Bds$", "Barbados", 860, 440, "r"], ["TT$", "Trinidad & Tobago", 760, 540, "r"], ["G$", "Guyana", 700, 650, "l"], ["SRD", "Suriname", 840, 700, "r"]];
  const [hx, hy] = P(380, 560);
  for (const [, , x, y] of places) {
    const [nx, ny] = P(x, y);
    const dx = nx - hx, dy = ny - hy;
    s.addShape("line", { x: Math.min(hx, nx), y: Math.min(hy, ny), w: Math.max(Math.abs(dx), 0.01), h: Math.max(Math.abs(dy), 0.01), flipV: dx * dy < 0, line: { color: ACC, width: 1, dashType: "dash", transparency: 55 } });
  }
  for (const [code, name, x, y, side] of places) {
    const [nx, ny] = P(x, y);
    s.addShape("ellipse", { x: nx - 0.17, y: ny - 0.17, w: 0.34, h: 0.34, fill: { color: ACC, transparency: 82 }, line: { color: ACC, width: 1, transparency: 50 } });
    s.addShape("ellipse", { x: nx - 0.08, y: ny - 0.08, w: 0.16, h: 0.16, fill: { color: ACC }, line: { color: ACC, width: 0 } });
    const lw = 2.0, tx = side === "l" ? nx - 0.28 - lw : side === "u" ? nx - lw / 2 : nx + 0.28, ty = side === "u" ? ny - 0.78 : ny - 0.22;
    const align = side === "l" ? "right" : side === "u" ? "center" : "left";
    T(s, [{ text: code, options: { bold: true, fontSize: 16, color: INK, breakLine: true } }, { text: name, options: { fontSize: 11, color: MUTED } }], { x: tx, y: ty, w: lw, h: 0.55, align });
  }
  s.addShape("roundRect", { x: hx - 1.0, y: hy - 0.28, w: 2.0, h: 0.56, fill: { color: INK }, line: { color: INK, width: 0 }, rectRadius: 0.14 });
  T(s, "USDC  ·  Sage", { x: hx - 1.0, y: hy - 0.28, w: 2.0, h: 0.56, fontSize: 14, bold: true, color: "FFFFFF", align: "center", valign: "middle" });
  T(s, "Cost of sending $200", { x: 7.6, y: 1.85, w: 5.0, h: 0.4, fontSize: 16, bold: true });
  T(s, "World Bank remittance prices, 2023", { x: 7.6, y: 2.22, w: 5.0, h: 0.3, fontSize: 11, color: FAINT });
  const bars = [["Jamaica", 3.59, "3.59%"], ["Haiti", 4.70, "4.70%"], ["Guyana", 7.92, "7.92%"], ["Sage", 0.05, "$0.10 flat"]];
  bars.forEach(([label, v, txt], i) => {
    const y = 2.75 + i * 0.6, sage = label === "Sage", bw = Math.max(0.06, (v / 7.92) * 2.8);
    T(s, label, { x: 7.6, y, w: 1.05, h: 0.42, fontSize: 15, bold: sage, color: sage ? ACC : INK2, valign: "middle" });
    s.addShape("rect", { x: 8.7, y: y + 0.08, w: 2.8, h: 0.26, fill: { color: "EFEDE7" }, line: { color: "EFEDE7", width: 0 } });
    s.addShape("rect", { x: 8.7, y: y + 0.08, w: bw, h: 0.26, fill: { color: sage ? ACC : FAINT }, line: { color: sage ? ACC : FAINT, width: 0 } });
    T(s, txt, { x: 11.6, y, w: 1.0, h: 0.42, fontSize: 14, bold: true, color: sage ? ACC : INK, align: "right", valign: "middle" });
  });
  T(s, "A flat $0.10 per payment is Sage's fee. The person paid keeps 100%.", { x: 7.45, y: 5.4, w: 5.15, h: 0.75, fontSize: 18, bold: true });
  T(s, "J$, TT$, EC$, Bds$ and six more: the work is priced in the money people think in.", { x: 7.45, y: 6.15, w: 5.15, h: 0.5, fontSize: 13, color: MUTED });
  s.addNotes(notesFor(10, N));

  // ── 11 · NEXT ────────────────────────────────────────────────────────────────────────────────
  pres.addSection({ title: "Next" });
  s = pres.addSlide({ masterName: "SAGE_LIGHT", sectionTitle: "Next" });
  s.addShape("roundRect", { x: 0.75, y: 0.6, w: 3.9, h: 0.5, fill: { color: PAPER }, line: { color: INK, width: 1, dashType: "dash" }, rectRadius: 0.25 });
  T(s, "NEXT  ·  WHERE THIS GOES", { x: 0.75, y: 0.6, w: 3.9, h: 0.5, fontSize: 13, bold: true, charSpacing: 3, align: "center", valign: "middle" });
  T(s, "An AI finance worker for every small business", { x: 0.75, y: 1.35, w: 11.8, h: 0.9, fontSize: 38, bold: true });
  const vision = [
    ["BUILT · PILOTS NEXT", "Give it a goal and a budget", "Sage decides what work to buy, says why before it spends, and you can veto any move.", "Its limits are code it can't change."],
    ["NEXT", "Pay on proof, keep the books", "Suppliers and freelancers paid the moment the work is verified. Every job builds the business's credit.", "Local cash-out through licensed partners."],
    ["NEXT", "Recovery, paid in minutes", "After a hurricane, a programme pays a thousand people for verified clean-up the same day, not in weeks.", "Every payout auditable by anyone."],
  ];
  vision.forEach(([k, t, b, f], i) => {
    const x = 0.75 + i * 4.05;
    card(s, x, 2.6, 3.75, 3.85);
    T(s, k, { x: x + 0.35, y: 2.9, w: 3.1, h: 0.35, fontSize: 12, bold: true, charSpacing: 2, color: ACC });
    T(s, t, { x: x + 0.35, y: 3.35, w: 3.1, h: 0.95, fontSize: 23, bold: true });
    T(s, b, { x: x + 0.35, y: 4.35, w: 3.1, h: 1.35, fontSize: 15, color: INK2 });
    T(s, f, { x: x + 0.35, y: 5.75, w: 3.1, h: 0.5, fontSize: 12, color: MUTED });
  });
  s.addNotes(notesFor(11, N));

  // ── 12 · THE ASK ─────────────────────────────────────────────────────────────────────────────
  s = pres.addSlide({ masterName: "SAGE_LIGHT", sectionTitle: "Next" });
  eyebrow(s, "WHAT WE NEED NOW", 0.75, 0.6, 6);
  T(s, "The engine is live. It needs the institutions it was built for", { x: 0.75, y: 1.0, w: 8.3, h: 1.6, fontSize: 36, bold: true });
  [["An MSME programme that wants to pay on proof"], ["A cooperative paying members for delivered work"], ["A lender who'd price verified cash flow, not collateral"]].forEach(([t], i) => {
    const y = 3.0 + i * 0.85;
    s.addShape("roundRect", { x: 0.75, y, w: 0.6, h: 0.6, fill: { color: ACC_SOFT }, line: { color: ACC_SOFT, width: 0 }, rectRadius: 0.14 });
    T(s, String(i + 1), { x: 0.75, y, w: 0.6, h: 0.6, fontSize: 18, bold: true, color: ACC, align: "center", valign: "middle" });
    T(s, t, { x: 1.6, y, w: 7.4, h: 0.6, fontSize: 22, valign: "middle" });
  });
  T(s, "Twenty minutes with you is our next milestone.", { x: 0.75, y: 5.75, w: 8.3, h: 0.5, fontSize: 20, bold: true, color: ACC });
  card(s, 9.55, 1.2, 3.05, 3.75);
  s.addImage({ path: A("qr.png"), x: 9.85, y: 1.45, w: 2.45, h: 2.45, altText: "QR code to sagepays.xyz/caribbean" });
  T(s, "sagepays.xyz/caribbean", { x: 9.55, y: 4.15, w: 3.05, h: 0.45, fontSize: 14, bold: true, align: "center" });
  T(s, "Everything you saw today", { x: 9.55, y: 4.5, w: 3.05, h: 0.35, fontSize: 12, color: MUTED, align: "center" });
  s.addNotes(notesFor(12, N));

  // ── 13 · CLOSE ───────────────────────────────────────────────────────────────────────────────
  pres.addSection({ title: "Close" });
  s = pres.addSlide({ masterName: "SAGE_DARK", sectionTitle: "Close" });
  mark(s, 0.75, 1.95, 1.3);
  T(s, "Sage", { x: 2.4, y: 1.7, w: 8, h: 1.8, fontSize: 120, bold: true, color: "FFFFFF", valign: "middle" });
  T(s, "Payments that verify themselves.\nCredit records that write themselves.", { x: 0.75, y: 3.85, w: 11.8, h: 1.4, fontSize: 32, color: DARK_TEXT });
  T(s, "sagepays.xyz   ·   @sagepaysai on X   ·   Shariq Shaukat on LinkedIn", { x: 0.75, y: 6.55, w: 11.8, h: 0.4, fontSize: 15, color: DARK_MUTED });
  s.addNotes(notesFor(13, N));

  await pres.writeFile({ fileName: OUT });
  console.log("wrote", OUT);
}

main().catch((e) => { console.error(e); process.exit(1); });

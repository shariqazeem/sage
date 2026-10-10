// Builds Sage-DemoDay.pptx (opens in Keynote and PowerPoint) for Future Caribbean Demo Day.
//
//   cd docs/fc/demo-day/deck && npm install && node build-deck.js
//
// The numbers on slide 3 are READ from sagepays.xyz/caribbean at build time, never typed: rebuild on
// Saturday afternoon so they are current. The build refuses to run if it can't read them.
// Screenshots (assets/receipt.png, assets/record.png) are real pages captured by capture.mjs.
// The script for each slide is in its speaker notes and in ../SCRIPT.md (same words).
const pptxgen = require("pptxgenjs");
const fs = require("fs");
const path = require("path");

const SCRIPT = require("./script.js");
const LIVE = require("./live-mode.js")(); // SAGE_LIVE=mainnet|testnet
// Speaker notes come from script.js (the same words as SCRIPT.md and the printable script).
function notesFor(n, N) {
  const fill = (t) => t.replace("{refusals}", N.refusals).replace("{openingLive}", LIVE.openingLive).replace("{liveIntro}", LIVE.liveIntro).replace("{chipLabel}", LIVE.chipLabel);
  const i = SCRIPT.findIndex((x) => x.slide === n);
  const entries = [SCRIPT[i]];
  for (let j = i + 1; j < SCRIPT.length && SCRIPT[j].where; j++) entries.push(SCRIPT[j]); // the browser steps live under the slide you leave from
  const out = [];
  for (const e of entries) {
    out.push(`${e.slide ? `${e.slide} · ` : `${e.where.toUpperCase()} · `}${e.name.toUpperCase()} (to ${e.by})${e.note ? ". " + e.note : ""}`, "");
    for (const l of e.lines) out.push(l.startsWith("DO ") ? `>> ${fill(l.slice(3)).toUpperCase()}` : fill(l));
    if (e.ifStuck) { out.push("", "IF IT STALLS:"); for (const l of e.ifStuck) out.push(`- ${fill(l)}`); }
    out.push("");
  }
  return out.join("\n").trim();
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
  console.log("live numbers:", N, "· live mode:", LIVE.name);

  const pres = new pptxgen();
  pres.layout = "LAYOUT_WIDE"; // 13.333 × 7.5 in
  pres.author = "Shariq Shaukat";
  pres.title = "Sage · Future Caribbean Demo Day";
  pres.theme = { headFontFace: FONT, bodyFontFace: FONT };

  const footer = [
    { rect: { x: 0.75, y: 6.86, w: 0.2, h: 0.2, fill: { color: ACC } } },
    { text: { text: "Sage", options: { x: 1.03, y: 6.78, w: 1.5, h: 0.36, fontFace: FONT, fontSize: 14, bold: true, color: INK, margin: 0, valign: "middle" } } },
  ];
  pres.defineSlideMaster({ title: "SAGE_LIGHT", background: { color: PAPER }, objects: footer, slideNumber: { x: 12.0, y: 6.8, w: 0.6, h: 0.32, fontFace: FONT, fontSize: 11, color: FAINT, align: "right" } });
  pres.defineSlideMaster({ title: "SAGE_DARK", background: { color: INK }, objects: [] });

  // ── 1 · OPENING ──────────────────────────────────────────────────────────────────────────────
  pres.addSection({ title: "Opening" });
  let s = pres.addSlide({ masterName: "SAGE_DARK", sectionTitle: "Opening" });
  eyebrow(s, "FUTURE CARIBBEAN 2026  ·  FINANCE, PAYMENTS & MSME CAPITAL", 0.75, 0.65, 11.8, DARK_MUTED);
  mark(s, 0.75, 1.95, 1.3);
  T(s, "Sage", { x: 2.4, y: 1.7, w: 8, h: 1.8, fontSize: 120, bold: true, color: "FFFFFF", valign: "middle" });
  T(s, "An AI agent that pays people for verified work.", { x: 0.75, y: 3.75, w: 11.8, h: 0.7, fontSize: 30, color: DARK_TEXT });
  s.addShape("roundRect", { x: 0.75, y: 4.8, w: LIVE.name === "mainnet" ? 10.3 : 8.6, h: 0.78, fill: { color: DARK_CARD }, line: { color: ACC, width: 1.25 }, rectRadius: 0.39 });
  s.addShape("ellipse", { x: 1.08, y: 5.08, w: 0.22, h: 0.22, fill: { color: ACC }, line: { color: ACC, width: 0 } });
  T(s, LIVE.promise, { x: 1.5, y: 4.8, w: 9.2, h: 0.78, fontSize: 20, bold: true, color: "FFFFFF", valign: "middle" });
  T(s, "Shariq Shaukat  ·  Founder", { x: 0.75, y: 6.7, w: 6, h: 0.4, fontSize: 15, color: DARK_MUTED });
  T(s, "sagepays.xyz", { x: 8.6, y: 6.7, w: 4, h: 0.4, fontSize: 15, color: DARK_MUTED, align: "right" });
  s.addNotes(notesFor(1, N));

  // ── 2 · THE PROBLEM ──────────────────────────────────────────────────────────────────────────
  pres.addSection({ title: "Problem" });
  s = pres.addSlide({ masterName: "SAGE_LIGHT", sectionTitle: "Problem" });
  s.addShape("roundRect", { x: 1.0, y: 0.75, w: 3.4, h: 5.75, fill: { color: "F3F2EE" }, line: { color: INK, width: 7 }, rectRadius: 0.45, objectName: "phone" });
  s.addShape("roundRect", { x: 2.15, y: 0.95, w: 1.1, h: 0.24, fill: { color: INK }, line: { color: INK, width: 0 }, rectRadius: 0.12 });
  const bubble = (x, y, w, h, text, meta, fill) => {
    s.addShape("roundRect", { x, y, w, h, fill: { color: fill, transparency: 35 }, line: { color: fill, width: 0 }, rectRadius: 0.16 });
    T(s, [{ text, options: { breakLine: true } }, { text: meta, options: { fontSize: 10, color: FAINT } }], { x: x + 0.15, y: y + 0.12, w: w - 0.3, h: h - 0.2, fontSize: 13, color: FAINT });
  };
  bubble(1.25, 1.5, 2.6, 0.95, "Order of 40 delivered to the hotel this morning.", "Seller · 09:12", CARD);
  bubble(1.6, 2.62, 2.55, 0.9, "Got them, thank you. Sent J$48,000.", "Buyer · 11:40", "E7F2E4");
  bubble(1.25, 3.7, 2.45, 0.8, "Received. Same again next week?", "Seller · 11:42", CARD);
  T(s, "The money moved.\nThe proof stayed in a chat.", { x: 1.15, y: 5.0, w: 3.1, h: 1.0, fontSize: 15, bold: true, color: ACC, align: "center", valign: "middle" });
  eyebrow(s, "A SELLER IN KINGSTON", 5.3, 0.95, 7);
  T(s, "She delivers. She gets paid.", { x: 5.3, y: 1.4, w: 7.4, h: 0.65, fontSize: 34, bold: true });
  T(s, "To a bank, she doesn't exist.", { x: 5.3, y: 2.1, w: 7.4, h: 0.65, fontSize: 34, bold: true, color: ACC });
  T(s, "90%", { x: 5.3, y: 3.55, w: 3.3, h: 1.0, fontSize: 64, bold: true, valign: "middle" });
  T(s, "of jobs in Jamaica are in micro, small and medium businesses", { x: 5.3, y: 4.6, w: 3.3, h: 0.9, fontSize: 16, color: INK2 });
  T(s, "40%+", { x: 9.15, y: 3.55, w: 3.4, h: 1.0, fontSize: 64, bold: true, valign: "middle" });
  T(s, "of firms say access to finance is a major constraint", { x: 9.15, y: 4.6, w: 3.4, h: 0.9, fontSize: 16, color: INK2 });
  T(s, [{ text: "Not bad businesses. " }, { text: "Unrecorded ones.", options: { color: ACC } }], { x: 5.3, y: 5.6, w: 7.3, h: 0.5, fontSize: 22, bold: true });
  T(s, "World Bank, “From Dreams to Thriving Business”, April 2025", { x: 5.3, y: 6.15, w: 7.3, h: 0.3, fontSize: 11, color: FAINT });
  s.addNotes(notesFor(2, N));

  // ── 3 · SAGE ─────────────────────────────────────────────────────────────────────────────────
  pres.addSection({ title: "Sage" });
  s = pres.addSlide({ masterName: "SAGE_LIGHT", sectionTitle: "Sage" });
  eyebrow(s, "WHAT SAGE IS", 0.75, 0.6, 7);
  T(s, "An AI agent that checks the work and pays for it", { x: 0.75, y: 1.0, w: 11.8, h: 0.75, fontSize: 34, bold: true });
  T(s, "In minutes, from a vault it can't overspend. And every payment becomes a credit record a lender can read.", { x: 0.75, y: 1.8, w: 11.8, h: 0.45, fontSize: 16, color: INK2 });
  s.addImage({ path: A("certificate.png"), x: 0.85, y: 2.65, w: 4.9, h: 4.9 / (1400 / 1082), rotate: -1.5, shadow: shadow(), altText: "1st Place Grand Champion certificate, OpenClaw Summer Bootcamp 2026" });
  s.addShape("roundRect", { x: 6.45, y: 2.75, w: 4.3, h: 0.55, fill: { color: ACC_SOFT }, line: { color: ACC_SOFT, width: 0 }, rectRadius: 0.27 });
  T(s, "1ST PLACE  ·  GRAND CHAMPION", { x: 6.45, y: 2.75, w: 4.3, h: 0.55, fontSize: 14, bold: true, color: ACC, charSpacing: 2, align: "center", valign: "middle" });
  T(s, "OpenClaw Summer Bootcamp 2026: Metis Foundation, GOAT Network, ClawUp, CryptoChicks", { x: 6.45, y: 3.45, w: 6.1, h: 0.6, fontSize: 15, color: MUTED });
  T(s, "Real people, real money, since July", { x: 6.45, y: 4.15, w: 6.1, h: 0.45, fontSize: 20, bold: true });
  [[`$${N.settled}`, "settled"], [N.payments, "mainnet payments"], [N.people, "people paid"], [N.refusals, "refusals, each explained"]].forEach(([v, l], i) => {
    const x = 6.45 + i * 1.55;
    T(s, v, { x, y: 4.75, w: 1.5, h: 0.55, fontSize: 26, bold: true });
    T(s, l, { x, y: 5.3, w: 1.45, h: 0.55, fontSize: 12, color: MUTED });
  });
  T(s, `Read from the public ledger at sagepays.xyz/explorer, ${N.asOf}`, { x: 6.45, y: 6.1, w: 6.1, h: 0.3, fontSize: 11, color: FAINT });
  s.addNotes(notesFor(3, N));

  // ── 4 · LIVE ─────────────────────────────────────────────────────────────────────────────────
  pres.addSection({ title: "Live" });
  s = pres.addSlide({ masterName: "SAGE_DARK", sectionTitle: "Live" });
  s.addShape("roundRect", { x: 0.75, y: 0.7, w: 1.7, h: 0.55, fill: { color: INK }, line: { color: ACC, width: 1.25 }, rectRadius: 0.27 });
  s.addShape("ellipse", { x: 1.0, y: 0.88, w: 0.19, h: 0.19, fill: { color: ACC }, line: { color: ACC, width: 0 } });
  T(s, "LIVE", { x: 1.3, y: 0.7, w: 1.1, h: 0.55, fontSize: 14, bold: true, charSpacing: 3, color: ACC, valign: "middle" });
  T(s, "Let me show you.", { x: 0.75, y: 1.5, w: 11.8, h: 1.25, fontSize: 66, bold: true, color: "FFFFFF", valign: "middle" });
  s.addShape("roundRect", { x: 0.75, y: 3.1, w: 7.4, h: 2.9, fill: { color: PAPER }, line: { color: PAPER, width: 0 }, rectRadius: 0.16 });
  T(s, "THE JOB I'M ABOUT TO POST", { x: 1.15, y: 3.4, w: 6.6, h: 0.35, fontSize: 12, bold: true, charSpacing: 3, color: MUTED });
  T(s, "“Put my shop's price list online: three items, each priced in Jamaican dollars, on a public page.”", { x: 1.15, y: 3.85, w: 6.6, h: 1.2, fontSize: 21, bold: true });
  T(s, [{ text: "J$160  ", options: { fontSize: 40, bold: true, color: INK } }, { text: "one payment", options: { fontSize: 16, color: MUTED } }], { x: 1.15, y: 5.1, w: 6.6, h: 0.7, valign: "middle" });
  [["I post it, as the buyer"], ["I do it, as the seller"], ["Sage checks it and pays. Nobody approves it."]].forEach(([t], i) =>
    numbered(s, i + 1, 8.75, 3.3 + i * 0.95, t, null, { w: 3.6, titleSize: 18, titleColor: DARK_TEXT }));
  T(s, LIVE.liveFootnote(N.payments), { x: 0.75, y: 6.45, w: 11.8, h: 0.45, fontSize: 14, color: DARK_MUTED });
  s.addNotes(notesFor(4, N));

  // ── 5 · RECEIPT AND RECORD ───────────────────────────────────────────────────────────────────
  pres.addSection({ title: "Finance" });
  s = pres.addSlide({ masterName: "SAGE_LIGHT", sectionTitle: "Finance" });
  T(s, "A receipt for every payment, and a credit record", { x: 0.75, y: 0.6, w: 11.8, h: 0.8, fontSize: 32, bold: true });
  screenshot(s, "receipt.png", 0.75, 1.65, 5.9, 3.69, "A real decision receipt");
  T(s, "The decision Sage recorded on a real-money rehearsal (Arc mainnet)", { x: 0.75, y: 5.4, w: 5.9, h: 0.3, fontSize: 11, color: FAINT });
  screenshot(s, "record.png", 6.95, 1.65, 5.65, 2.15, "The seller's verified work record");
  T(s, "The seller's live record on sagepays.xyz/record (excerpt)", { x: 6.95, y: 3.86, w: 5.65, h: 0.3, fontSize: 11, color: FAINT });
  numbered(s, 1, 6.95, 4.35, "Verified income", "30 and 90 days, receipts only.", { w: 4.6, titleSize: 17, bodySize: 13, bodyH: 0.35 });
  numbered(s, 2, 6.95, 5.15, "Who paid, and for how long", "Distinct payers, tenure, pass rate.", { w: 4.6, titleSize: 17, bodySize: 13, bodyH: 0.35 });
  numbered(s, 3, 6.95, 5.95, "One call for a lender", "JSON, CSV or a printed statement.", { w: 4.6, titleSize: 17, bodySize: 13, bodyH: 0.35 });
  s.addNotes(notesFor(5, N));

  // ── 6 · NEXT ─────────────────────────────────────────────────────────────────────────────────
  pres.addSection({ title: "Next" });
  s = pres.addSlide({ masterName: "SAGE_LIGHT", sectionTitle: "Next" });
  s.addShape("roundRect", { x: 0.75, y: 0.6, w: 3.9, h: 0.5, fill: { color: PAPER }, line: { color: INK, width: 1, dashType: "dash" }, rectRadius: 0.25 });
  T(s, "NEXT  ·  WHERE THIS GOES", { x: 0.75, y: 0.6, w: 3.9, h: 0.5, fontSize: 13, bold: true, charSpacing: 3, align: "center", valign: "middle" });
  T(s, "An AI finance worker for every small business", { x: 0.75, y: 1.35, w: 11.8, h: 0.9, fontSize: 38, bold: true });
  [
    ["BUILT · PILOTS NEXT", "Give it a goal and a budget", "Sage decides what work to buy, says why before it spends, and you can veto any move.", "Its limits are code it can't change."],
    ["NEXT", "Pay on proof, keep the books", "Suppliers and freelancers paid the moment the work is verified. Every job builds the business's credit.", "Local cash-out through licensed partners."],
    ["NEXT", "Recovery, paid in minutes", "After a hurricane, a programme pays a thousand people for verified clean-up the same day, not in weeks.", "Every payout auditable by anyone."],
  ].forEach(([k, t, b, f], i) => {
    const x = 0.75 + i * 4.05;
    card(s, x, 2.6, 3.75, 3.85);
    T(s, k, { x: x + 0.35, y: 2.9, w: 3.1, h: 0.35, fontSize: 12, bold: true, charSpacing: 2, color: ACC });
    T(s, t, { x: x + 0.35, y: 3.35, w: 3.1, h: 0.95, fontSize: 23, bold: true });
    T(s, b, { x: x + 0.35, y: 4.35, w: 3.1, h: 1.35, fontSize: 15, color: INK2 });
    T(s, f, { x: x + 0.35, y: 5.75, w: 3.1, h: 0.5, fontSize: 12, color: MUTED });
  });
  s.addNotes(notesFor(6, N));

  // ── 7 · THE ASK ──────────────────────────────────────────────────────────────────────────────
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
  s.addNotes(notesFor(7, N));

  // ── 8 · CLOSE ────────────────────────────────────────────────────────────────────────────────
  pres.addSection({ title: "Close" });
  s = pres.addSlide({ masterName: "SAGE_DARK", sectionTitle: "Close" });
  mark(s, 0.75, 1.95, 1.3);
  T(s, "Sage", { x: 2.4, y: 1.7, w: 8, h: 1.8, fontSize: 120, bold: true, color: "FFFFFF", valign: "middle" });
  T(s, "Payments that verify themselves.\nCredit records that write themselves.", { x: 0.75, y: 3.85, w: 11.8, h: 1.4, fontSize: 32, color: DARK_TEXT });
  T(s, "sagepays.xyz   ·   @sagepaysai on X   ·   Shariq Shaukat on LinkedIn", { x: 0.75, y: 6.55, w: 11.8, h: 0.4, fontSize: 15, color: DARK_MUTED });
  s.addNotes(notesFor(8, N));

  await pres.writeFile({ fileName: OUT });
  console.log("wrote", OUT);
}

main().catch((e) => { console.error(e); process.exit(1); });

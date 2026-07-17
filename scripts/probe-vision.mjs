#!/usr/bin/env node
/**
 * P14 · step 1 — VISION CAPABILITY PROBE (report only; wires nothing).
 *
 * Sends ONE tiny synthetic image + question through the CommonStack (OpenAI-compatible)
 * gateway as `image_url` content parts (base64 data URI), once per configured model, using
 * the EXACT auth + endpoint shape the app uses (Authorization: Bearer, /chat/completions).
 *
 * The image is a known blue background with the text "SAGE VISION 42" — only a model that
 * truly reads the pixels can report the colour AND the text, so this separates real vision
 * from "accepted the request but ignored the image".
 *
 * Run ON THE VM with the app env sourced:
 *   cd ~/sage && set -a && . ./.env && set +a && node scripts/probe-vision.mjs
 *
 * Reports per model: HTTP status, latency, whether it saw the colour + text, raw content,
 * and token usage (for the cost estimate). Prints a final VERDICT line for the go/no-go gate.
 */

const DEFAULT_BASE = "https://api.commonstack.ai/v1";
const key = (process.env.LLM_API_KEY || process.env.COMMONSTACK_API_KEY || "").trim();
const base = (process.env.LLM_BASE_URL || process.env.COMMONSTACK_BASE_URL || DEFAULT_BASE).trim().replace(/\/+$/, "");
const endpoint = `${base}/chat/completions`;

if (!key) {
  console.error("✗ No LLM_API_KEY / COMMONSTACK_API_KEY in env. Source .env first:");
  console.error("  cd ~/sage && set -a && . ./.env && set +a && node scripts/probe-vision.mjs");
  process.exit(2);
}

// Every distinct configured model + the known gemini default. (VISION_MODEL is honoured if you
// pre-set a candidate to try; it is NOT yet read anywhere in the app.)
const candidates = [
  ...new Set(
    [
      process.env.VISION_MODEL,
      process.env.MISSION_MODEL,
      process.env.LLM_MODEL,
      process.env.DEPUTY_MODEL,
      process.env.CONCIERGE_MODEL,
      process.env.LLM_FALLBACK_MODEL,
      "google/gemini-3.1-flash-lite-preview",
    ]
      .map((m) => (m || "").trim())
      .filter(Boolean),
  ),
];

// Synthetic test image. Prefer a text image via sharp (strongest test); fall back to a hardcoded
// solid-blue JPEG (colour-only test) if sharp can't be loaded, so the probe always runs.
async function buildImage() {
  try {
    const sharp = (await import("sharp")).default;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="160">
      <rect width="320" height="160" fill="#1e63c8"/>
      <text x="160" y="95" font-family="sans-serif" font-size="32" fill="#ffffff" text-anchor="middle">SAGE VISION 42</text>
    </svg>`;
    const buf = await sharp(Buffer.from(svg)).jpeg({ quality: 80 }).toBuffer();
    return { buf, kind: 'blue bg + text "SAGE VISION 42"', canReadText: true };
  } catch {
    // 8x8 solid blue JPEG (base64) — colour-only fallback.
    const b64 =
      "/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////wAARCAAIAAgDASIAAhEBAxEB/8QAFAABAAAAAAAAAAAAAAAAAAAAAP/EABQQAQAAAAAAAAAAAAAAAAAAAAD/xAAUAQEAAAAAAAAAAAAAAAAAAAAA/8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAwDAQACEQMRAD8AlgD/2Q==";
    return { buf: Buffer.from(b64, "base64"), kind: "solid blue (fallback, no text)", canReadText: false };
  }
}

const { buf, kind, canReadText } = await buildImage();
const dataUri = `data:image/jpeg;base64,${buf.toString("base64")}`;
const prompt =
  'Look at the attached image. Reply with ONLY strict JSON and nothing else: {"backgroundColor":"<one lowercase word>","text":"<the exact text you can read in the image, or an empty string>"}';

async function probe(model) {
  const started = Date.now();
  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        temperature: 0,
        max_tokens: 200,
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: prompt },
              { type: "image_url", image_url: { url: dataUri } },
            ],
          },
        ],
      }),
    });
    const ms = Date.now() - started;
    const text = await res.text();
    if (!res.ok) return { model, ok: false, status: res.status, ms, detail: text.slice(0, 400) };
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      return { model, ok: false, status: res.status, ms, detail: "non-JSON gateway response: " + text.slice(0, 300) };
    }
    const content = data?.choices?.[0]?.message?.content ?? "";
    const sawColor = /blue/i.test(content);
    const sawText = canReadText ? /42/.test(content) && /sage\s*vision/i.test(content) : null;
    return { model, ok: true, status: res.status, ms, sawColor, sawText, content: String(content).slice(0, 240), usage: data.usage };
  } catch (e) {
    return { model, ok: false, status: "ERR", ms: Date.now() - started, detail: String(e?.message || e).slice(0, 300) };
  }
}

console.log(`gateway:    ${base}`);
console.log(`test image: ${buf.length} bytes — ${kind}`);
console.log(`candidates: ${candidates.join(", ")}`);
console.log("─".repeat(64));

let anyVision = false;
const summary = [];
for (const m of candidates) {
  const r = await probe(m);
  if (r.ok) {
    const full = r.sawColor && (r.sawText || !canReadText);
    const verdict = r.sawText === true ? "✅ VISION WORKS (colour + text read)" : full ? "✅ VISION WORKS (colour read)" : r.sawColor ? "⚠️  partial" : "❓ accepted image but reported no content";
    if (full) anyVision = true;
    summary.push({ m, v: r.sawText === true ? "vision+text" : full ? "vision" : "partial/none" });
    console.log(`\n[${m}]  HTTP ${r.status} · ${r.ms}ms · ${verdict}`);
    console.log(`   content: ${r.content}`);
    if (r.usage) console.log(`   tokens:  ${JSON.stringify(r.usage)}`);
  } else {
    summary.push({ m, v: `FAIL ${r.status}` });
    console.log(`\n[${m}]  ❌ FAILED · HTTP ${r.status} · ${r.ms}ms`);
    console.log(`   ${r.detail}`);
  }
}

console.log("\n" + "─".repeat(64));
console.log("SUMMARY: " + summary.map((s) => `${s.m} → ${s.v}`).join("  |  "));
console.log("VERDICT: " + (anyVision ? "GO — at least one configured model reads images. Wire the vision path (step 2)." : "NO-GO — gateway/models did not read the image. Wire the text fallback (step 4), leave vision flag-ready."));

/**
 * Pure HTML → ProductObservation extraction. No I/O, no JS execution — it reduces a
 * fetched page's markup to structured, verifiable observations (title, headings,
 * claims, CTAs, forms, same-origin links, tech/auth/state/landmark hints, verbatim
 * snippets). Regex-based and defensive: it never trusts the page and never executes
 * it. Fully unit-testable. HONEST LIMIT: server-fetched HTML, not a JS-rendered DOM —
 * client-only flows are surfaced as inspection limitations, not invented.
 */

import { createHash } from "node:crypto";
import type { ObservedForm, ProductObservation } from "./schemas";

const CAP_LIST = 24;
const CAP_TEXT = 240;

function decode(s: string): string {
  return s
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#x27;/gi, "'");
}
function clean(s: string): string {
  return decode(s.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
}
function uniq(a: string[]): string[] {
  return [...new Set(a.map((x) => x.trim()).filter(Boolean))];
}
function stripScripts(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ");
}

function tagTexts(html: string, tag: string): string[] {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "gi");
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) && out.length < 60) {
    const t = clean(m[1]);
    if (t) out.push(t.slice(0, CAP_TEXT));
  }
  return out;
}

const CTA_WORDS = /\b(get started|start|sign ?up|sign ?in|log ?in|try|book|buy|subscribe|download|request|contact|create|launch|deploy|connect|install|demo|watch|learn more|see|explore|join|continue|next|checkout|add)\b/i;

function extractCtas(html: string): string[] {
  const out: string[] = [];
  const btns = [...html.matchAll(/<button[^>]*>([\s\S]*?)<\/button>/gi)].map((m) => clean(m[1]));
  const links = [...html.matchAll(/<a[^>]*>([\s\S]*?)<\/a>/gi)].map((m) => clean(m[1]));
  for (const t of [...btns, ...links]) {
    if (t && t.length <= 40 && (CTA_WORDS.test(t) || btns.includes(t))) out.push(t);
  }
  return uniq(out).slice(0, CAP_LIST);
}

function extractForms(html: string): ObservedForm[] {
  const forms: ObservedForm[] = [];
  for (const m of html.matchAll(/<form[\s\S]*?<\/form>/gi)) {
    const block = m[0];
    const fields = uniq(
      [...block.matchAll(/<(?:input|select|textarea)[^>]*\b(?:name|id|type)=["']([^"']+)["'][^>]*>/gi)].map((f) => f[1]),
    ).slice(0, 16);
    const submit = clean(
      (block.match(/<button[^>]*>([\s\S]*?)<\/button>/i)?.[1] ??
        block.match(/<input[^>]*type=["']submit["'][^>]*value=["']([^"']+)["']/i)?.[1] ??
        "") as string,
    );
    const heading = clean(block.match(/<legend[^>]*>([\s\S]*?)<\/legend>/i)?.[1] ?? "");
    const isAuth = /password|signin|sign-in|login|log-in|sign ?up/i.test(block);
    forms.push({ label: heading || submit || (isAuth ? "authentication form" : "form"), fields, isAuth });
    if (forms.length >= 8) break;
  }
  return forms;
}

function extractLinks(html: string): string[] {
  return uniq([...html.matchAll(/<a[^>]*\bhref=["']([^"'#]+)["']/gi)].map((m) => decode(m[1]))).slice(0, 80);
}

function extractClaims(headings: string[], html: string): string[] {
  const paras = tagTexts(html, "p").filter((p) => p.length >= 25 && p.length <= 200);
  const heads = headings.filter((h) => h.length >= 12 && h.length <= 120);
  // a "claim" is a confident-sounding heading or short lead paragraph.
  return uniq([...heads, ...paras.slice(0, 6)]).slice(0, 12);
}

function extractTech(html: string): string[] {
  const hints: string[] = [];
  const gen = html.match(/<meta[^>]*name=["']generator["'][^>]*content=["']([^"']+)["']/i)?.[1];
  if (gen) hints.push(`generator: ${gen}`);
  if (/_next\/static|__NEXT_DATA__/.test(html)) hints.push("Next.js");
  if (/data-reactroot|react-dom|__REACT/.test(html)) hints.push("React");
  if (/\/@vite\/|vite/.test(html)) hints.push("Vite");
  if (/gtag\(|googletagmanager|analytics\.js/.test(html)) hints.push("Google Analytics");
  if (/cdn\.segment\.com/.test(html)) hints.push("Segment");
  if (/stripe\.com\/v3|js\.stripe\.com/.test(html)) hints.push("Stripe");
  return uniq(hints).slice(0, 8);
}

function extractStates(html: string): string[] {
  const text = clean(stripScripts(html)).toLowerCase();
  const out: string[] = [];
  for (const [label, re] of [
    ["loading", /\bloading\b|please wait/],
    ["empty", /\bno results\b|\bnothing here\b|\bempty\b|\bget started by\b/],
    ["error", /\bsomething went wrong\b|\berror\b|\btry again\b|\b404\b|not found/],
  ] as const) {
    if (re.test(text)) out.push(label);
  }
  return out;
}

function extractLandmarks(html: string): string[] {
  const out: string[] = [];
  for (const [name, re] of [
    ["nav", /<nav\b/i],
    ["main", /<main\b/i],
    ["header", /<header\b/i],
    ["footer", /<footer\b/i],
    ["search", /role=["']search["']/i],
    ["aria-labels", /aria-label=/i],
    ["skip-link", /skip to (main )?content/i],
  ] as const) {
    if (re.test(html)) out.push(name);
  }
  return out;
}

/** Reduce a fetched page to a structured, verifiable observation. */
export function extractObservation(input: {
  url: string;
  status: number;
  html: string;
  bytes?: Uint8Array | null;
}): ProductObservation {
  const html = input.html ?? "";
  const noScript = stripScripts(html);
  const title = clean(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "").slice(0, CAP_TEXT);
  const headings = uniq([...tagTexts(noScript, "h1"), ...tagTexts(noScript, "h2"), ...tagTexts(noScript, "h3")]).slice(0, CAP_LIST);
  const forms = extractForms(noScript);
  const authBoundary = forms.some((f) => f.isAuth) || /type=["']password["']/i.test(noScript);
  const contentSha256 = createHash("sha256")
    .update(input.bytes ?? Buffer.from(html, "utf8"))
    .digest("hex");
  const snippets = uniq(tagTexts(noScript, "p").filter((p) => p.length >= 20)).slice(0, 4).map((s) => s.slice(0, 160));

  return {
    url: input.url,
    status: input.status,
    title,
    headings,
    claims: extractClaims(headings, noScript),
    ctas: extractCtas(noScript),
    forms,
    links: extractLinks(noScript),
    authBoundary,
    techHints: extractTech(html),
    states: extractStates(noScript),
    landmarks: extractLandmarks(html),
    snippets,
    inspectedAt: 0, // stamped by the (impure) inspector
    contentSha256,
  };
}

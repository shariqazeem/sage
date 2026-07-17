/**
 * Pure Telegram message + command formatting. No I/O and no `server-only`
 * imports — every function here is a deterministic string transform, so the
 * bot's command parsing and every message it can send unit-test without a
 * network or a database. The side-effecting half (bot token, fetch, DB reads)
 * lives in ./bot.
 *
 * Messages use Telegram's HTML parse mode with raw URLs (link previews are
 * disabled at send time), matching the existing A2 notifier. All dynamic text is
 * HTML-escaped: campaign titles are poster-supplied and must never be able to
 * break message parsing or inject markup.
 */
import { short, usd } from "@/lib/format";
import { chainLabel } from "@/lib/deputy/networks";

const escapeHtml = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const base = (units: number): number => units / 1_000_000;

/* ────────────────────────────────────────────── parsing + validation ──── */

export type TgCommand =
  | { kind: "status"; slug: string }
  | { kind: "agent" }
  | { kind: "start"; payload: string }
  | { kind: "help" }
  | { kind: "unknown" }
  | { kind: "none" };

/** Keep only the characters a campaign slug can contain; cap the length. */
export function sanitizeSlug(v: string): string {
  return v.trim().replace(/[^A-Za-z0-9_-]/g, "").slice(0, 64);
}

/**
 * A Telegram chat id — a signed integer (e.g. -1001234567890 for a channel/group)
 * or a public @username. Returns the normalized value, or null if it is neither,
 * so junk can never be persisted as a campaign's announce target.
 */
export function sanitizeChatId(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  if (/^-?\d{1,20}$/.test(s)) return s;
  if (/^@[A-Za-z][A-Za-z0-9_]{4,63}$/.test(s)) return s;
  return null;
}

/**
 * Parse an inbound message into a command. Handles the `/cmd@BotName` mention
 * suffix Telegram appends in group chats, and sanitizes the argument so a slug
 * or deep-link payload is always safe to use downstream.
 */
export function parseCommand(raw: string): TgCommand {
  const text = raw.trim();
  if (!text.startsWith("/")) return { kind: "none" };
  const [head, ...rest] = text.split(/\s+/);
  const cmd = head.slice(1).split("@")[0].toLowerCase();
  const arg = rest.join(" ").trim();
  switch (cmd) {
    case "status":
      return { kind: "status", slug: sanitizeSlug(arg) };
    case "agent":
      return { kind: "agent" };
    case "start":
      return { kind: "start", payload: sanitizeSlug(arg) };
    case "help":
      return { kind: "help" };
    default:
      return { kind: "unknown" };
  }
}

/** Length-safe constant-time string compare (no early char return). */
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * Whether an inbound webhook is authorized: the secret Telegram echoes in the
 * `X-Telegram-Bot-Api-Secret-Token` header must equal the configured secret. An
 * unset configured secret (feature off) or an absent header is never authorized.
 */
export function webhookAuthorized(
  headerSecret: string | null | undefined,
  envSecret: string | null | undefined,
): boolean {
  if (!envSecret || !headerSecret) return false;
  return safeEqual(headerSecret, envSecret);
}

/* ─────────────────────────────────────────────────── stat derivation ──── */

const SETTLED_KINDS = new Set(["settled", "autopay_settled"]);

/**
 * Fold a campaign's journal into public totals: how many payouts settled and the
 * summed USDC (base units). Pure over the event rows, so it needs no DB — the bot
 * layer supplies real rows, tests supply fixtures.
 */
export function summarizeSettled(
  events: ReadonlyArray<{ kind: string; amount: number | null }>,
): { paidCount: number; settledBase: number } {
  let paidCount = 0;
  let settledBase = 0;
  for (const e of events) {
    if (!SETTLED_KINDS.has(e.kind)) continue;
    paidCount += 1;
    settledBase += e.amount ?? 0;
  }
  return { paidCount, settledBase };
}

/* ──────────────────────────────────────────────────── reply builders ──── */

export const USAGE_STATUS = "Usage: /status &lt;campaign-slug&gt;";
export const NOT_FOUND = "Campaign not found.";

/**
 * First contact (a bare /start). A competent operator introducing itself: what Sage does,
 * one example command, and what happens next. Deterministic (no LLM), plain enough to send
 * as one HTML chunk. `<slug>` is escaped; the example uses a concrete URL, not a raw tag.
 */
export function startWelcomeText(): string {
  return [
    "<b>Sage</b> — hire an AI worker to test your product.",
    "",
    "I turn one product URL and a budget into paid testing missions, then pay real people in USDC for verified work — autonomously, inside on-chain limits I can't exceed, with a public proof receipt for every payout.",
    "",
    "To start, just tell me your product and a budget — for example:",
    "test my product at https://yourproduct.com, budget $10",
    "",
    "What happens next: I inspect your product and DM you a mission plan in about 2 minutes. Nothing is charged until YOU fund it.",
    "",
    "Try /help for how it works, or /status &lt;slug&gt; for a campaign's live stats.",
  ].join("\n");
}

export function helpText(): string {
  return [
    "<b>Sage</b> — paid product testing, run by an AI worker.",
    "",
    "How it works:",
    "1. Tell me your product URL and a budget — I inspect it and design specific testing missions.",
    "2. You approve the plan and fund the campaign (real USDC on GOAT).",
    "3. Sage pays testers automatically for verified work — and DMs you every payout with a proof link.",
    "",
    "Commands:",
    "/start — what Sage does and how to begin",
    "/status &lt;slug&gt; — a campaign's public stats",
    "/agent — Sage's on-chain track record",
  ].join("\n");
}

export interface StatusView {
  title: string;
  paidCount: number;
  /** 0 = uncapped. */
  maxRecipients: number;
  settledBase: number;
  chainId: number;
  url: string;
}

export function statusText(v: StatusView): string {
  const paid =
    v.maxRecipients > 0 ? `${v.paidCount}/${v.maxRecipients} paid` : `${v.paidCount} paid`;
  return [
    `<b>${escapeHtml(v.title)}</b>`,
    `${paid} · ${usd(base(v.settledBase))} settled`,
    `Network: ${escapeHtml(chainLabel(v.chainId))}`,
    v.url,
  ].join("\n");
}

export interface AgentView {
  name: string;
  registered: boolean;
  agentId?: string | null;
  chainId: number;
  settledUsd: number;
  payouts: number;
  blocked: number;
  decisions: number;
  avgConfidence: number | null;
  url: string;
}

export function agentSummaryText(v: AgentView): string {
  const reg = v.registered
    ? `Registered${v.agentId ? ` #${escapeHtml(v.agentId)}` : ""} on ${escapeHtml(chainLabel(v.chainId))}`
    : "Registration pending";
  const conf = v.avgConfidence == null ? "—" : `${Math.round(v.avgConfidence * 100)}%`;
  return [
    `<b>${escapeHtml(v.name)}</b> — ${reg}`,
    `${usd(v.settledUsd)} settled · ${v.payouts} payouts · ${v.blocked} blocked`,
    `${v.decisions} decisions · avg confidence ${conf}`,
    v.url,
  ].join("\n");
}

export interface StartView {
  /** null when the payload slug didn't resolve to a public campaign. */
  title: string | null;
  url: string;
}

export function startText(v: StartView): string {
  if (!v.title) {
    return "That campaign wasn't found. Ask the poster for a fresh link, or try /status &lt;slug&gt;.";
  }
  return [`<b>${escapeHtml(v.title)}</b>`, "Submit your work here:", v.url].join("\n");
}

/* ─────────────────────────────────────────────── outbound announces ───── */

export interface SettledAnnounce {
  title: string;
  amountBase: number;
  recipient: string;
  proofUrl: string;
  /** included only when present — the bot passes it for mainnet payouts. */
  explorerUrl?: string | null;
}

export function announceSettledText(a: SettledAnnounce): string {
  const lines = [
    `<b>${escapeHtml(a.title)}</b>`,
    `Paid ✓ ${usd(base(a.amountBase))} to ${short(a.recipient)} · proof ${a.proofUrl}`,
  ];
  if (a.explorerUrl) lines.push(`Explorer: ${a.explorerUrl}`);
  return lines.join("\n");
}

export interface BlockedAnnounce {
  title: string;
  /** the vault's SpendRejected check (1..7), when the block reached the chain. */
  failedCheckIndex?: number | null;
  url: string;
}

export function announceBlockedText(a: BlockedAnnounce): string {
  const check = a.failedCheckIndex != null ? ` · check ${a.failedCheckIndex}` : "";
  return [`<b>${escapeHtml(a.title)}</b>`, `Blocked by the wallet${check} · ${a.url}`].join("\n");
}

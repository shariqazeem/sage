/**
 * Pure validation for campaign + submission input. No I/O, no `server-only` — so
 * it unit-tests directly and runs identically on the edge or in Node. Every
 * public-facing string that reaches the DB or (later) an outbound fetch passes
 * through here first.
 */

export interface Ok<T> {
  ok: true;
  value: T;
}
export interface Err {
  ok: false;
  error: string;
}
export type Result<T> = Ok<T> | Err;

const ok = <T>(value: T): Ok<T> => ({ ok: true, value });
const err = (error: string): Err => ({ ok: false, error });

/* ─────────────────────────────────────────────── evidence URL (SSRF) ──────
 * Evidence is stored now and may be FETCHED later (condition verification), so
 * it's validated against SSRF at the door: https only, no credentials, and no
 * host that resolves to the local machine or a private/link-local range or
 * cloud metadata endpoint. A hostname that is a literal private IP is rejected;
 * DNS-rebinding (a public name pointing inward) is the fetch layer's job to
 * re-check at request time — this blocks the obvious vectors cheaply.
 */

const MAX_URL = 2048;

/** Private / loopback / link-local IPv4 literals and the cloud metadata IP. */
function isBlockedIpv4(host: string): boolean {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  if ([a, Number(m[3]), Number(m[4])].some((n) => n > 255) || b > 255) {
    return true; // malformed octet — reject rather than guess
  }
  if (a === 10 || a === 127 || a === 0) return true; // private / loopback / this-host
  if (a === 169 && b === 254) return true; // link-local incl. 169.254.169.254 metadata
  if (a === 192 && b === 168) return true; // private
  if (a === 172 && b >= 16 && b <= 31) return true; // private
  if (a === 100 && b >= 64 && b <= 127) return true; // carrier-grade NAT
  return false;
}

function isBlockedHost(host: string): boolean {
  const h = host.toLowerCase().replace(/\.$/, ""); // drop a trailing dot
  if (h === "localhost" || h.endsWith(".localhost")) return true;
  if (h.endsWith(".local") || h.endsWith(".internal")) return true;
  if (h === "0.0.0.0" || h === "[::1]" || h === "::1") return true;
  if (h.startsWith("[")) return true; // any IPv6 literal — refuse (can't cheaply classify)
  if (isBlockedIpv4(h)) return true;
  return false;
}

/** Validate an evidence URL. Returns the normalized href, or a reason it failed. */
export function validateEvidenceUrl(raw: unknown): Result<string> {
  if (typeof raw !== "string") return err("Evidence link is required.");
  const trimmed = raw.trim();
  if (!trimmed) return err("Evidence link is required.");
  if (trimmed.length > MAX_URL) return err("Evidence link is too long.");

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return err("Evidence link must be a valid URL.");
  }
  if (url.protocol !== "https:") return err("Evidence link must use https.");
  if (url.username || url.password) {
    return err("Evidence link must not contain credentials.");
  }
  if (!url.hostname || isBlockedHost(url.hostname)) {
    return err("Evidence link host is not allowed.");
  }
  return ok(url.toString());
}

/* ───────────────────────────────────────────────────── free text ────── */

/** Trim, collapse, and length-check a required single-line field. */
export function validateText(
  raw: unknown,
  field: string,
  { min = 1, max }: { min?: number; max: number },
): Result<string> {
  if (typeof raw !== "string") return err(`${field} is required.`);
  const v = raw.trim();
  if (v.length < min) return err(`${field} is required.`);
  if (v.length > max) return err(`${field} must be ${max} characters or fewer.`);
  return ok(v);
}

/** Optional single-line note — empty is allowed, over-long is not. */
export function validateOptionalText(
  raw: unknown,
  field: string,
  max: number,
): Result<string> {
  if (raw == null || raw === "") return ok("");
  return validateText(raw, field, { min: 0, max });
}

/* ─────────────────────────────────────────────────── reward amount ──────
 * Reward is entered in whole/decimal USDC and stored as 6dp base units. We cap
 * it so a fat-fingered "100000" can't quietly request a five-figure spend, and
 * floor sub-cent precision (USDC is 6dp).
 */

const MAX_REWARD_USD = 10_000;

export function validateRewardUsd(raw: unknown): Result<number> {
  const n = typeof raw === "number" ? raw : Number(String(raw ?? "").trim());
  if (!Number.isFinite(n)) return err("Reward must be a number.");
  if (n <= 0) return err("Reward must be greater than zero.");
  if (n > MAX_REWARD_USD) return err(`Reward must be ${MAX_REWARD_USD} or less.`);
  // → 6dp base units, rounded to the nearest micro-USDC.
  const base = Math.round(n * 1_000_000);
  return ok(base);
}

/* ─────────────────────────────────────────────────── autonomy ───────── */

/** The standing mandate — anything but the exact "autopilot" is manual. */
export function validateAutonomy(raw: unknown): "manual" | "autopilot" {
  return raw === "autopilot" ? "autopilot" : "manual";
}

/**
 * Autopilot confidence threshold, clamped to a safe band [0.5, 0.99]. Below 0.5
 * the Deputy would be auto-paying coin-flips; 1.0 is unreachable, so 0.99 caps.
 * Defaults to 0.85 on anything unparseable.
 */
export function validateThreshold(raw: unknown): number {
  const n = typeof raw === "number" ? raw : Number(String(raw ?? "").trim());
  if (!Number.isFinite(n)) return 0.85;
  return Math.max(0.5, Math.min(0.99, n));
}

/* ───────────────────────────────────────────────── whole campaign ───── */

export interface ValidatedCampaign {
  title: string;
  descriptionMd: string;
  criteria: string[];
  rewardAmount: number; // base units, 6dp
  maxRecipients: number;
  autonomy: "manual" | "autopilot";
  autopilotThreshold: number;
}

/** Validate a New Campaign form payload. `criteria` may be array or newline text. */
export function validateCampaignInput(input: {
  title?: unknown;
  description?: unknown;
  criteria?: unknown;
  rewardUsd?: unknown;
  maxRecipients?: unknown;
  autonomy?: unknown;
  autopilotThreshold?: unknown;
}): Result<ValidatedCampaign> {
  const title = validateText(input.title, "Title", { max: 120 });
  if (!title.ok) return title;

  const description = validateOptionalText(input.description, "Description", 4000);
  if (!description.ok) return description;

  const reward = validateRewardUsd(input.rewardUsd);
  if (!reward.ok) return reward;

  const rawCriteria = Array.isArray(input.criteria)
    ? input.criteria
    : String(input.criteria ?? "").split("\n");
  const criteria = rawCriteria
    .map((c) => String(c).trim())
    .filter(Boolean)
    .slice(0, 12);
  if (criteria.some((c) => c.length > 200)) {
    return err("Each criterion must be 200 characters or fewer.");
  }

  const maxR = Number(input.maxRecipients ?? 0);
  if (!Number.isFinite(maxR) || maxR < 0 || maxR > 100_000) {
    return err("Max recipients is out of range.");
  }

  return ok({
    title: title.value,
    descriptionMd: description.value,
    criteria,
    rewardAmount: reward.value,
    maxRecipients: Math.floor(maxR),
    autonomy: validateAutonomy(input.autonomy),
    autopilotThreshold: validateThreshold(input.autopilotThreshold),
  });
}

/** A 0x-prefixed 20-byte address (shape check only; caller checksums via viem). */
export function isAddressLike(raw: unknown): raw is string {
  return typeof raw === "string" && /^0x[0-9a-fA-F]{40}$/.test(raw.trim());
}

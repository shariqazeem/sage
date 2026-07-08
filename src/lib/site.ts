/**
 * The public site origin, for the absolute URLs that must be stable across
 * surfaces: OpenGraph tags, and — above all — the canonical agent URI that
 * ERC-8004 tooling and crawlers resolve. Pure env reads, so server components,
 * route handlers, and the registration script can all agree on one value.
 *
 * Precedence: explicit NEXT_PUBLIC_SITE_URL, else the Vercel deploy URL, else
 * localhost for dev.
 */
export function siteUrl(): string {
  const explicit = process.env.NEXT_PUBLIC_SITE_URL?.trim().replace(/\/$/, "");
  if (explicit) return explicit;
  const vercel = process.env.VERCEL_URL?.trim();
  if (vercel) return `https://${vercel.replace(/\/$/, "")}`;
  return "http://localhost:3000";
}

/** The public agent page (human-facing, shareable). */
export function agentPageUrl(): string {
  return `${siteUrl()}/agents/sage`;
}

/** The canonical machine-readable agent URI (the JSON card ERC-8004 tooling reads). */
export function agentCardUrl(): string {
  return `${siteUrl()}/api/agent/card`;
}

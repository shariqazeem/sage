/**
 * WHAT A FOUNDER TOLD SAGE ONCE, SAGE DOESN'T ASK AGAIN.
 *
 * Post asks only for what blocks the work (gig-draft.ts): usually a repository, an invite link, the
 * product's URL. A team posts job after job for the same product, and answering "which repository?" every
 * time is exactly the small chore that turns into putting launching off. So an answer the founder typed is
 * remembered for their workspace, and the next card that asks the same thing arrives filled in, marked as
 * remembered, for them to keep or change.
 *
 * Only facts that stay true across jobs, and never a secret:
 * - a contract or Safe address differs per job, and a stale one would point verification at the wrong
 *   contract, so it is never remembered;
 * - a login, password, key or token is never stored at all.
 *
 * Pure: the card (client) and the route (server) share it.
 */
export const FACT_KINDS = ["github_repo", "discord_invite", "telegram_invite", "product_url", "docs_url"] as const;
export type FactKind = (typeof FACT_KINDS)[number];

const SECRET = /\b(password|passcode|credential|login|log-in|sign[- ]?in|api[- ]?key|secret|token|private key|seed|2fa|otp|card)\b/i;

/** Which remembered kind a need's label asks for, or null when it is not one Sage remembers. */
export function factKind(label: string): FactKind | null {
  const t = label.toLowerCase();
  if (SECRET.test(t)) return null;
  if (/\b(contract|safe|multisig|wallet)\b/.test(t)) return null;
  if (/\brepo(sitory)?\b/.test(t)) return "github_repo";
  if (/\bdiscord\b/.test(t) && /\b(invite|link|server)\b/.test(t)) return "discord_invite";
  if (/\btelegram\b/.test(t) && /\b(invite|link|group|channel)\b/.test(t)) return "telegram_invite";
  if (/\b(docs|documentation|developer docs)\b/.test(t) && /\b(url|link|site|address)\b/.test(t)) return "docs_url";
  if (/\b(product|app|website|site|landing page)\b/.test(t) && /\b(url|link|address)\b/.test(t)) return "product_url";
  return null;
}

/** A value worth remembering for its kind, normalised, or null (shape-checked: nothing else is stored). */
export function normalizeFact(kind: FactKind, value: string): string | null {
  const v = value.trim();
  if (v.length < 3 || v.length > 300) return null;
  switch (kind) {
    case "github_repo": {
      const m = /^(?:https:\/\/github\.com\/)?([\w.-]+\/[\w.-]+?)(?:\.git)?\/?$/i.exec(v);
      return m ? m[1]! : null;
    }
    case "discord_invite":
      return /^https:\/\/(discord\.gg|discord\.com\/invite)\/[\w-]+\/?$/i.test(v) ? v : null;
    case "telegram_invite":
      return /^https:\/\/t\.me\/[\w+/-]+$/i.test(v) ? v : null;
    case "product_url":
    case "docs_url":
      return /^https:\/\/[^\s/$.?#][^\s]*$/i.test(v) ? v : null;
  }
}

export function isFactKind(k: unknown): k is FactKind {
  return typeof k === "string" && (FACT_KINDS as readonly string[]).includes(k);
}

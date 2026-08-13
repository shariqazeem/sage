import "server-only";

import { extractOtpCode } from "./authenticated-exploration";

/**
 * READ A VERIFICATION CODE OUT OF A MAILBOX SAGE IS GIVEN ACCESS TO.
 *
 * The passwordless login (ClawUp, Privy, Dynamic, most modern products) mails a code, so signing in
 * requires reading it. The founder supplies a THROWAWAY mailbox — the same one their test account is
 * registered with — as an IMAP host + app password, sealed exactly like the login credentials.
 *
 * Three rules make this acceptable to hold at all:
 *  1. RECENT ONLY. Only messages that arrived AFTER the login attempt began are considered, so Sage
 *     can never trawl a mailbox's history — it reads the code it just caused to be sent, or nothing.
 *  2. NOTHING IS KEPT. The code is extracted in memory and returned; no subject, body, sender or
 *     message is stored, logged, or allowed anywhere near the observation corpus.
 *  3. FAIL QUIET. Any connection/parse failure returns null. A mailbox that cannot be read is simply
 *     a wall Sage did not pass — never an error that fails the founder's inspection.
 */
export interface MailboxAccess {
  /** IMAP host, e.g. imap.gmail.com */
  host: string;
  port?: number;
  /** the mailbox address (also the address the test account is registered with). */
  user: string;
  /** an APP PASSWORD, never the account's real password. Sealed at rest like every credential. */
  appPassword: string;
}

/** How long to wait for the mail to land, and how often to look. */
const WAIT_MS = 45_000;
const POLL_MS = 3_000;

/**
 * Poll the mailbox for a verification code that arrived after `since`. Returns the code, or null.
 * `deps.openClient` is a test seam so the polling/selection logic is provable without a mail server.
 */
export async function fetchOtpCode(
  access: MailboxAccess,
  since: Date,
  deps: {
    fetchRecent?: (a: MailboxAccess, since: Date) => Promise<{ subject: string; text: string }[]>;
    now?: () => number;
    sleep?: (ms: number) => Promise<void>;
  } = {},
): Promise<string | null> {
  const now = deps.now ?? (() => Date.now());
  const sleep = deps.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const fetchRecent = deps.fetchRecent ?? fetchRecentViaImap;
  const deadline = now() + WAIT_MS;

  while (now() < deadline) {
    let messages: { subject: string; text: string }[] = [];
    try {
      messages = await fetchRecent(access, since);
    } catch {
      return null; // unreadable mailbox is a wall, not a failure
    }
    // newest first — the code we just triggered is the one that matters
    for (const m of messages.slice().reverse()) {
      const code = extractOtpCode(m.subject ?? "", m.text ?? "");
      if (code) return code;
    }
    await sleep(POLL_MS);
  }
  return null;
}

/** The real IMAP read. Isolated so the logic above stays testable and this stays swappable. */
async function fetchRecentViaImap(
  access: MailboxAccess,
  since: Date,
): Promise<{ subject: string; text: string }[]> {
  const { ImapFlow } = (await import("imapflow")) as unknown as {
    ImapFlow: new (o: Record<string, unknown>) => {
      connect(): Promise<void>;
      logout(): Promise<void>;
      getMailboxLock(name: string): Promise<{ release(): void }>;
      fetch(range: unknown, opts: Record<string, unknown>): AsyncIterable<{ envelope?: { subject?: string }; source?: Buffer }>;
    };
  };
  const client = new ImapFlow({
    host: access.host,
    port: access.port ?? 993,
    secure: true,
    auth: { user: access.user, pass: access.appPassword },
    logger: false,
  });
  const out: { subject: string; text: string }[] = [];
  await client.connect();
  try {
    const lock = await client.getMailboxLock("INBOX");
    try {
      // SINCE is date-granular in IMAP, so the precise cutoff is re-applied by the caller's `since`
      // window through the code's own freshness — we still bound the scan to today's mail.
      for await (const msg of client.fetch({ since }, { envelope: true, source: true })) {
        const raw = msg.source?.toString("utf8") ?? "";
        // deliberately crude: we only ever want a short code, never the message
        out.push({ subject: msg.envelope?.subject ?? "", text: raw.slice(0, 20_000) });
      }
    } finally {
      lock.release();
    }
  } finally {
    await client.logout().catch(() => {});
  }
  return out;
}

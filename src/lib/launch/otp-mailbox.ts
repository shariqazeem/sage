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
/**
 * Poll fast. The code usually lands in 3-10s and products expire it quickly — ClawUp's box literally
 * says "Verification code (1 min)" — so the whole cycle (request → fetch → type → submit) has to fit
 * inside that window. Combined with ONE reused connection below, a code that arrives at t+5s is
 * typed at roughly t+6s instead of t+20s.
 */
const POLL_MS = 1_500;

/**
 * Poll the mailbox for a verification code that arrived after `since`. Returns the code, or null.
 * `deps.openClient` is a test seam so the polling/selection logic is provable without a mail server.
 */
export async function fetchOtpCode(
  access: MailboxAccess,
  since: Date,
  deps: {
    fetchRecent?: (a: MailboxAccess, since: Date) => Promise<{ subject: string; text: string; at?: Date }[]>;
    now?: () => number;
    sleep?: (ms: number) => Promise<void>;
  } = {},
): Promise<string | null> {
  const now = deps.now ?? (() => Date.now());
  const sleep = deps.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const fetchRecent = deps.fetchRecent ?? fetchRecentViaImap;
  const deadline = now() + WAIT_MS;

  // ONE CONNECTION FOR THE WHOLE WAIT. Reconnecting per poll cost 2-4s of connect+auth each time and
  // was the difference between typing a live code and typing an expired one.
  const session = deps.fetchRecent ? null : await openImapSession(access).catch(() => null);
  try {
  while (now() < deadline) {
    let messages: { subject: string; text: string; at?: Date }[] = [];
    try {
      messages = session ? await session.recent(since) : await fetchRecent(access, since);
    } catch {
      return null; // unreadable mailbox is a wall, not a failure
    }
    /**
     * NEWEST FIRST, AND ONLY WHAT ARRIVED AFTER WE ASKED. IMAP's SINCE is DATE-granular, so a
     * mailbox that already received a code earlier the same day hands back that older mail too —
     * and Sage typed it, producing a wrong code and a failed sign-in (ClawUp mzQGzfo_0J8s).
     *
     * When arrival times are available they are AUTHORITATIVE: stale mail is dropped and, if nothing
     * fresh has landed yet, this round yields nothing and we poll again. Falling back to the raw
     * list would hand back the very stale code the filter just rejected. Only when the server gave
     * no timestamps at all do we fall back to server order (newest last, by convention).
     */
    const timed = messages.filter((m) => m.at instanceof Date);
    const candidates =
      timed.length > 0
        ? timed
            .filter((m) => (m.at as Date).getTime() >= since.getTime() - 5_000)
            .sort((a, b) => (b.at as Date).getTime() - (a.at as Date).getTime())
        : messages.slice().reverse();
    for (const m of candidates) {
      const code = extractOtpCode(m.subject ?? "", m.text ?? "");
      if (code) return code;
    }
    await sleep(POLL_MS);
  }
  return null;
  } finally {
    await session?.close();
  }
}

/** A single IMAP connection held open across polls, so each look costs a fetch and nothing else. */
async function openImapSession(access: MailboxAccess): Promise<{
  recent: (since: Date) => Promise<{ subject: string; text: string; at?: Date }[]>;
  close: () => Promise<void>;
}> {
  const { ImapFlow } = (await import("imapflow")) as unknown as {
    ImapFlow: new (o: Record<string, unknown>) => {
      connect(): Promise<void>;
      logout(): Promise<void>;
      getMailboxLock(name: string): Promise<{ release(): void }>;
      fetch(range: unknown, opts: Record<string, unknown>): AsyncIterable<{ envelope?: { subject?: string; date?: string }; source?: Buffer; internalDate?: string }>;
    };
  };
  const client = new ImapFlow({
    host: access.host,
    port: access.port ?? 993,
    secure: true,
    auth: { user: access.user, pass: access.appPassword },
    logger: false,
  });
  await client.connect();
  return {
    recent: async (since: Date) => {
      const out: { subject: string; text: string; at?: Date }[] = [];
      const lock = await client.getMailboxLock("INBOX");
      try {
        for await (const msg of client.fetch({ since }, { envelope: true, source: true, internalDate: true })) {
          const raw = msg.source?.toString("utf8") ?? "";
          const at = msg.internalDate ? new Date(msg.internalDate) : msg.envelope?.date ? new Date(msg.envelope.date) : undefined;
          out.push({ subject: msg.envelope?.subject ?? "", text: raw.slice(0, 20_000), at });
        }
      } finally {
        lock.release();
      }
      return out;
    },
    close: async () => {
      await client.logout().catch(() => {});
    },
  };
}

/** The real IMAP read. Isolated so the logic above stays testable and this stays swappable. */
async function fetchRecentViaImap(
  access: MailboxAccess,
  since: Date,
): Promise<{ subject: string; text: string; at?: Date }[]> {
  const { ImapFlow } = (await import("imapflow")) as unknown as {
    ImapFlow: new (o: Record<string, unknown>) => {
      connect(): Promise<void>;
      logout(): Promise<void>;
      getMailboxLock(name: string): Promise<{ release(): void }>;
      fetch(range: unknown, opts: Record<string, unknown>): AsyncIterable<{ envelope?: { subject?: string; date?: string }; source?: Buffer; internalDate?: string }>;
    };
  };
  const client = new ImapFlow({
    host: access.host,
    port: access.port ?? 993,
    secure: true,
    auth: { user: access.user, pass: access.appPassword },
    logger: false,
  });
  const out: { subject: string; text: string; at?: Date }[] = [];
  await client.connect();
  try {
    const lock = await client.getMailboxLock("INBOX");
    try {
      // SINCE is date-granular in IMAP, so the precise cutoff is re-applied by the caller's `since`
      // window through the code's own freshness — we still bound the scan to today's mail.
      for await (const msg of client.fetch({ since }, { envelope: true, source: true, internalDate: true })) {
        const raw = msg.source?.toString("utf8") ?? "";
        const at = msg.internalDate ? new Date(msg.internalDate) : msg.envelope?.date ? new Date(msg.envelope.date) : undefined;
        // deliberately crude: we only ever want a short code, never the message
        out.push({ subject: msg.envelope?.subject ?? "", text: raw.slice(0, 20_000), at });
      }
    } finally {
      lock.release();
    }
  } finally {
    await client.logout().catch(() => {});
  }
  return out;
}

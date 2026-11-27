/**
 * WHO GETS TOLD, AND HOW OFTEN. Pure rules, no database and no network, because the cost of getting
 * this wrong is not a bug — it is spam sent to real people who trusted us with a channel.
 *
 * Four rules, each of which exists because its absence would be an abuse:
 *
 * 1. **Opt-in only.** A row exists because someone asked. Being paid is not consent.
 * 2. **A cooldown per person**, so a founder launching five campaigns in an hour cannot become five
 *    messages. The roster is a channel we can lose exactly once.
 * 3. **Never about work they already did.** Someone who submitted there is not a lead for it.
 * 4. **Only work that can actually pay.** An alert about a campaign with no open slots is a lie with
 *    a link on it.
 */
import { testPath } from "@/lib/site/test-path";

export interface RosterMember {
  walletKey: string;
  wallet: string;
  target: string;
  mutedAt: number | null;
  lastNotifiedAt: number | null;
}

export interface AlertableWork {
  campaignId: string;
  title: string;
  /** the product's host, when the test has one: what the message asks the reader to try */
  product?: string | null;
  /** slots that can still be claimed and paid. */
  openSlots: number;
  rewardBase: number;
  /** wallets that already submitted here — they are not an audience for it. */
  participants: string[];
}

export const DEFAULT_COOLDOWN_HOURS = 20;

const key = (w: string) => w.trim().toLowerCase().replace(/^0x/, "").replace(/^0+/, "");

/** The members who may be told about this campaign right now. */
export function recipientsFor(work: AlertableWork, roster: RosterMember[], nowSec: number, cooldownHours = DEFAULT_COOLDOWN_HOURS): RosterMember[] {
  if (work.openSlots <= 0) return [];
  const already = new Set(work.participants.map(key));
  const cooldown = cooldownHours * 3600;
  return roster.filter((m) => {
    if (m.mutedAt) return false;
    if (already.has(key(m.wallet))) return false;
    if (m.lastNotifiedAt !== null && nowSec - m.lastNotifiedAt < cooldown) return false;
    return true;
  });
}

/**
 * What the message says. Plain, specific, and never more than the ledger supports. It speaks about a test
 * (since the relaunch, 20 Nov 2026) and its link says where the reader came from (`?via=alert`), so the
 * builder's page can count the people Sage told.
 */
export function alertText(work: AlertableWork, origin: string): string {
  const each = `$${(work.rewardBase / 1e6).toFixed(2)}`;
  const places = work.openSlots === 1 ? "1 place" : `${work.openSlots} places`;
  return [
    `New test on Sage: try ${work.product ?? work.title}. ${each} each, ${places} open, paid in USDC when Sage checks your answer.`,
    `${origin}${testPath(work.campaignId)}?via=alert`,
    ``,
    `Reply "stop" to stop these.`,
  ].join("\n");
}

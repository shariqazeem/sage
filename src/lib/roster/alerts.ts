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

/** What the message says. Plain, specific, and never more than the ledger supports. */
export function alertText(work: AlertableWork, origin: string): string {
  const each = `$${(work.rewardBase / 1e6).toFixed(2)}`;
  const slots = work.openSlots === 1 ? "1 slot" : `${work.openSlots} slots`;
  return [
    `New paid work: ${work.title}`,
    ``,
    `${each} each · ${slots} open · paid in USDC when Sage verifies it.`,
    `${origin}/c/${work.campaignId}`,
    ``,
    `Reply "stop" to stop these.`,
  ].join("\n");
}

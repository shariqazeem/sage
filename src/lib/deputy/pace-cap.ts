/**
 * HOW FAST CAN ONE CAMPAIGN PAY?
 *
 * Ten $1.10 rewards were farmed in two hours, and every one cleared the judge, because each page
 * was fine and each wallet was new. A campaign that pays faster than people can actually do the
 * work is being farmed. Above the cap, the next payout HOLDS for the founder with the pace as the
 * reason — the row stays approved, and the sweep releases it by itself once the hour rolls on, so
 * a genuinely popular campaign is slowed, never stranded. `AUTOPAY_HOURLY_CAP=0` turns it off.
 */
export const DEFAULT_AUTOPAY_HOURLY_CAP = 4;

export function autopayHourlyCap(): number {
  const raw = process.env.AUTOPAY_HOURLY_CAP?.trim();
  if (raw === undefined || raw === "") return DEFAULT_AUTOPAY_HOURLY_CAP;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : DEFAULT_AUTOPAY_HOURLY_CAP;
}

export function paceCapHold(recentAutopays: number, cap: number): string | null {
  if (cap <= 0) return null;
  const recent = recentAutopays;
  if (recent < cap) return null;
  return `autopay pace: ${recent} payouts in the last hour on this campaign (cap ${cap}) — held for the founder; Sage releases it by itself as the hour rolls on`;
}

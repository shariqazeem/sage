/**
 * TIMES AND COUNTS, FOR PEOPLE. Deterministic (fixed month names, UTC), so the server and any
 * browser render the same string.
 */
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

/** "25 Aug", and "25 Aug 2025" when it was another year. */
export function dayOf(unixSeconds: number, nowMs: number = Date.now()): string {
  const d = new Date(unixSeconds * 1000);
  const base = `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
  return d.getUTCFullYear() === new Date(nowMs).getUTCFullYear() ? base : `${base} ${d.getUTCFullYear()}`;
}

/** "just now", "12 min ago", "3 h ago", "2 d ago", then the day. */
export function whenAgo(unixSeconds: number, nowMs: number = Date.now()): string {
  const secs = Math.max(0, Math.floor(nowMs / 1000) - unixSeconds);
  if (secs < 60) return "just now";
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} d ago`;
  return dayOf(unixSeconds, nowMs);
}

/** "45 s", "2 min 25 s", "1 h 4 min". */
export function howLong(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  if (m < 60) return s % 60 ? `${m} min ${s % 60} s` : `${m} min`;
  const h = Math.floor(m / 60);
  return m % 60 ? `${h} h ${m % 60} min` : `${h} h`;
}

/** "1 person", "3 people": the right word for the count. */
export function count(n: number, one: string, many: string): string {
  return `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;
}

/** Money to the cent, always: "$2.00", "$1,204.50". */
export function dollars(usd: number): string {
  return `$${usd.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** A product's name as people recognise it: its hostname, without "www.". */
export function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

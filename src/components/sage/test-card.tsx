import Link from "next/link";
import type { ReactNode } from "react";
import { Pill, type PillTone } from "./pill";

/**
 * THE TEST CARD: one product being tested. The domain in mono, one line that says where it stands,
 * a thin rail of places, and the last real thing that happened.
 */
export type TestCardState = "trying" | "question" | "stopped" | "ready" | "live" | "done";

const STATE: Record<TestCardState, { label: string; tone: PillTone }> = {
  trying: { label: "Trying", tone: "neutral" },
  question: { label: "Needs you", tone: "accent" },
  stopped: { label: "Stopped", tone: "neutral" },
  ready: { label: "Ready", tone: "accent" },
  live: { label: "Live", tone: "ink" },
  done: { label: "Done", tone: "neutral" },
};

/** The product's initial, set like a type sort. No third-party icon is fetched for anyone's product. */
export function ProductSort({ name }: { name: string }) {
  const letter = (name.replace(/^www\./, "").match(/[a-z0-9]/i)?.[0] ?? "·").toUpperCase();
  return (
    <span className="sg-sort" aria-hidden>
      {letter}
    </span>
  );
}

/** Places as ticks: green for a person paid, ink for a place taken and not yet paid, empty for open. */
export function PlacesRail({ total, paid, taken = 0 }: { total: number; paid: number; taken?: number }) {
  if (total <= 0) return null;
  const ticks = Math.min(total, 24);
  const scale = ticks / total;
  const paidTicks = Math.min(ticks, paid > 0 ? Math.max(1, Math.round(paid * scale)) : 0);
  const takenTicks = Math.min(ticks - paidTicks, taken > 0 ? Math.max(1, Math.round(taken * scale)) : 0);
  return (
    <span className="sg-rail" role="img" aria-label={`${paid} of ${total} places paid${taken ? `, ${taken} being checked` : ""}`}>
      {Array.from({ length: ticks }, (_, i) => (
        <i key={i} data-s={i < paidTicks ? "paid" : i < paidTicks + takenTicks ? "taken" : undefined} />
      ))}
    </span>
  );
}

export interface TestCardProps {
  href: string;
  /** the product's domain, or the job's own title when it has no address */
  host: string;
  state: TestCardState;
  /** one line, the state in words: "4 of 10 people paid" */
  line: string;
  places?: { total: number; paid: number; taken?: number } | null;
  /** the last real event: "Paid $2.00 to 0x3a60…8341" */
  event?: string | null;
  /** when it happened, already relative: "3 d ago" */
  when?: string | null;
  children?: ReactNode;
}

export function TestCard({ href, host, state, line, places, event, when, children }: TestCardProps) {
  const s = STATE[state];
  return (
    <Link href={href} className="sg-card" data-state={state}>
      <span className="sg-card-head">
        <ProductSort name={host} />
        <span className="sg-card-domain" data-words={/\s/.test(host) || !host.includes(".") || undefined}>
          {host}
        </span>
        <Pill tone={s.tone}>{s.label}</Pill>
      </span>
      <p className="sg-card-line">{line}</p>
      {places ? <PlacesRail {...places} /> : null}
      {children}
      {event || when ? (
        <span className="sg-card-foot">
          <span>{event ?? ""}</span>
          {when ? <span className="sg-mono">{when}</span> : null}
        </span>
      ) : null}
    </Link>
  );
}

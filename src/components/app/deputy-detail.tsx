"use client";

import { ArrowLeft, ArrowUpRight, ExternalLink } from "lucide-react";
import { usd, cap, since } from "@/lib/format";
import { BudgetRing } from "./budget-ring";
import type { VaultStateView } from "@/lib/deputy/chain";
import type { JournalEntry, JournalTone } from "@/lib/campaigns/journal";

const TONE_COLOR: Record<JournalTone, string> = {
  settled: "var(--pos)",
  blocked: "var(--dan)",
  timelocked: "var(--warn)",
  action: "var(--accent)",
  neutral: "var(--ter)",
};

/**
 * The Payout Deputy detail view — a read-only replay of REAL work. The journal is
 * built from real events (campaign created, submission received, approved,
 * allowlisted, settled, blocked); there is no path that invents an entry. The
 * live loop itself lives in the campaign review queue.
 */
export function DeputyDetail({
  vault,
  journal,
  onBack,
}: {
  vault: VaultStateView;
  journal: JournalEntry[];
  onBack: () => void;
}) {
  const revoked = vault.status === "revoked";
  const settledCount = journal.filter((e) => e.kind === "settled").length;

  return (
    <section className="sb-detail">
      <button className="sb-back" onClick={onBack}>
        <ArrowLeft size={15} /> Agents
      </button>

      <div className="sb-card sb-detail-head">
        <BudgetRing
          remaining={vault.remaining}
          budget={vault.budget}
          size={112}
          danger={revoked}
        />
        <div className="sb-detail-id">
          <div className="sb-agent-name">
            Payout Deputy
            {revoked ? (
              <span className="sb-pill dan">Revoked</span>
            ) : (
              <span className="sb-pill pos">{cap(vault.status)}</span>
            )}
          </div>
          <div className="sb-agent-mission">
            Pays the right person when a task is verified — never more than{" "}
            {usd(vault.perTxCap)} per payout, never off the allowlist.
          </div>
          <div className="sb-detail-stats">
            <span>
              <b className="mono">{usd(vault.spent)}</b> paid out
            </span>
            <span>
              <b className="mono">{settledCount}</b> payouts
            </span>
            <span>
              <b className="mono">{usd(vault.remaining)}</b> left
            </span>
          </div>
        </div>
      </div>

      <div className="sb-sec-label">Work journal</div>
      {journal.length === 0 ? (
        <div className="sb-card sb-empty">
          No activity yet. When a campaign gets submissions and you approve them,
          every real step lands here — approvals, allowlists, and settled payouts.
        </div>
      ) : (
        <div className="sb-card sb-hist">
          {journal.map((e) => (
            <div className="sb-hist-row" key={e.id}>
              <span
                className="sb-hist-dot"
                style={{ background: TONE_COLOR[e.tone] }}
              />
              <div className="sb-hist-main">
                <div className="sb-hist-to">
                  {e.label}
                  {e.detail ? (
                    <span className="mono" style={{ color: "var(--ter)" }}>
                      {" "}
                      · {e.detail}
                    </span>
                  ) : null}
                </div>
                <div className="sb-hist-meta">{since(e.at)}</div>
              </div>
              {e.amountBase != null && (
                <div
                  className={`sb-hist-amt mono${e.tone === "blocked" ? " dan" : ""}`}
                >
                  {usd(e.amountBase / 1_000_000)}
                </div>
              )}
              {e.txHash ? (
                <a
                  className="hext"
                  href={`/proof/${e.txHash}`}
                  aria-label="View payout proof"
                >
                  <ExternalLink size={13} />
                </a>
              ) : (
                <span className="hext" style={{ opacity: 0.3 }}>
                  <ArrowUpRight size={13} />
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

"use client";

import { useState } from "react";
import Link from "next/link";
import { Check, Copy, Package } from "lucide-react";
import type { WorkspaceSubmission } from "@/components/campaign/campaign-workspace";

/**
 * WHAT THE FOUNDER ACTUALLY BOUGHT. The console shows the money machinery — the vault, the lane, the
 * graph — and a founder asked the fair question underneath all of it: what do I receive? This is the
 * answer in one place: every deliverable that was verified and paid for, with the link, what it cost,
 * and the receipt behind it. Copy takes the whole pile as text, because the pile is the work product
 * and it should leave here as easily as it arrived.
 */
const usd = (b: number) => `$${(b / 1e6).toFixed(2)}`;
const host = (u: string) => {
  try {
    return new URL(u).host.replace(/^www\./, "");
  } catch {
    return u.slice(0, 40);
  }
};

export function Deliverables({ submissions, title }: { submissions: WorkspaceSubmission[]; title: string }) {
  const [copied, setCopied] = useState(false);
  const paid = submissions.filter((s) => s.state === "paid");
  if (paid.length === 0) return null;
  const spent = paid.reduce((n, s) => n + (s.rewardBase ?? 0), 0);
  const withLinks = paid.filter((s) => s.evidenceUrl);

  const copyAll = async () => {
    const text = [
      `${title} — ${paid.length} verified deliverable${paid.length === 1 ? "" : "s"}, ${usd(spent)} paid`,
      "",
      ...paid.map((s, i) => [`${i + 1}. ${s.missionTitle}${s.evidenceUrl ? `\n   ${s.evidenceUrl}` : ""}`, s.account ? `   ${s.account.replace(/\s+/g, " ").trim()}` : ""].filter(Boolean).join("\n")),
    ].join("\n\n");
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* a clipboard the browser refuses is not worth an error state */
    }
  };

  return (
    <section className="lv-card">
      <div className="lv-h">
        <h2><Package size={15} /> What you bought</h2>
        <span className="lv-tele">
          <span><b>{paid.length}</b> verified</span>
          <span><b>{withLinks.length}</b> published</span>
          <span><b>{usd(spent)}</b> paid</span>
        </span>
      </div>
      <ul className="dl-list">
        {paid.map((s) => (
          <li key={s.id}>
            <span className="dl-what">
              <span className="dl-title">{s.missionTitle}</span>
              {s.evidenceUrl ? (
                <a className="dl-link mono" href={s.evidenceUrl} target="_blank" rel="noreferrer noopener">{host(s.evidenceUrl)}</a>
              ) : (
                <span className="dl-link none">reported in their own words</span>
              )}
            </span>
            <span className="dl-amt mono">{usd(s.rewardBase ?? 0)}</span>
            <span className="dl-rec">{s.proofTx ? <Link href={`/proof/${s.proofTx}`}>receipt</Link> : null}</span>
          </li>
        ))}
      </ul>
      <button type="button" className="nm-btn ghost dl-copy" onClick={() => void copyAll()}>
        {copied ? <><Check size={13} /> Copied</> : <><Copy size={13} /> Copy the pile</>}
      </button>
    </section>
  );
}

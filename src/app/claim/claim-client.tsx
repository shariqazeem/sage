"use client";

import { useCallback, useEffect, useState } from "react";
import { starknetTxUrl } from "@/lib/starknet/explorer";
import { ArrowRight, Check, Loader2, ShieldCheck } from "lucide-react";

import { claimCommitment, secretFromUrl } from "@/lib/starknet/claim-link";

import { PrivateCollect } from "./private-collect";

/**
 * The collection screen.
 *
 * Written for someone who has never used a blockchain and may not know they are on one. It asks
 * for exactly one thing — where to send the money — and it never asks them to install, connect,
 * fund, or register anything, because the contract behind it does not require any of that.
 *
 * The secret lives in the URL FRAGMENT and is read here, in the browser. It is never put in a
 * request line, so it stays out of access logs and referrer headers. Checking whether the link is
 * real sends only the COMMITMENT — a hash that discloses nothing.
 */

type Status =
  | { kind: "reading" }
  | { kind: "no-link" }
  | { kind: "unreachable" }
  | { kind: "missing" }
  | { kind: "collected" }
  | { kind: "ready"; amountUsd: number }
  | { kind: "sending"; amountUsd: number }
  | { kind: "done"; amountUsd: number; txHash: string }
  | { kind: "done-private"; amountUsd: number; txHash: string };

export function ClaimClient({
  claims,
  token,
}: {
  claims: string | null;
  token: string | null;
}) {
  const [status, setStatus] = useState<Status>({ kind: "reading" });
  const [secret, setSecret] = useState<string | null>(null);
  const [recipient, setRecipient] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const found = secretFromUrl(window.location.href);
    if (!found) {
      setStatus({ kind: "no-link" });
      return;
    }
    setSecret(found);

    // Only the commitment leaves the browser.
    void (async () => {
      try {
        const res = await fetch(
          `/api/claim/status?commitment=${encodeURIComponent(claimCommitment(found))}`,
        );
        if (!res.ok) {
          setStatus({ kind: "unreachable" });
          return;
        }
        const data = (await res.json()) as {
          exists: boolean;
          claimed: boolean;
          amountUsd: number;
        };
        if (!data.exists) setStatus({ kind: "missing" });
        else if (data.claimed) setStatus({ kind: "collected" });
        else setStatus({ kind: "ready", amountUsd: data.amountUsd });
      } catch {
        setStatus({ kind: "unreachable" });
      }
    })();
  }, []);

  const collect = useCallback(async () => {
    if (!secret || status.kind !== "ready") return;
    setError(null);
    setStatus({ kind: "sending", amountUsd: status.amountUsd });
    try {
      const res = await fetch("/api/claim/collect", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ secret, recipient: recipient.trim() }),
      });
      const data = (await res.json()) as { txHash?: string; error?: string };
      if (!res.ok || !data.txHash) {
        setError(data.error ?? "The collection could not be submitted.");
        setStatus({ kind: "ready", amountUsd: status.amountUsd });
        return;
      }
      setStatus({
        kind: "done",
        amountUsd: status.amountUsd,
        txHash: data.txHash,
      });
    } catch {
      setError("The collection could not be submitted.");
      setStatus({ kind: "ready", amountUsd: status.amountUsd });
    }
  }, [secret, status, recipient]);

  const amount = (usd: number) => `$${usd.toFixed(2)}`;
  const addressLooksValid = /^0x[0-9a-fA-F]{1,64}$/.test(recipient.trim());

  if (status.kind === "reading") {
    return (
      <p className="claim-muted">
        <Loader2 className="claim-spin" size={16} aria-hidden /> Checking your
        link…
      </p>
    );
  }

  if (status.kind === "no-link") {
    return (
      <div className="claim-state">
        <h2>This isn&rsquo;t a claim link</h2>
        <p className="claim-muted">
          A claim link looks like <code>sagepays.xyz/claim#…</code> and is sent
          to you when Sage pays you for work. Opening this page on its own has
          nothing to collect.
        </p>
      </div>
    );
  }

  if (status.kind === "unreachable") {
    return (
      <div className="claim-state">
        <h2>Couldn&rsquo;t check your link</h2>
        <p className="claim-muted">
          Sage could not reach the network just now. Your money is unaffected —
          it is held by the contract, not by this page. Try again in a moment.
        </p>
      </div>
    );
  }

  if (status.kind === "missing") {
    return (
      <div className="claim-state">
        <h2>Nothing is waiting behind this link</h2>
        <p className="claim-muted">
          No payout was found for it. The most common reason is an incomplete
          link — they are long, and copying one by hand usually drops the end.
          Try opening it from the original message.
        </p>
      </div>
    );
  }

  if (status.kind === "collected") {
    return (
      <div className="claim-state">
        <h2>Already collected</h2>
        <p className="claim-muted">
          This payout has been collected. A link can only be opened once, which
          is what stops anyone else from spending it after you.
        </p>
      </div>
    );
  }

  if (status.kind === "done-private") {
    return (
      <div className="claim-state">
        <div className="claim-done" role="status">
          <ShieldCheck size={18} aria-hidden /> Collected privately
        </div>
        <h2>{amount(status.amountUsd)} is in your private note</h2>
        <p className="claim-muted">
          It went into the privacy pool rather than to a public address, so the
          amount never appears against your wallet. Your wallet can see it;
          nobody else can.
        </p>
        {/* The hash is empty whenever the CHAIN observed the collection before the wallet
            returned — a real outcome, not an error. Rendering the anchor anyway produced
            `…/tx/`, a dead page offered to someone who had just been paid. */}
        {starknetTxUrl(status.txHash) ? (
          <a
            className="claim-tx"
            href={starknetTxUrl(status.txHash)!}
            target="_blank"
            rel="noreferrer noopener"
          >
            View the transaction <ArrowRight size={14} aria-hidden />
          </a>
        ) : (
          <p className="claim-muted">
            Your wallet completed it privately, so there is no public
            transaction to show here — the note is in your wallet.
          </p>
        )}
      </div>
    );
  }

  if (status.kind === "done") {
    return (
      <div className="claim-state">
        <div className="claim-done" role="status">
          <Check size={18} aria-hidden /> Sent
        </div>
        <h2>{amount(status.amountUsd)} is on its way</h2>
        <p className="claim-muted">
          It was sent to the address you gave. Sage paid the network fee, so the
          full amount arrives.
        </p>
        {starknetTxUrl(status.txHash) && (
          <a
            className="claim-tx"
            href={starknetTxUrl(status.txHash)!}
            target="_blank"
            rel="noreferrer noopener"
          >
            View the transaction <ArrowRight size={14} aria-hidden />
          </a>
        )}
      </div>
    );
  }

  const sending = status.kind === "sending";
  return (
    <div className="claim-state">
      <p className="claim-label">Waiting for you</p>
      <h2 className="claim-amount">{amount(status.amountUsd)}</h2>
      <p className="claim-muted">
        This is yours to collect. Collecting <b>privately</b> keeps the amount
        off your public record — it lands in a note only your wallet can see.
        You can send it to any Starknet address instead if you would rather. You
        need no account here, and you do not need to hold anything to receive
        this.
      </p>

      {secret && claims && token ? (
        <PrivateCollect
          secret={secret}
          claims={claims}
          token={token}
          onCollected={(txHash) =>
            setStatus({
              kind: "done-private",
              amountUsd: status.amountUsd,
              txHash,
            })
          }
        />
      ) : null}

      {/* THE PUBLIC ROUTE, SECOND AND FOLDED AWAY.
          It used to lead, so the first thing a worker met on a private-capable payout was a field
          asking for the address they were trying not to link this income to. The private note is
          what this rail is for; a public address is the fallback for someone who wants one. */}
      <details className="claim-public">
        <summary>Or send it to a public Starknet address</summary>
        <label className="claim-field">
          <span>Starknet address</span>
          <input
            value={recipient}
            onChange={(e) => setRecipient(e.target.value)}
            placeholder="0x…"
            spellCheck={false}
            autoComplete="off"
            disabled={sending}
            aria-invalid={recipient.length > 0 && !addressLooksValid}
          />
        </label>

        {error ? (
          <p className="claim-error" role="alert">
            {error}
          </p>
        ) : null}

        <button
          className="claim-button"
          onClick={collect}
          disabled={!addressLooksValid || sending}
        >
          {sending ? (
            <>
              <Loader2 className="claim-spin" size={16} aria-hidden /> Sending…
            </>
          ) : (
            <>Collect {amount(status.amountUsd)}</>
          )}
        </button>

        <p className="claim-fineprint">
          <ShieldCheck size={14} aria-hidden />
          Sage pays the network fee. Nobody — Sage included — can send this
          anywhere except where you say, and the link stops working the moment
          it is used.
        </p>
      </details>
    </div>
  );
}

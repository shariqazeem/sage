"use client";

import { useCallback, useState } from "react";
import { Check, Eye, EyeOff, Loader2 } from "lucide-react";

import { useWallet } from "@/lib/wallet/use-wallet";

/**
 * THE WORKER'S OWN CONTROL OVER WHETHER THEIR INCOME IS PUBLISHED.
 *
 * The record is public by default because receipts are the point of it for grants and MSME
 * capital. This is the other half of that honesty: someone paid through Sage should not have to
 * carry a permanent public income graph as the price of getting paid, so they can turn the amounts
 * off — and only they can.
 *
 * ONLY THE OWNER SEES A CONTROL AT ALL. A visitor is not shown a switch they cannot flip, and a
 * connected wallet that is not this record's is told so plainly rather than being left to click
 * and be refused. The change is signed, and the signature covers the DIRECTION, so one obtained to
 * make a record private cannot be replayed to make it public — which would publish someone's
 * income against their wishes, the exact harm this exists to prevent.
 */
export function PrivacyToggle({
  wallet,
  amountsPrivate,
}: {
  wallet: string;
  amountsPrivate: boolean;
}) {
  const { address, connect, connecting, available, getWalletClient } = useWallet();
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);

  const isOwner = !!address && address.toLowerCase() === wallet.toLowerCase();
  const current = done ?? amountsPrivate;

  const apply = useCallback(
    async (next: boolean) => {
      setError(null);
      setPending(true);
      try {
        const client = getWalletClient();
        if (!client || !address) throw new Error("Your wallet isn't connected.");
        const issuedAt = Math.floor(Date.now() / 1000);
        const message = [
          "Sage record privacy",
          `wallet: ${wallet.toLowerCase()}`,
          `amounts: ${next ? "private" : "public"}`,
          `issued: ${issuedAt}`,
        ].join("\n");

        const signature = await client.signMessage({ account: address, message });
        const res = await fetch(`/api/record/${wallet}/privacy`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ amountsPrivate: next, issuedAt, signature }),
        });
        const data = (await res.json()) as { ok?: boolean; error?: string };
        if (!res.ok || !data.ok) throw new Error(data.error ?? "That didn't save.");
        setDone(next);
        // The server-rendered figures above are now stale; the simplest honest fix is to re-read
        // the page rather than patch numbers in place and risk showing a half-updated record.
        setTimeout(() => window.location.reload(), 900);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setError(/user rejected|denied/i.test(msg) ? "You cancelled the signature." : msg);
      } finally {
        setPending(false);
      }
    },
    [address, getWalletClient, wallet],
  );

  // The OPTION is always stated, even with no wallet installed — otherwise the one person who
  // most needs to know this control exists (the worker whose income is on the page) would never
  // find out it did. Only the button is conditional, because offering one that cannot work is
  // worse than offering none.
  if (!address) {
    return (
      <div className="rec-privacy">
        <p className="rec-privacy-q">
          Is this your record? You can choose whether your payout amounts are public. Your
          completions, payers and receipts stay visible either way.
        </p>
        {available ? (
          <button
            className="rec-privacy-connect"
            onClick={() => void connect()}
            disabled={connecting}
          >
            {connecting ? (
              <>
                <Loader2 className="rec-spin" size={14} aria-hidden /> Connecting…
              </>
            ) : (
              "Connect wallet to change this"
            )}
          </button>
        ) : (
          <p className="rec-privacy-note">
            Open this page in a browser with your wallet to change it.
          </p>
        )}
      </div>
    );
  }

  if (!isOwner) {
    return (
      <div className="rec-privacy">
        <p className="rec-privacy-q">
          You&rsquo;re connected as a different wallet, so you can&rsquo;t change this record.
        </p>
      </div>
    );
  }

  return (
    <div className="rec-privacy">
      <div className="rec-privacy-row">
        <div className="rec-privacy-copy">
          <p className="rec-privacy-title">
            {current ? (
              <>
                <EyeOff size={14} aria-hidden /> Your payout amounts are private
              </>
            ) : (
              <>
                <Eye size={14} aria-hidden /> Your payout amounts are public
              </>
            )}
          </p>
          <p className="rec-privacy-note">
            {current
              ? "Your completions, payers and receipts stay visible, so your work is still provable — only the amounts are withheld. You can prove a figure to a lender with a signed statement instead."
              : "Anyone with this address can see what you were paid. Making it private keeps every receipt verifiable while withholding the amounts."}
          </p>
        </div>
        <button
          className="rec-privacy-btn"
          onClick={() => void apply(!current)}
          disabled={pending}
          aria-pressed={current}
        >
          {pending ? (
            <>
              <Loader2 className="rec-spin" size={14} aria-hidden /> Signing…
            </>
          ) : done !== null ? (
            <>
              <Check size={14} aria-hidden /> Saved
            </>
          ) : current ? (
            "Make public"
          ) : (
            "Make private"
          )}
        </button>
      </div>
      {error ? (
        <p className="rec-privacy-error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

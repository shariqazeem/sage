"use client";

import { useCallback, useState } from "react";
import { Check, Copy, FileSignature, Loader2 } from "lucide-react";
import { useWallet } from "@/lib/wallet/use-wallet";

/**
 * PROVE A FLOOR WITHOUT PUBLISHING THE FIGURE — the earner's half of selective disclosure.
 *
 * Renders only inside the withheld-amounts note, replacing the sentence that used to say Sage
 * "can issue" a statement with the place that issues it. Owner-gated the same way the privacy
 * toggle is: the request is signed by the record's own wallet, and the signature covers the FLOOR,
 * so the endpoint stays closed to the binary-search oracle (ask $500, $250, $375… and read the
 * income off the answers).
 *
 * The floor the earner types is a claim SAGE must be able to sign — a floor above their verified
 * earnings is refused without revealing the real figure. The output is a public, signed document:
 * safe to display, meant to be handed to a lender, verified at /lender or off-platform entirely.
 */
export function AttestCard({ wallet }: { wallet: string }) {
  const { address, getWalletClient } = useWallet();
  const [floor, setFloor] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [doc, setDoc] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const isOwner = !!address && address.toLowerCase() === wallet.toLowerCase();
  // The challenge verifies with an EVM signature; a Starknet-felt record signs differently and is
  // not wired yet — said plainly rather than offering a button that cannot work.
  const isEvm = /^0x[0-9a-fA-F]{40}$/.test(wallet);

  const issue = useCallback(async () => {
    setError(null);
    setDoc(null);
    const f = Number(floor);
    if (!Number.isFinite(f) || f <= 0) {
      setError("Enter the floor you want proved — a positive dollar amount.");
      return;
    }
    setPending(true);
    try {
      const client = getWalletClient();
      if (!client || !address) throw new Error("Connect the wallet this record belongs to.");
      const issuedAt = Math.floor(Date.now() / 1000);
      // EXACTLY attestationChallenge() — reproduced here because the wallet must show the user
      // the same bytes the server verifies.
      const message = [
        "Sage earnings attestation",
        `wallet: ${wallet.toLowerCase()}`,
        `floor: at least $${f.toFixed(2)}`,
        `issued: ${issuedAt}`,
      ].join("\n");
      const signature = await client.signMessage({ account: address, message });
      const res = await fetch(`/api/record/${wallet}/attest`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ earnedAtLeastUsd: f, issuedAt, signature }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string; attestation?: unknown };
      if (!res.ok || !data.ok) throw new Error(data.error ?? "Sage declined to attest that.");
      setDoc(JSON.stringify(data.attestation, null, 2));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(/user rejected|denied/i.test(msg) ? "You cancelled the signature." : msg);
    } finally {
      setPending(false);
    }
  }, [address, floor, getWalletClient, wallet]);

  const copy = useCallback(() => {
    if (!doc) return;
    void navigator.clipboard.writeText(doc).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    });
  }, [doc]);

  if (!isEvm) {
    return (
      <p className="att-note">
        Floor attestations sign with an EVM wallet today; Starknet-wallet signing is next. The
        record itself stays provable — every entry is transaction-anchored.
      </p>
    );
  }
  if (!isOwner) {
    return (
      <p className="att-note">
        The owner of this record can issue a <b>signed earnings floor</b> here — proof of
        &ldquo;earned at least $X&rdquo; a lender can verify, without this page ever publishing the
        figure.
      </p>
    );
  }

  return (
    <div className="att-card">
      <div className="att-row">
        <label htmlFor="att-floor">Prove a floor</label>
        <span className="att-prefix">$</span>
        <input
          id="att-floor"
          inputMode="decimal"
          placeholder="25.00"
          value={floor}
          onChange={(e) => setFloor(e.target.value)}
          disabled={pending}
        />
        <button onClick={() => void issue()} disabled={pending || !floor.trim()}>
          {pending ? <Loader2 className="att-spin" size={14} aria-hidden /> : <FileSignature size={14} aria-hidden />}
          {pending ? "Signing" : "Sign & issue"}
        </button>
      </div>
      <p className="att-hint">
        You sign the request; Sage signs the statement — only if your verified earnings actually
        reach the floor. Valid 30 days. Hand it to a lender; they verify it at{" "}
        <a href="/lender">/lender</a> or with any EVM library.
      </p>
      {error && <p className="att-err" role="alert">{error}</p>}
      {doc && (
        <div className="att-out">
          <textarea readOnly value={doc} rows={6} spellCheck={false} aria-label="Signed attestation" />
          <button onClick={copy} className="att-copy">
            {copied ? <Check size={13} aria-hidden /> : <Copy size={13} aria-hidden />}
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
      )}
    </div>
  );
}

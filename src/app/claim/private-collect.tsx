"use client";

import { useCallback, useEffect, useState } from "react";
import { ArrowRight, Loader2, ShieldCheck } from "lucide-react";

import { buildClaimToNoteActions, type Strk20Action } from "@/lib/starknet/strk20-actions";

/**
 * COLLECTING INTO A SHIELDED NOTE.
 *
 * The other door on this page sends the payout to an address, in public. This one hands the
 * collection to the STRK20 pool instead, so the money lands in a private note and the recipient's
 * balance never appears on chain at all.
 *
 * It requires a wallet that implements the STRK20 methods AND an account already registered with
 * the pool — registration happens inside the wallet's own screen and no dapp can do it for
 * someone. That is why this is offered as an option rather than the default: most people Sage pays
 * are receiving their first crypto and cannot use it, and for them the public door is the whole
 * point.
 *
 * Sage does not sign, submit, or see anything here. The wallet holds the viewing key, generates
 * the proof, and sends the transaction.
 */

interface InjectedWallet {
  id?: string;
  name?: string;
  icon?: string;
  request: (call: { type: string; params?: unknown }) => Promise<unknown>;
}

/** Wallets inject themselves onto `window` under a `starknet`-prefixed key. */
function injectedWallets(): InjectedWallet[] {
  if (typeof window === "undefined") return [];
  const seen = new Set<unknown>();
  const out: InjectedWallet[] = [];
  for (const key of Object.keys(window)) {
    if (!key.toLowerCase().startsWith("starknet")) continue;
    const w = (window as unknown as Record<string, unknown>)[key];
    if (w && typeof (w as InjectedWallet).request === "function" && !seen.has(w)) {
      seen.add(w);
      out.push(w as InjectedWallet);
    }
  }
  return out;
}

type State =
  | { kind: "idle" }
  | { kind: "working"; step: string }
  | { kind: "done"; txHash: string }
  | { kind: "error"; message: string };

/**
 * Turn the wallet's error into something a person can act on.
 *
 * NOT_REGISTERED is the one that matters: it is not a bug and not something this page can fix.
 * The pool refuses accounts that have never registered a viewing key, and only the account holder
 * can do that, inside their own wallet.
 */
function explain(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  if (/NOT_REGISTERED|118/i.test(raw)) {
    return "This wallet has never joined the privacy pool. Only you can register it, from inside your wallet's own screen — no website can do it for you. You can still collect to an address above.";
  }
  if (/USER_REFUSED|rejected|denied/i.test(raw)) return "You cancelled the request in your wallet.";
  if (/INVALID_REQUEST_PAYLOAD|114/i.test(raw)) {
    return "The wallet rejected the request as malformed. Please report this — it is a bug in Sage, not in anything you did.";
  }
  if (/not supported|unknown method|-32601/i.test(raw)) {
    return "This wallet does not support private transfers yet. You can still collect to an address above.";
  }
  return raw.slice(0, 200);
}

export function PrivateCollect({
  secret,
  claims,
  token,
}: {
  secret: string;
  claims: string;
  token: string;
}) {
  const [wallets, setWallets] = useState<InjectedWallet[]>([]);
  const [state, setState] = useState<State>({ kind: "idle" });

  useEffect(() => {
    // Injection can land after hydration, so look once now and once shortly after.
    setWallets(injectedWallets());
    const t = setTimeout(() => setWallets(injectedWallets()), 600);
    return () => clearTimeout(t);
  }, []);

  const collect = useCallback(
    async (wallet: InjectedWallet) => {
      try {
        setState({ kind: "working", step: "Connecting…" });
        const accounts = (await wallet.request({
          type: "wallet_requestAccounts",
        })) as string[];
        const recipient = accounts?.[0];
        if (!recipient) throw new Error("the wallet returned no account");

        // Capability check via supportedWalletApi rather than by calling a STRK20 method — a
        // balance read is itself gated behind a consent prompt, so probing with one would raise a
        // prompt the person cannot account for.
        setState({ kind: "working", step: "Checking wallet support…" });
        try {
          await wallet.request({ type: "wallet_supportedWalletApi" });
        } catch {
          /* older wallets omit it; let the invoke be the real test */
        }

        setState({ kind: "working", step: "Waiting for your wallet to prove and sign…" });
        const actions: Strk20Action[] = buildClaimToNoteActions({
          claims,
          token,
          secret,
          recipient,
        });
        const res = (await wallet.request({
          type: "wallet_strk20InvokeTransaction",
          params: { actions },
        })) as { transaction_hash?: string };

        if (!res?.transaction_hash) throw new Error("the wallet returned no transaction");
        setState({ kind: "done", txHash: res.transaction_hash });
      } catch (err) {
        setState({ kind: "error", message: explain(err) });
      }
    },
    [claims, secret, token],
  );

  if (state.kind === "done") {
    return (
      <div className="claim-private">
        <p className="claim-private-ok">
          <ShieldCheck size={14} aria-hidden /> Collected into a private note
        </p>
        <a
          className="claim-tx"
          href={`https://voyager.online/tx/${state.txHash}`}
          target="_blank"
          rel="noreferrer noopener"
        >
          View the transaction <ArrowRight size={14} aria-hidden />
        </a>
      </div>
    );
  }

  if (wallets.length === 0) {
    return (
      <div className="claim-private">
        <p className="claim-private-note">
          Already use a privacy-enabled Starknet wallet? Open this page in it to collect into a
          private note instead, so the amount never appears against your address.
        </p>
      </div>
    );
  }

  const busy = state.kind === "working";
  return (
    <div className="claim-private">
      <p className="claim-private-note">
        Or collect into a <strong>private note</strong>, so the amount never appears against your
        address. Needs a wallet already registered with the privacy pool.
      </p>
      {wallets.map((w, i) => (
        <button
          key={w.id ?? w.name ?? i}
          className="claim-private-btn"
          onClick={() => collect(w)}
          disabled={busy}
        >
          {busy ? (
            <>
              <Loader2 className="claim-spin" size={14} aria-hidden /> {state.step}
            </>
          ) : (
            <>Collect privately with {w.name ?? "wallet"}</>
          )}
        </button>
      ))}
      {state.kind === "error" ? (
        <p className="claim-error" role="alert">
          {state.message}
        </p>
      ) : null}
    </div>
  );
}

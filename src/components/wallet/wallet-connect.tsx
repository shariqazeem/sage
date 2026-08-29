"use client";

import { ChevronRight, Loader2, ShieldCheck, Wallet } from "lucide-react";

/**
 * ONE WAY TO CONNECT A WALLET, WHICHEVER CHAIN PAYS.
 *
 * Sage settles on two rails, and before this they asked for a wallet in two visibly different
 * ways. The EVM side rendered a single button, because the browser injects one provider and picks
 * for you. The Starknet side rendered one PRIMARY button per installed wallet, side by side — so
 * a person with Ready and Braavos both installed met two competing calls to action of identical
 * weight, in a row, with nothing to choose between them. Two wallets read as two decisions.
 *
 * SO CHOOSING A WALLET IS A LIST, NOT A ROW OF BUTTONS. A list has one visual weight, reads
 * top-to-bottom, and grows to three wallets without becoming a wall. The primary-button treatment
 * is kept for the case where it is honest — exactly one option, therefore exactly one action.
 *
 * And both rails render through here, so connecting feels the same whether a campaign pays in
 * public receipts or privately. The chain is Sage's problem, not something to make a person feel
 * in the layout.
 */

export interface WalletOption {
  id: string;
  name: string;
  /** The wallet's own icon, usually a data URI. Falls back to a line icon. */
  icon?: string;
  onSelect: () => void;
}

export interface WalletInstallHint {
  name: string;
  url: string;
}

export function WalletConnect({
  options,
  explainer,
  busy = false,
  busyLabel = "Signing…",
  error = null,
  installHints = [],
  emptyMessage,
}: {
  options: WalletOption[];
  /** What signing means, in the caller's own words — a tester and a founder need different ones. */
  explainer: React.ReactNode;
  busy?: boolean;
  busyLabel?: string;
  error?: string | null;
  installHints?: WalletInstallHint[];
  emptyMessage?: React.ReactNode;
}) {
  const single = options.length === 1;

  return (
    <div className="wc">
      <p className="wc-explain">{explainer}</p>

      {busy ? (
        <div className="wc-busy" role="status">
          <Loader2 size={15} className="wc-spin" aria-hidden /> {busyLabel}
        </div>
      ) : options.length === 0 ? (
        <div className="wc-empty">
          <p>{emptyMessage ?? "No wallet found in this browser."}</p>
          {installHints.length > 0 && (
            <ul className="wc-installs">
              {installHints.map((h) => (
                <li key={h.url}>
                  <a href={h.url} target="_blank" rel="noreferrer noopener">
                    Install {h.name}
                    <ChevronRight size={14} aria-hidden />
                  </a>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : single ? (
        // One option is one action, so it keeps the primary-button weight it deserves.
        <button className="wc-single" onClick={options[0].onSelect}>
          <WalletIcon option={options[0]} />
          Connect {options[0].name}
        </button>
      ) : (
        <ul className="wc-list">
          {options.map((o) => (
            <li key={o.id}>
              <button className="wc-row" onClick={o.onSelect}>
                <WalletIcon option={o} />
                <span className="wc-name">{o.name}</span>
                <ChevronRight size={15} className="wc-chev" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      )}

      {error && (
        <div className="wc-err" role="alert">
          {error}
        </div>
      )}

      <p className="wc-assure">
        <ShieldCheck size={13} aria-hidden /> Signing proves you control the wallet. It authorizes
        no transaction and moves no funds.
      </p>
    </div>
  );
}

function WalletIcon({ option }: { option: WalletOption }) {
  if (option.icon) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img className="wc-icon" src={option.icon} alt="" width={20} height={20} />;
  }
  return <Wallet size={17} className="wc-icon-fallback" aria-hidden />;
}

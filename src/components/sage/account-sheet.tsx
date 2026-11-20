"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ArrowUpRight, Check, ChevronRight, Copy, LogOut } from "lucide-react";
import QRCode from "qrcode";
import { YourWallet } from "@/components/wallet/your-wallet";
import { ACCOUNT_LINKS } from "@/components/shell/routes";
import { useFounderSession } from "@/lib/auth/use-founder-session";
import { METIS_MAINNET_CHAIN_ID } from "@/lib/deputy/networks";
import { short } from "@/lib/format";
import { Button } from "./button";
import { Sheet } from "./sheet";

type WalletRead = { ok: boolean; usd: number; nativeWei: string; nativeSymbol: string; network: string; explorerUrl: string };
type RecordRead = { ok: boolean; completions?: number; totalUsd?: number; amountsWithheld?: boolean };
type TreasuryRead = { linked?: boolean; balanceUsd?: number; network?: string };

/** METIS to four places, from wei, without pulling a number library into the sheet. */
function nativeAmount(wei: string): string {
  try {
    const v = BigInt(wei);
    const whole = v / BigInt(10) ** BigInt(18);
    const frac = ((v % BigInt(10) ** BigInt(18)) / BigInt(10) ** BigInt(14)).toString().padStart(4, "0");
    return `${whole}.${frac}`;
  } catch {
    return "0.0000";
  }
}

/**
 * THE ACCOUNT SHEET, from the avatar. Your wallet (the address, its QR, m.USDC and METIS, add money,
 * send), your record, and the way to the screens the rail used to hold. Sending is the product's own
 * `YourWallet`: this sheet frames it and changes nothing about how money moves.
 */
export function AccountSheet({ open, address, chain, onClose }: { open: boolean; address: string; chain: "evm" | "starknet" | null; onClose: () => void }) {
  const router = useRouter();
  const founder = useFounderSession();
  const evm = chain === "evm";
  const [wallet, setWallet] = useState<WalletRead | null | "unread">(null);
  const [record, setRecord] = useState<RecordRead | null>(null);
  const [treasury, setTreasury] = useState<TreasuryRead | null>(null);
  const [panel, setPanel] = useState<"add" | "send" | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!open) return;
    let live = true;
    const read = async <T,>(url: string): Promise<T | null> => {
      try {
        const r = await fetch(url, { cache: "no-store" });
        return r.ok ? ((await r.json()) as T) : null;
      } catch {
        return null;
      }
    };
    if (evm) {
      void read<WalletRead>(`/api/wallet?chainId=${METIS_MAINNET_CHAIN_ID}`).then((w) => live && setWallet(w && w.ok ? w : "unread"));
      void read<TreasuryRead>("/api/treasury").then((t) => live && setTreasury(t));
    }
    void read<RecordRead>(`/api/record/${address}`).then((r) => live && setRecord(r));
    return () => {
      live = false;
    };
  }, [open, address, evm]);

  useEffect(() => {
    if (panel !== "add" || qr) return;
    let live = true;
    // ink on white: the two tokens' values, which a QR image needs as literals
    void QRCode.toString(address, { type: "svg", margin: 1, color: { dark: "#1a1d21", light: "#ffffff" } }).then((svg) => live && setQr(`data:image/svg+xml;utf8,${encodeURIComponent(svg)}`));
    return () => {
      live = false;
    };
  }, [panel, qr, address]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* no clipboard: the address is on screen to select */
    }
  };

  const signOut = async () => {
    await founder.signOut();
    onClose();
    router.push("/");
    router.refresh();
  };

  const read = wallet && wallet !== "unread" ? wallet : null;
  const tries = record?.completions ?? 0;

  return (
    <Sheet open={open} onClose={onClose} title="Your account">
      <section className="sg-acct-block" aria-label="Your wallet">
        <p className="sg-label">Your wallet</p>
        <div className="sg-acct-card">
          <div className="sg-acct-addr">
            <code>{address}</code>
            <div className="sg-acct-actions">
              <Button variant="quiet" size="sm" onClick={() => void copy()}>
                {copied ? <Check size={14} aria-hidden /> : <Copy size={14} aria-hidden />} {copied ? "Copied" : "Copy address"}
              </Button>
              {evm ? (
                <>
                  <Button variant="quiet" size="sm" aria-expanded={panel === "add"} onClick={() => setPanel(panel === "add" ? null : "add")}>
                    Add money
                  </Button>
                  <Button variant="quiet" size="sm" aria-expanded={panel === "send"} onClick={() => setPanel(panel === "send" ? null : "send")}>
                    Send
                  </Button>
                </>
              ) : null}
            </div>
            {panel === "add" ? (
              <div className="sg-acct-add">
                {qr ? <Image className="sg-acct-qr" src={qr} alt="This wallet's address as a QR code" width={132} height={132} unoptimized /> : <span className="sg-acct-qr" aria-hidden />}
                <p className="sg-small">
                  Send m.USDC on the Metis network to this address. Sending anything needs a little METIS for the network fee, which Binance sells on the Metis network.
                </p>
              </div>
            ) : null}
          </div>
          {evm ? (
            <>
              <div className="sg-acct-row">
                <span className="sg-acct-k">m.USDC</span>
                {read ? <span className="sg-mono">{`$${read.usd.toFixed(2)}`}</span> : <span className="sg-acct-wait">{wallet === "unread" ? "Couldn't read it just now" : "Reading"}</span>}
              </div>
              <div className="sg-acct-row">
                <span className="sg-acct-k">METIS, for network fees</span>
                {read ? <span className="sg-mono">{nativeAmount(read.nativeWei)}</span> : <span className="sg-acct-wait">{wallet === "unread" ? "Couldn't read it just now" : "Reading"}</span>}
              </div>
              {read ? (
                <a className="sg-acct-row" href={read.explorerUrl} target="_blank" rel="noreferrer">
                  <span>See it on the Metis explorer</span>
                  <ArrowUpRight size={16} aria-hidden />
                </a>
              ) : null}
            </>
          ) : (
            <div className="sg-acct-row">
              <span className="sg-acct-k">This is a Starknet sign-in. Sage runs on Metis now: sign in with an email or MetaMask to hold money here.</span>
            </div>
          )}
        </div>
        {panel === "send" && evm ? (
          <div className="sg-wallet">
            <YourWallet address={address} />
          </div>
        ) : null}
        {treasury?.linked ? (
          <div className="sg-acct-card">
            <Link className="sg-acct-row" href="/workspace/account" onClick={onClose}>
              <span>
                Sage account{typeof treasury.balanceUsd === "number" ? <span className="sg-acct-k">, holding </span> : null}
                {typeof treasury.balanceUsd === "number" ? <span className="sg-mono">${treasury.balanceUsd.toFixed(2)}</span> : null}
              </span>
              <ChevronRight size={16} aria-hidden />
            </Link>
          </div>
        ) : null}
      </section>

      <section className="sg-acct-block" aria-label="Your record">
        <p className="sg-label">Your record</p>
        <div className="sg-acct-card">
          <Link className="sg-acct-row" href={`/record/${address}`} onClick={onClose}>
            <span>
              {record === null ? (
                <span className="sg-acct-k">Paid tries, with a receipt for each</span>
              ) : tries === 0 ? (
                <span className="sg-acct-k">No paid tries yet</span>
              ) : (
                <>
                  <span className="sg-mono">{tries}</span> paid {tries === 1 ? "try" : "tries"}
                  {typeof record.totalUsd === "number" && !record.amountsWithheld ? (
                    <>
                      <span className="sg-acct-k">, </span>
                      <span className="sg-mono">${record.totalUsd.toFixed(2)}</span> earned
                    </>
                  ) : null}
                </>
              )}
            </span>
            <ChevronRight size={16} aria-hidden />
          </Link>
        </div>
      </section>

      <section className="sg-acct-block" aria-label="More">
        <p className="sg-label">More</p>
        <div className="sg-acct-card">
          {ACCOUNT_LINKS.map((l) => (
            <Link key={l.href} className="sg-acct-row" href={l.href} onClick={onClose}>
              <span>{l.label}</span>
              <ChevronRight size={16} aria-hidden />
            </Link>
          ))}
        </div>
        <div className="sg-acct-card">
          <button type="button" className="sg-acct-row" onClick={() => void signOut()}>
            <span>
              Sign out <span className="sg-acct-k sg-mono">{short(address)}</span>
            </span>
            <LogOut size={16} aria-hidden />
          </button>
        </div>
      </section>
    </Sheet>
  );
}

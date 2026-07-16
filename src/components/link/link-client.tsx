"use client";

import { useCallback, useState } from "react";
import {
  ArrowRight,
  Check,
  CheckCircle2,
  Copy,
  Loader2,
  Lock,
  ShieldCheck,
  Wallet,
} from "lucide-react";
import { short, usd } from "@/lib/format";
import { useSiwe } from "@/lib/auth/use-siwe";

interface LinkResult {
  walletAddress: string;
  perCampaignCapUsd: number;
}

const CAP_PRESETS = [25, 50, 100, 250];

/**
 * The founder-facing half of the Telegram agent-wallet link. Connect → sign (SIWE, no transaction) →
 * choose a per-campaign cap → mint the agent wallet. Every guarantee shown here is enforced on-chain
 * by the wallet's policy, not by this UI; the page only gathers a signature and a number.
 */
export function LinkClient({ token }: { token: string }) {
  const siwe = useSiwe();
  const [capUsd, setCapUsd] = useState("50");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<LinkResult | null>(null);
  const [copied, setCopied] = useState(false);

  const cap = Number(capUsd);
  const capValid = Number.isFinite(cap) && cap > 0 && cap <= 100_000;

  const create = useCallback(async () => {
    if (!capValid) return;
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch("/api/tg/link", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token, perCampaignCapUsd: cap }),
      });
      const json = (await res.json()) as {
        ok?: boolean;
        error?: string;
        walletAddress?: string;
        perCampaignCapUsd?: number;
      };
      if (!res.ok || !json.ok || !json.walletAddress) {
        setError(json.error ?? "Couldn't create your agent wallet — try again.");
        return;
      }
      setResult({ walletAddress: json.walletAddress, perCampaignCapUsd: json.perCampaignCapUsd ?? cap });
    } catch {
      setError("Network error — try again.");
    } finally {
      setSubmitting(false);
    }
  }, [token, cap, capValid]);

  const copyAddress = useCallback(async (address: string) => {
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked — the address is visible to copy by hand */
    }
  }, []);

  return (
    <main className="link-wrap">
      <div className="link-card">
        <div className="link-brand">
          <span className="mono">SAGE</span>
          <span className="link-brand-tag">Agent wallet</span>
        </div>

        {result ? (
          /* ── success ──────────────────────────────────────────────────── */
          <>
            <div className="link-ok">
              <CheckCircle2 size={20} color="var(--pos)" />
              <h1>Agent wallet ready</h1>
            </div>
            <p className="link-lead">
              Send USDC on GOAT to this address (plus a little native BTC for gas). Sage can spend up
              to <strong>{usd(result.perCampaignCapUsd)}</strong> of it per campaign — never more — and
              any leftover returns only to your wallet.
            </p>

            <div className="link-addr">
              <div className="link-addr-label">Your agent wallet · GOAT</div>
              <div className="link-addr-row">
                <code className="mono">{result.walletAddress}</code>
                <button
                  className="sage-btn sage-btn-ghost sage-btn-sm"
                  onClick={() => void copyAddress(result.walletAddress)}
                >
                  {copied ? <Check size={14} /> : <Copy size={14} />}
                  {copied ? "Copied" : "Copy"}
                </button>
              </div>
            </div>

            <div className="link-next">
              <ArrowRight size={15} color="var(--sec)" />
              <span>
                Back in Telegram, tell @sagedeputybot to test your product — it funds and launches the
                campaign from this wallet, no browser needed. We&apos;ve sent the address to your chat
                too.
              </span>
            </div>
          </>
        ) : !siwe.authed ? (
          /* ── connect + sign ───────────────────────────────────────────── */
          <>
            <h1 className="link-title">Link your agent wallet</h1>
            <p className="link-lead">
              Connect the wallet you control and set a spending limit. Sage creates a policy-guarded
              agent wallet on GOAT that it can fund your testing campaigns from — inside limits it can
              never exceed.
            </p>

            <Guarantees />

            {!siwe.available ? (
              <div className="sage-toast info">
                <Wallet size={15} />
                Open this link in a browser with a wallet (like MetaMask) to connect.
              </div>
            ) : (
              <button
                className="sage-btn sage-btn-primary link-cta"
                onClick={() => void siwe.signIn()}
                disabled={siwe.signingIn || siwe.connecting}
              >
                {siwe.signingIn || siwe.connecting ? (
                  <>
                    <Loader2 size={16} className="sage-spin2" /> Signing…
                  </>
                ) : siwe.address ? (
                  <>
                    <ShieldCheck size={16} /> Sign in as {short(siwe.address)}
                  </>
                ) : (
                  <>
                    <Wallet size={16} /> Connect wallet
                  </>
                )}
              </button>
            )}
            <p className="sage-hint" style={{ marginTop: 12 }}>
              Signing proves you control the wallet. It authorizes no transaction and moves no funds.
            </p>
          </>
        ) : (
          /* ── set cap + create ─────────────────────────────────────────── */
          <>
            <h1 className="link-title">Set your spending limit</h1>
            <p className="link-lead">
              Sage will never spend more than this on a single campaign. Fund the wallet with as much
              USDC as you like — this only caps how much it can commit at once.
            </p>

            <div className="sage-field">
              <label className="sage-label">Per-campaign cap (USDC)</label>
              <input
                className="sage-input mono"
                type="number"
                inputMode="decimal"
                min={1}
                max={100000}
                value={capUsd}
                onChange={(e) => setCapUsd(e.target.value)}
                disabled={submitting}
              />
              <div className="link-presets">
                {CAP_PRESETS.map((v) => (
                  <button
                    key={v}
                    type="button"
                    className={`sage-btn sage-btn-ghost sage-btn-sm${cap === v ? " link-preset-on" : ""}`}
                    onClick={() => setCapUsd(String(v))}
                    disabled={submitting}
                  >
                    {usd(v)}
                  </button>
                ))}
              </div>
            </div>

            <Guarantees />

            <button
              className="sage-btn sage-btn-primary link-cta"
              onClick={() => void create()}
              disabled={submitting || !capValid}
            >
              {submitting ? (
                <>
                  <Loader2 size={16} className="sage-spin2" /> Creating…
                </>
              ) : (
                <>
                  <Lock size={16} /> Create agent wallet
                </>
              )}
            </button>
            <p className="sage-hint" style={{ marginTop: 12 }}>
              Leftover always returns only to {short(siwe.address ?? "your wallet")}.
            </p>

            {error && (
              <div className="sage-toast dan">
                <span>{error}</span>
              </div>
            )}
          </>
        )}
      </div>

      <style>{CSS}</style>
    </main>
  );
}

function Guarantees() {
  return (
    <ul className="link-guarantees">
      {[
        "Spends only up to the cap you set, per campaign.",
        "Funds only your own testing campaigns — nothing else.",
        "Any leftover returns only to your wallet.",
      ].map((g) => (
        <li key={g}>
          <ShieldCheck size={15} color="var(--pos)" />
          <span>{g}</span>
        </li>
      ))}
    </ul>
  );
}

const CSS = `
.link-wrap {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
}
.link-card {
  width: 100%;
  max-width: 440px;
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: 16px;
  padding: 30px 28px;
  box-shadow: var(--shadow);
}
.link-brand {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 22px;
}
.link-brand .mono {
  font-family: var(--font-mono), monospace;
  font-size: 13px;
  font-weight: 600;
  letter-spacing: 0.14em;
  color: var(--ink);
}
.link-brand-tag {
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--ter);
  border: 1px solid var(--line);
  border-radius: 6px;
  padding: 2px 7px;
}
.link-title {
  font-size: 22px;
  font-weight: 650;
  letter-spacing: -0.02em;
  margin: 0 0 10px;
  color: var(--ink);
}
.link-ok {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 10px;
}
.link-ok h1 { font-size: 22px; font-weight: 650; letter-spacing: -0.02em; margin: 0; color: var(--ink); }
.link-lead { font-size: 14.5px; line-height: 1.55; color: var(--sec); margin: 0 0 20px; }
.link-lead strong { color: var(--ink); font-weight: 650; }
.link-guarantees { list-style: none; margin: 0 0 22px; padding: 0; display: flex; flex-direction: column; gap: 11px; }
.link-guarantees li { display: flex; gap: 9px; align-items: flex-start; font-size: 13.5px; line-height: 1.45; color: var(--sec); }
.link-guarantees svg { flex: none; margin-top: 1px; }
.link-cta { width: 100%; }
.link-presets { display: flex; gap: 7px; margin-top: 9px; flex-wrap: wrap; }
.link-preset-on { border-color: var(--accent); color: var(--ink); }
.link-addr {
  border: 1px solid var(--line);
  border-radius: 12px;
  padding: 13px 14px;
  background: var(--surface-2);
  margin-bottom: 18px;
}
.link-addr-label { font-size: 11.5px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.06em; color: var(--ter); margin-bottom: 8px; }
.link-addr-row { display: flex; gap: 10px; align-items: center; justify-content: space-between; }
.link-addr-row code { font-size: 12.5px; color: var(--ink); word-break: break-all; }
.link-next {
  display: flex;
  gap: 10px;
  align-items: flex-start;
  font-size: 13.5px;
  line-height: 1.5;
  color: var(--sec);
  border-top: 1px solid var(--line);
  padding-top: 16px;
}
.link-next svg { flex: none; margin-top: 2px; }
`;

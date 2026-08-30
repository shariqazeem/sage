"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, ExternalLink, Loader2, ShieldCheck } from "lucide-react";

import { useStarknetWallet, type StarknetWallet } from "@/lib/starknet/use-starknet-wallet";
import { sameFelt } from "@/lib/starknet/felt";
import { toWalletCalls } from "@/lib/starknet/vault-calls";
import { WalletConnect } from "@/components/wallet/wallet-connect";
import { useFounderSession } from "@/lib/auth/use-founder-session";
import type { PlanView } from "../types";

/**
 * STANDING UP A PRIVATE-CAPABLE CAMPAIGN, IN ONE SIGNATURE.
 *
 * The founder's own wallet deploys the vault, funds it, and writes every mission's terms into it —
 * all in a single transaction, because Starknet executes a list of calls atomically and the vault's
 * address is derivable before it exists. Sage never touches it. That is what makes the founder its
 * owner and leaves Sage holding nothing but an operator key that cannot withdraw.
 *
 * WHY ONE SIGNATURE RATHER THAN FOUR STEPS. Not for the click count: a half-finished vault is a
 * genuine hazard. Funded but missionless pays nobody; missions but unfunded advertises work it
 * cannot honour. There is no partial state here to be stranded in — either the campaign exists in
 * full or nothing happened.
 *
 * The server computes the calls and this only signs them, so the mission ids written into the
 * vault are by construction the ones settlement will look up later.
 */

interface DeployPlan {
  classHash: string;
  operator: string;
  token: string;
  totalBase: string;
  missions: { title: string; missionId: string; rewardBase: string; maxCompletions: number }[];
  vaultAddress?: string;
  calls?: { contractAddress: string; entrypoint: string; calldata: string[] }[];
  deployed?: boolean;
}

type Phase =
  | { kind: "connect" }
  | { kind: "review" }
  | { kind: "working"; step: string }
  | { kind: "done"; campaignId: string; txHash: string | null };

const usd = (base: string | number): string => `$${(Number(base) / 1e6).toFixed(2)}`;
const short = (a: string): string => `${a.slice(0, 10)}…${a.slice(-6)}`;

export function StarknetDeployFlow({ jobId, plan }: { jobId: string; plan: PlanView }) {
  const wallet = useStarknetWallet();
  const [deployPlan, setDeployPlan] = useState<DeployPlan | null>(null);
  const [phase, setPhase] = useState<Phase>({ kind: "connect" });
  const [error, setError] = useState<string | null>(null);

  /**
   * ALREADY SIGNED IN IS ALREADY CONNECTED.
   *
   * This ran its own wallet-discovery instance, so signing in did not populate it — the founder
   * was asked to connect the very wallet they had just proved they control, and Ready answered a
   * second `wallet_requestAccounts` by neither prompting nor resolving. The screen sat on
   * "Waiting for your wallet…" forever.
   *
   * The session address is enough to price the deployment and derive the vault's address. The
   * wallet object itself is only needed to SIGN, so it is asked for at that moment — when a prompt
   * is expected and its absence would be obvious.
   */
  const founder = useFounderSession();
  const [pickedName, setPickedName] = useState<string | null>(null);
  const sessionAddress = founder.chain === "starknet" ? founder.address : null;
  const address = wallet.connected?.address ?? sessionAddress;

  /**
   * Resolve the wallet at the moment it must SIGN, rather than up front.
   *
   * The founder's identity comes from their session, so nothing above this point needs the wallet
   * open. Here it does — and a prompt appearing now is expected, which makes its absence legible
   * instead of mysterious.
   */
  const signAndLaunch = async () => {
    let w = wallet.connected?.wallet ?? null;
    if (!w) {
      const candidates = wallet.wallets;
      if (candidates.length === 0) {
        setError("No Starknet wallet found in this browser.");
        return;
      }
      // One wallet is unambiguous. With several, prefer the one already named by the session.
      const pick =
        candidates.length === 1
          ? candidates[0]
          : (candidates.find((c) => c.name.toLowerCase() === (pickedName ?? "").toLowerCase()) ??
            null);
      if (!pick) {
        setPickedName(null);
        setError("Choose which wallet should own this vault.");
        return;
      }
      const addr = await wallet.connect(pick);
      if (!addr) return; // the hook already surfaced why
      // THE OWNER MUST BE THE FOUNDER. Deploying from a different wallet would build a vault the
      // campaign's own attach step then refuses, after the money has already moved.
      if (sessionAddress && !sameFelt(addr, sessionAddress)) {
        setError(
          `That wallet (${short(addr)}) is not the one you signed in with (${short(sessionAddress)}). Switch accounts in the wallet, or sign in again with this one.`,
        );
        return;
      }
      w = pick;
    }
    await launch(w);
  };

  // The plan is fetched twice on purpose: once with no wallet, to show the founder what this will
  // cost before asking them to connect anything, and again once an address exists, because the
  // vault's address depends on who deploys it.
  useEffect(() => {
    let cancelled = false;
    const url = address
      ? `/api/launch/${jobId}/starknet?owner=${encodeURIComponent(address)}`
      : `/api/launch/${jobId}/starknet`;
    fetch(url)
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return;
        if (!d.ok) {
          setError(d.error ?? "Could not prepare this campaign.");
          return;
        }
        setDeployPlan(d as DeployPlan);
        setPhase((p) => (p.kind === "connect" && address ? { kind: "review" } : p));
      })
      .catch(() => !cancelled && setError("Could not reach Sage. Check your connection."));
    return () => {
      cancelled = true;
    };
  }, [jobId, address]);

  const attach = useCallback(
    async (vaultAddress: string, ownerAddress: string, txHash: string | null) => {
      setPhase({ kind: "working", step: "Checking the vault on Starknet…" });
      const res = await fetch(`/api/launch/${jobId}/starknet`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ vaultAddress, ownerAddress }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error ?? "Sage could not verify the vault.");
      setPhase({ kind: "done", campaignId: data.campaignId as string, txHash });
    },
    [jobId],
  );

  const launch = useCallback(
    async (w: StarknetWallet) => {
      if (!deployPlan?.calls || !deployPlan.vaultAddress || !address) return;
      setError(null);
      try {
        // Already funded on a previous attempt — go straight to attaching rather than asking the
        // founder to pay twice.
        if (deployPlan.deployed) {
          await attach(deployPlan.vaultAddress, address, null);
          return;
        }

        setPhase({ kind: "working", step: "Waiting for you to confirm in your wallet…" });

        /**
         * THE WALLET ANSWERS WHEN IT SUBMITS, NOT WHEN THE CHAIN ACCEPTS — and only the chain can
         * say the vault exists.
         *
         * These two were raced, first answer wins. The wallet always won, because submitting is
         * fast: attach then ran against an address with no contract at it yet, and refused with
         * "That address is not a Sage vault". The founder had already paid. The money was fine, the
         * vault was fine, and the campaign did not open.
         *
         * A wallet promise that never resolves is still a real hazard — the transaction lands, the
         * money moves, and the page waits forever on a confirmation that already happened, which on
         * a funding screen invites paying twice. So the wallet is still raced, but only to learn
         * the transaction hash. Attaching waits for the CHAIN, which is the only party that can
         * answer the question attach actually asks.
         */
        const walletAnswer = w
          .request({
            type: "wallet_addInvokeTransaction",
            params: { calls: toWalletCalls(deployPlan.calls) },
          })
          .then((r) => ({
            from: "wallet" as const,
            txHash: (r as { transaction_hash?: string })?.transaction_hash ?? null,
          }));

        const chainAnswer = (async () => {
          for (let i = 0; i < 90; i++) {
            await new Promise((r) => setTimeout(r, 2000));
            try {
              const res = await fetch(
                `/api/launch/${jobId}/starknet?owner=${encodeURIComponent(address)}`,
              );
              if (res.ok) {
                const d = (await res.json()) as { deployed?: boolean };
                if (d.deployed) return { from: "chain" as const, txHash: null };
              }
            } catch {
              /* a failed read is not an answer — keep waiting */
            }
          }
          throw new Error("Starknet did not confirm the vault in time. It may still land.");
        })();

        // Whoever answers first ends the "waiting for your wallet" phase; a rejection surfaces
        // immediately rather than after the poll's full run.
        const first = await Promise.race([walletAnswer, chainAnswer]);
        setPhase({ kind: "working", step: "Vault funded · confirming on Starknet…" });

        // ATTACH ONLY ONCE THE CHAIN CONFIRMS. If the wallet won, the vault may not exist yet.
        const confirmed = first.from === "chain" ? first : await chainAnswer;
        const txHash = first.txHash ?? confirmed.txHash;
        await attach(deployPlan.vaultAddress, address, txHash);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setError(/rejected|denied|cancel/i.test(msg) ? "You cancelled the signature." : msg);
        setPhase({ kind: "review" });
      }
    },
    [deployPlan, address, attach, jobId],
  );

  if (phase.kind === "done") {
    return (
      <div className="lx-sn-done">
        <div className="lx-sn-done-h">
          <Check size={16} aria-hidden /> Your campaign is live
        </div>
        <p className="lx-sn-done-b">
          Sage will judge submissions and pay testers from your vault automatically. Testers can
          take their payout into a shielded note, so their earnings stay off a public graph.
        </p>
        <div className="lx-sn-rows">
          <Row k="Vault" v={short(deployPlan?.vaultAddress ?? "")} mono />
          {phase.txHash && <Row k="Funding transaction" v={short(phase.txHash)} mono />}
        </div>
        <a className="lx-btn" href={`/c/${phase.campaignId}`}>
          Open the campaign <ExternalLink size={14} aria-hidden />
        </a>
      </div>
    );
  }

  const total = deployPlan?.totalBase ?? String(plan.totalBudgetBase);

  return (
    <div className="lx-sn">
      <div className="lx-sn-head">
        <ShieldCheck size={16} aria-hidden />
        <div>
          <div className="lx-sn-title">You fund and own this vault</div>
          <div className="lx-sn-sub">
            Your wallet deploys it, funds it, and writes what each mission pays — in one signature.
            Sage gets a key that can release those exact rewards and nothing else. It cannot
            withdraw, and it cannot change a price.
          </div>
        </div>
      </div>

      <div className="lx-sn-rows">
        <Row k="You fund" v={usd(total)} />
        <Row k="Missions" v={`${deployPlan?.missions.length ?? plan.missions.length}`} />
        {deployPlan?.vaultAddress && <Row k="Your vault will be" v={short(deployPlan.vaultAddress)} mono />}
      </div>

      {deployPlan?.deployed && (
        <p className="lx-sn-note">
          You already funded this vault. Nothing more to pay — Sage just needs to check it and open
          the campaign.
        </p>
      )}

      {phase.kind === "working" ? (
        <div className="lx-sn-working">
          <Loader2 size={15} className="lx-spin" aria-hidden /> {phase.step}
        </div>
      ) : !address ? (
        <WalletConnect
          options={wallet.wallets.map((w) => ({
            id: w.id,
            name: w.name,
            icon: w.icon,
            onSelect: () => void wallet.connect(w),
          }))}
          explainer={
            <>
              Connect the wallet that will <b>own this vault</b> and fund it. Sage never holds it.
            </>
          }
          busy={wallet.connecting}
          busyLabel="Waiting for your wallet…"
          error={wallet.error}
          emptyMessage="No Starknet wallet found in this browser."
          installHints={[
            { name: "Ready", url: "https://www.ready.co" },
            { name: "Braavos", url: "https://braavos.app" },
          ]}
        />
      ) : (
        <button
          className="lx-btn"
          onClick={() => void signAndLaunch()}
          disabled={!deployPlan?.calls || wallet.connecting}
        >
          {deployPlan?.deployed
            ? "Open the campaign"
            : `Fund ${usd(total)} and go live`}
        </button>
      )}

      {(error || wallet.error) && (
        <div className="lx-err" role="alert" style={{ marginTop: 10 }}>
          {error ?? wallet.error}
        </div>
      )}
    </div>
  );
}

function Row({ k, v, mono }: { k: string; v: string; mono?: boolean }) {
  return (
    <div className="lx-sn-row">
      <span className="lx-sn-k">{k}</span>
      <span className={mono ? "lx-sn-v mono" : "lx-sn-v"}>{v}</span>
    </div>
  );
}

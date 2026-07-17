"use client";

import { useEffect, useRef, useState } from "react";
import {
  ArrowRight,
  Bot,
  Coins,
  Banknote,
  Gauge,
  Users,
  Lock,
  Check,
  LoaderCircle,
  Wallet as WalletIcon,
} from "lucide-react";
import type { Address } from "viem";
import { usd, short } from "@/lib/format";
import { TravelingRing, type RingState } from "./traveling-ring";
import { AppShell, type X402Status } from "./app-shell";
import { useWallet } from "@/lib/wallet/use-wallet";
import { createDeputyVault, type CreateStep } from "@/lib/wallet/create-vault";
import { readVaultState } from "@/lib/wallet/read-vault";
import type { VaultStateView, PayoutReceipt } from "@/lib/deputy/chain";
import type { DeputyOverview } from "@/lib/campaigns/overview";
import type { AgentIdentity } from "@/lib/erc8004/identity";
import type { AgentReputation } from "@/lib/erc8004/reputation-core";
import type { PnLView } from "@/components/agents/pnl-panel";

interface Props {
  vault: VaultStateView | null;
  vendors: string[];
  overview: DeputyOverview;
  identity: AgentIdentity;
  reputation: AgentReputation;
  pnl: PnLView;
  history: PayoutReceipt[];
  network: { name: string; chainId: number; explorer: string };
  vaultAddress: string | null;
  usdcAddress: string | null;
  x402: X402Status;
}

/** The four provisioning steps shown during boot, in real execution order. */
const BOOT_STEPS: { key: CreateStep; label: string }[] = [
  { key: "mint", label: "Mint test USDC" },
  { key: "create", label: "Deploy Policy Vault" },
  { key: "fund", label: "Fund the wallet" },
  { key: "activate", label: "Activate Sage" },
];
// Where each createStep sits in the linear order (approve folds under "create").
const STEP_ORDER: Record<string, number> = {
  mint: 0,
  create: 1,
  approve: 1,
  fund: 2,
  activate: 3,
  done: 4,
};

/**
 * The boot's provisioning rail — four mono lines bound to the REAL createDeputyVault
 * steps. A line lights the instant its on-chain step confirms, showing the truncated
 * tx hash (a real explorer link). Nothing here is a timer: state comes only from the
 * live `createStep` + the confirmed hashes surfaced by create-vault.
 */
function ProvisionSteps({
  step,
  hashes,
  explorer,
}: {
  step: CreateStep | null;
  hashes: Partial<Record<CreateStep, string>>;
  explorer: string;
}) {
  const order = step ? (STEP_ORDER[step] ?? -1) : -1;
  return (
    <div className="sage-boot-steps">
      {BOOT_STEPS.map((s, i) => {
        const confirmed = !!hashes[s.key];
        const done = order > i || confirmed;
        const active = !done && order === i;
        const state = done ? "done" : active ? "active" : "pending";
        const hash = hashes[s.key];
        return (
          <div key={s.key} className={`sage-boot-step ${state}`}>
            <span className="sage-boot-step-ico">
              {done ? (
                <Check size={12} strokeWidth={3} />
              ) : active ? (
                <LoaderCircle size={12} className="sage-spin2" />
              ) : (
                <span className="sage-boot-dot" />
              )}
            </span>
            <span className="sage-boot-step-label">{s.label}</span>
            {hash ? (
              <a
                className="sage-boot-step-tx mono"
                href={`${explorer}/tx/${hash}`}
                target="_blank"
                rel="noopener noreferrer"
              >
                {short(hash)}
              </a>
            ) : done ? (
              <span className="sage-boot-step-tx mono muted">ready</span>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

/**
 * The whole experience as one surface: a cinematic onboarding whose single ring
 * never unmounts — it's born on Fund, recedes on Meet, previews the Policy, takes
 * center stage on Confirm's hold-to-seal, flies through the boot, and hands off to
 * the live app. Landing → onboarding → app is one continuous object.
 */
export function SageApp(props: Props) {
  const { vault } = props;
  const remaining = vault?.remaining ?? vault?.budget ?? 500;

  // The mandate the founder sets during onboarding — editable in step 3. Seeded
  // from the live vault's values; these are what a real createVault would use.
  const [budget, setBudget] = useState(vault?.budget ?? 500);
  const [perPayout, setPerPayout] = useState(vault?.perTxCap ?? 25);
  const [velocity, setVelocity] = useState(vault?.velocityCap ?? 100);

  const rootRef = useRef<HTMLDivElement>(null);
  const ringRef = useRef<RingState>({
    mode: "ready",
    budget,
    fundFrac: 0,
    holdProg: 0,
    remaining,
  });
  const holdRaf = useRef(0);
  // the currently-mounted hold button + its rubber-band cleanup timer (item 7:
  // the conic fill ring). Both hold buttons are mutually exclusive, so one ref
  // always points at the live one.
  const holdBtnRef = useRef<HTMLButtonElement>(null);
  const holdReleaseTimer = useRef<number | undefined>(undefined);

  // the ring preview follows the chosen budget live
  useEffect(() => {
    ringRef.current.budget = budget;
  }, [budget]);

  const wallet = useWallet();
  const [phase, setPhase] = useState<"onboarding" | "booting" | "app">(
    "onboarding",
  );
  // set only on a FRESH create (not on a returning-founder restore), so we land
  // them in a pre-filled first campaign instead of the empty Agents tab.
  const [justOnboarded, setJustOnboarded] = useState(false);
  const [step, setStep] = useState(0);
  const [locked, setLocked] = useState(false);
  const [createStep, setCreateStep] = useState<CreateStep | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);
  const [founderVault, setFounderVault] = useState<VaultStateView | null>(null);
  // real confirmed tx hashes per createStep — surfaced by create-vault's onStep.
  const [stepHashes, setStepHashes] = useState<
    Partial<Record<CreateStep, string>>
  >({});

  // Returning founder: if a vault was created in a prior session, restore it and
  // land straight in the app shell (the campaign command center) instead of
  // replaying onboarding. The app is the product — don't gate it behind setup twice.
  useEffect(() => {
    let stored: string | null = null;
    try {
      stored = window.localStorage.getItem("sage_vault");
    } catch {
      /* localStorage unavailable */
    }
    if (!stored) return;
    let cancelled = false;
    void readVaultState(stored as Address).then((live) => {
      if (cancelled || !live) return;
      setFounderVault(live);
      setPhase("app");
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const slotKey =
    phase === "booting"
      ? "boot"
      : phase === "app"
        ? null
        : step === 1
          ? "fund"
          : step === 2
            ? "create"
            : step === 3
              ? "policy"
              : step === 4
                ? "confirm"
                : null;

  // keep the ring's mode aligned to the current step
  useEffect(() => {
    if (phase !== "onboarding") return;
    const r = ringRef.current;
    if (step >= 1 && step <= 4 && !locked) {
      r.mode = "ready";
      r.fundFrac = 1;
    }
  }, [step, phase, locked]);

  // boot → app handoff. The real work is already done (createReal ran every
  // on-chain step); this is only the "Ready" beat + the ring's travel into the
  // shell — a presentational transition, not fabricated progress. Reduced-motion
  // hands off immediately.
  useEffect(() => {
    if (phase !== "booting") return;
    ringRef.current.mode = "sealed";
    const reduce = window.matchMedia?.(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    const to = window.setTimeout(
      () => {
        ringRef.current.mode = "live";
        setPhase("app");
      },
      reduce ? 0 : 1150,
    );
    return () => window.clearTimeout(to);
  }, [phase]);

  const next = () => setStep((s) => Math.min(4, s + 1));
  const back = () => setStep((s) => Math.max(0, s - 1));

  function holdStart() {
    if (locked) return;
    ringRef.current.mode = "sealing";
    // cancel any in-flight rubber-band so the fill tracks the finger cleanly
    const btn = holdBtnRef.current;
    if (holdReleaseTimer.current) window.clearTimeout(holdReleaseTimer.current);
    btn?.classList.remove("releasing");
    const start = performance.now();
    const dur = 1500;
    const tick = (now: number) => {
      const p = Math.min(1, (now - start) / dur);
      ringRef.current.holdProg = p;
      holdBtnRef.current?.style.setProperty("--hold", String(p));
      if (p < 1) holdRaf.current = requestAnimationFrame(tick);
      else void createReal();
    };
    holdRaf.current = requestAnimationFrame(tick);
  }

  function holdEnd() {
    if (locked || createStep) return;
    cancelAnimationFrame(holdRaf.current);
    if (ringRef.current.holdProg < 1) {
      ringRef.current.holdProg = 0;
      ringRef.current.mode = "ready";
      // rubber-band the conic fill back to empty (bouncy ease from motion.css)
      const btn = holdBtnRef.current;
      if (btn) {
        btn.classList.add("releasing");
        btn.style.setProperty("--hold", "0");
        holdReleaseTimer.current = window.setTimeout(
          () => btn.classList.remove("releasing"),
          460,
        );
      }
    }
  }

  // The real founder-signed creation: mint → createVault → approve → fund →
  // activate, each signed in the wallet, then read back the founder's own vault.
  async function createReal() {
    if (locked) return;
    setLocked(true);
    setCreateError(null);
    setStepHashes({});
    ringRef.current.mode = "sealing";
    ringRef.current.holdProg = 1;
    const client = wallet.getWalletClient();
    if (!client || !wallet.address) {
      setCreateError("Connect your wallet on Metis Sepolia first.");
      setLocked(false);
      ringRef.current.mode = "ready";
      ringRef.current.holdProg = 0;
      return;
    }
    try {
      const { vault } = await createDeputyVault({
        wallet: client,
        founder: wallet.address,
        budget,
        perPayout,
        velocity,
        onStep: (s, hash) => {
          setCreateStep(s);
          if (hash) setStepHashes((prev) => ({ ...prev, [s]: hash }));
        },
      });
      try {
        window.localStorage.setItem("sage_vault", vault);
      } catch {}
      const live = await readVaultState(vault as Address);
      if (live) setFounderVault(live);
      setJustOnboarded(true);
      ringRef.current.mode = "sealed";
      setPhase("booting");
    } catch (err) {
      setCreateError(
        err instanceof Error ? err.message.slice(0, 160) : "Wallet creation failed.",
      );
      setLocked(false);
      setCreateStep(null);
      ringRef.current.mode = "ready";
      ringRef.current.holdProg = 0;
    }
  }

  if (phase === "app") {
    const v = founderVault ?? props.vault;
    return (
      <AppShell
        {...props}
        vault={v}
        ownVault={founderVault !== null}
        vaultAddress={founderVault ? founderVault.address : props.vaultAddress}
        history={founderVault ? [] : props.history}
        startInCreate={justOnboarded}
      />
    );
  }

  return (
    <div ref={rootRef} className="sage-onb-root">
      <TravelingRing slotKey={slotKey} ringRef={ringRef} rootRef={rootRef} />

      {phase === "onboarding" && step > 0 && (
        <div className="sage-onb-progress">
          <div className="sage-onb-bar">
            <span style={{ width: `${(step / 4) * 100}%` }} />
          </div>
          <div className="sage-onb-prow">
            <button className="sage-onb-back" onClick={back}>
              <span className="sage-onb-mark">
                <span className="ring" />
              </span>
              Sage
            </button>
            <span className="sage-onb-steplabel mono">Step {step} of 4</span>
          </div>
        </div>
      )}

      {phase === "onboarding" && (
        <div className="sage-onb-stage">
          <div className="sage-onb-screen" key={step}>
            {step === 0 && (
              <div className="sage-onb-welcome">
                <div className="sage-onb-hero">
                  <span className="halo" />
                  <span className="halo d" />
                  <span className="mark">
                    <span className="ring" />
                  </span>
                </div>
                <div className="sage-onb-eyebrow">Sage</div>
                <h1 className="sage-onb-h1">
                  Sage verifies the work, reasons about it, and pays real
                  people in USDC. It spends only inside an allowance you set once.
                </h1>
                <p className="sage-onb-sub">
                  Hire an autonomous worker that pays for real completed work on its
                  own — and physically can&apos;t move a dollar past your limits, even
                  if it&apos;s wrong.
                </p>
                {!wallet.address ? (
                  <button
                    className="sage-onb-cta"
                    onClick={wallet.connect}
                    disabled={wallet.connecting}
                  >
                    <WalletIcon size={16} />
                    {wallet.connecting
                      ? "Connecting…"
                      : wallet.available
                        ? "Connect wallet"
                        : "Install a wallet"}
                  </button>
                ) : !wallet.onMetis ? (
                  <button className="sage-onb-cta" onClick={wallet.switchToMetis}>
                    Switch to Metis Sepolia
                  </button>
                ) : (
                  <button className="sage-onb-cta" onClick={next}>
                    Get started <ArrowRight size={16} strokeWidth={2.4} />
                  </button>
                )}
                <div className="sage-onb-connect">
                  {wallet.address ? (
                    <span className="sage-onb-connected">
                      <span className="dot" /> {short(wallet.address)} · Metis
                      Sepolia
                    </span>
                  ) : (
                    <span>Connect to own your wallet · Metis Sepolia</span>
                  )}
                </div>
                <div className="sage-onb-fine">
                  Takes about a minute · Configure the mandate once
                </div>
              </div>
            )}

            {step === 1 && (
              <div className="sage-onb-center">
                <div className="sage-onb-eyebrow tight">Your wallet</div>
                <h2 className="sage-onb-h2">
                  A wallet holds real USDC — Sage spends only from it, only
                  inside the limits you set. On-chain, it&apos;s the Policy Vault.
                </h2>
                <div
                  data-slot="fund"
                  className="sage-onb-slot"
                  style={{ width: 236, height: 236, margin: "30px 0 8px" }}
                />
                <div className="sage-onb-pill">
                  <Check size={14} strokeWidth={2.2} className="pos" /> USDC ·{" "}
                  {props.network.name}
                </div>
                <button
                  className="sage-onb-cta"
                  onClick={next}
                  style={{ marginTop: 30 }}
                >
                  Continue <ArrowRight size={16} strokeWidth={2.4} />
                </button>
                <div className="sage-onb-fine">
                  You&apos;ll mint test USDC and fund this for real when you seal —
                  every step signed by you.
                </div>
              </div>
            )}

            {step === 2 && (
              <div className="sage-onb-center">
                <div className="sage-onb-eyebrow tight">Meet your Deputy</div>
                <div data-slot="create" className="sage-onb-slot" style={{ width: 132, height: 132, margin: "26px 0 22px" }} />
                <div className="sage-onb-card">
                  <div className="sage-onb-card-top">
                    <span className="sage-onb-card-ico">
                      <Bot size={23} strokeWidth={1.9} />
                    </span>
                    <div>
                      <div className="sage-onb-card-name">Payout Deputy</div>
                      <div className="sage-onb-card-sub mono">agent · reward campaigns</div>
                    </div>
                  </div>
                  <p className="sage-onb-card-p">
                    Runs your reward campaigns end to end — it watches for submitted
                    work, waits for your approval, then pays the tester or contributor
                    in USDC. It decides <em>who</em> and <em>when</em>. The wallet
                    decides <em>how much</em> is even possible.
                  </p>
                  <div className="sage-onb-card-foot">
                    <div>
                      <div className="k">Mission</div>
                      <div className="v">Reward payouts</div>
                    </div>
                    <span className="div" />
                    <div>
                      <div className="k">Funds from</div>
                      <div className="v mono">{usd(budget)} wallet</div>
                    </div>
                  </div>
                </div>
                <button className="sage-onb-cta" onClick={next} style={{ marginTop: 28 }}>
                  Set its limits <ArrowRight size={16} strokeWidth={2.4} />
                </button>
              </div>
            )}

            {step === 3 && (
              <div className="sage-onb-policy">
                <div className="sage-onb-policy-head">
                  <div className="sage-onb-eyebrow tight">The leash</div>
                  <h2 className="sage-onb-h2 sm">
                    These are the boundaries the contract enforces.
                  </h2>
                  <p className="sage-onb-sub sm">
                    Smart defaults are already set. Tune a lever only if you want to —
                    then confirm.
                  </p>
                </div>
                <div className="sage-onb-policy-grid">
                  <div className="sage-onb-slot-wrap">
                    <div data-slot="policy" className="sage-onb-slot" style={{ width: 250, height: 250 }} />
                  </div>
                  <div className="sage-onb-levers">
                    <div className="sage-onb-lever">
                      <span className="sage-onb-lever-ico">
                        <Coins size={17} />
                      </span>
                      <div className="sage-onb-lever-main">
                        <div className="l">Budget ceiling</div>
                        <div className="h">total budget · you fund this</div>
                      </div>
                      <div className="sage-onb-step">
                        <button
                          onClick={() => setBudget((b) => Math.max(100, b - 100))}
                          aria-label="lower budget"
                        >
                          −
                        </button>
                        <span className="mono">{usd(budget)}</span>
                        <button
                          onClick={() => setBudget((b) => Math.min(5000, b + 100))}
                          aria-label="raise budget"
                        >
                          +
                        </button>
                      </div>
                    </div>

                    <div className="sage-onb-lever">
                      <span className="sage-onb-lever-ico">
                        <Banknote size={17} />
                      </span>
                      <div className="sage-onb-lever-main">
                        <div className="l">Per-payout limit</div>
                        <div className="h">max per single reward</div>
                      </div>
                      <div className="sage-onb-step">
                        <button
                          onClick={() => setPerPayout((v) => Math.max(5, v - 5))}
                          aria-label="lower per-payout limit"
                        >
                          −
                        </button>
                        <span className="mono">{usd(perPayout)}</span>
                        <button
                          onClick={() =>
                            setPerPayout((v) => Math.min(budget, v + 5))
                          }
                          aria-label="raise per-payout limit"
                        >
                          +
                        </button>
                      </div>
                    </div>

                    <div className="sage-onb-lever">
                      <span className="sage-onb-lever-ico">
                        <Gauge size={17} />
                      </span>
                      <div className="sage-onb-lever-main">
                        <div className="l">Daily limit</div>
                        <div className="h">max spend per rolling day</div>
                      </div>
                      <div className="sage-onb-step">
                        <button
                          onClick={() => setVelocity((v) => Math.max(25, v - 25))}
                          aria-label="lower daily limit"
                        >
                          −
                        </button>
                        <span className="mono">{usd(velocity)}</span>
                        <button
                          onClick={() =>
                            setVelocity((v) => Math.min(budget, v + 25))
                          }
                          aria-label="raise daily limit"
                        >
                          +
                        </button>
                      </div>
                    </div>

                    <div className="sage-onb-lever">
                      <span className="sage-onb-lever-ico">
                        <Users size={17} />
                      </span>
                      <div className="sage-onb-lever-main">
                        <div className="l">Approved recipients</div>
                        <div className="h">only these can be paid</div>
                      </div>
                      <span className="sage-onb-lever-v mono">
                        {props.vendors.length || 5}
                      </span>
                    </div>
                  </div>
                </div>
                <button className="sage-onb-cta" onClick={next} style={{ marginTop: 30 }}>
                  Review &amp; confirm <ArrowRight size={16} strokeWidth={2.4} />
                </button>
              </div>
            )}

            {step === 4 && (
              <div className="sage-onb-center">
                <div
                  className="sage-onb-eyebrow tight"
                  style={{ color: locked ? "#4f46e5" : undefined }}
                >
                  {locked ? "Creating on-chain" : "The moment of trust"}
                </div>
                <div data-slot="confirm" className="sage-onb-slot" style={{ width: 280, height: 280, margin: "22px 0 6px" }} />
                <div className="sage-onb-sealrow">
                  {["Budget", "Per-payout", "Daily limit", "Recipients"].map((l) => (
                    <span className={`sage-onb-sealpill${locked ? " on" : ""}`} key={l}>
                      <Lock size={11} /> {l}
                    </span>
                  ))}
                </div>
                {locked ? (
                  <div className="sage-onb-creating">
                    <ProvisionSteps
                      step={createStep}
                      hashes={stepHashes}
                      explorer={props.network.explorer}
                    />
                    <div className="sage-onb-creating-hint">
                      Confirm each transaction in your wallet.
                    </div>
                  </div>
                ) : createError ? (
                  <>
                    <div className="sage-onb-createerr">{createError}</div>
                    <button
                      ref={holdBtnRef}
                      className="sage-onb-hold"
                      onPointerDown={holdStart}
                      onPointerUp={holdEnd}
                      onPointerLeave={holdEnd}
                      onPointerCancel={holdEnd}
                    >
                      <Lock size={17} /> Hold to try again
                    </button>
                  </>
                ) : (
                  <>
                    <h2 className="sage-onb-h2 sm" style={{ marginTop: 20 }}>
                      Hold to create &amp; fund your wallet.
                    </h2>
                    <p className="sage-onb-sub sm">
                      This mints test USDC, deploys your wallet (the Policy Vault),
                      funds it, and activates it — every step signed by you.
                    </p>
                    <button
                      ref={holdBtnRef}
                      className="sage-onb-hold"
                      onPointerDown={holdStart}
                      onPointerUp={holdEnd}
                      onPointerLeave={holdEnd}
                      onPointerCancel={holdEnd}
                    >
                      <Lock size={17} /> Hold to create
                    </button>
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {phase === "booting" && (
        <div className="sage-onb-boot">
          <div data-slot="boot" className="sage-onb-slot" style={{ width: 196, height: 196 }} />
          <div className="sage-onb-boot-txt">
            <div className="t">Your control layer is live</div>
            <ProvisionSteps
              step="done"
              hashes={stepHashes}
              explorer={props.network.explorer}
            />
          </div>
        </div>
      )}
    </div>
  );
}

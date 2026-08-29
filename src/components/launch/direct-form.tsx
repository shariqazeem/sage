"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { useSiwe } from "@/lib/auth/use-siwe";
import { useFounderSession } from "@/lib/auth/use-founder-session";
import { FounderSignIn } from "@/components/wallet/founder-sign-in";
import "@/styles/wallet-connect.css";
import { evmChains } from "@/lib/deputy/networks";
import { rememberInspection } from "@/lib/launch/recent-inspections";

/**
 * WORK PROOF — the direct campaign front door (docs/work-proof-design.md §E).
 *
 * The operator states the work: milestones (grant) or deliverables (gig), each with an EXPLICIT
 * verification contract and its own tranche price. Nothing here is a model input — the server
 * compiles it deterministically and lands the operator on the same claim → deploy → fund wizard
 * every campaign uses. The form offers the three contract kinds a person can state without
 * writing hex calldata (`onchain_state` exists in the API for power users).
 */

type EvidenceKind = "onchain_tx" | "artifact_url" | "public_url";

interface MilestoneDraft {
  title: string;
  instructions: string;
  criteria: string; // one per line
  kind: EvidenceKind;
  txChainId: number;
  txTo: string;
  txSelector: string;
  txMinValueWei: string;
  artifactHosts: string; // comma/space separated bare hostnames
  publicExpected: string; // one per line
  rewardUsd: string;
  slots: string;
  effortMinutes: string;
}

const GOAT_CHAIN_ID = 2345;

function blankMilestone(): MilestoneDraft {
  return {
    title: "",
    instructions: "",
    criteria: "",
    kind: "artifact_url",
    txChainId: GOAT_CHAIN_ID,
    txTo: "",
    txSelector: "",
    txMinValueWei: "",
    artifactHosts: "",
    publicExpected: "",
    rewardUsd: "2",
    slots: "1",
    effortMinutes: "15",
  };
}

const KIND_COPY: Record<EvidenceKind, { label: string; hint: string }> = {
  artifact_url: {
    label: "A public link to something they created",
    hint: "Sage fetches the link itself: it must be on your allowed host and visibly carry the recipient's own wallet address — a generic or copied page can't pass.",
  },
  onchain_tx: {
    label: "An on-chain transaction they performed",
    hint: "The recipient submits their transaction hash. Sage reads it from the chain directly: sent from their own wallet, matching the constraints you set below.",
  },
  public_url: {
    label: "A public page showing a required result",
    hint: "Sage fetches the page and checks your exact required text appears on it, verbatim.",
  },
};

function splitLines(s: string): string[] {
  return s.split("\n").map((x) => x.trim()).filter(Boolean);
}

function buildEvidence(m: MilestoneDraft): Record<string, unknown> {
  switch (m.kind) {
    case "onchain_tx": {
      const c: Record<string, unknown> = { kind: "onchain_tx", chainId: m.txChainId };
      if (m.txTo.trim()) c.to = m.txTo.trim();
      if (m.txSelector.trim()) c.methodSelector = m.txSelector.trim();
      if (m.txMinValueWei.trim()) c.minValueWei = m.txMinValueWei.trim();
      return c;
    }
    case "artifact_url":
      return {
        kind: "artifact_url",
        allowedHosts: m.artifactHosts.split(/[\s,]+/).map((h) => h.trim().toLowerCase()).filter(Boolean),
        markerKind: "wallet",
      };
    case "public_url":
      return { kind: "public_url", expectedText: splitLines(m.publicExpected) };
  }
}

export function DirectCampaignForm() {
  const router = useRouter();
  const siwe = useSiwe();
  const founder = useFounderSession();
  const [showSignIn, setShowSignIn] = useState(false);

  const [kind, setKind] = useState<"grant" | "gig">("grant");
  const [title, setTitle] = useState("");
  const [productUrl, setProductUrl] = useState("");
  const [whyItMatters, setWhyItMatters] = useState("");
  const [milestones, setMilestones] = useState<MilestoneDraft[]>([blankMilestone()]);
  const [allowlist, setAllowlist] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const noun = kind === "grant" ? "milestone" : "deliverable";
  const Noun = kind === "grant" ? "Milestone" : "Deliverable";

  const setMs = (i: number, patch: Partial<MilestoneDraft>) =>
    setMilestones((list) => list.map((m, j) => (j === i ? { ...m, ...patch } : m)));

  const totalUsd = useMemo(
    () =>
      milestones.reduce((s, m) => {
        const r = Number(m.rewardUsd);
        const n = Number(m.slots);
        return Number.isFinite(r) && Number.isFinite(n) ? s + r * n : s;
      }, 0),
    [milestones],
  );

  const submit = async () => {
    // Either chain. This used to fire MetaMask directly, so a founder holding only a Starknet
    // wallet could not create a campaign that would have settled on Starknet.
    if (!founder.authed) {
      setError(null);
      setShowSignIn(true);
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      const wallets = allowlist.split(/[\s,]+/).map((w) => w.trim()).filter(Boolean);
      const res = await fetch("/api/campaigns/direct", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          kind,
          title: title.trim(),
          productUrl: productUrl.trim(),
          ...(whyItMatters.trim() ? { whyItMatters: whyItMatters.trim() } : {}),
          milestones: milestones.map((m) => ({
            title: m.title.trim(),
            instructions: m.instructions.trim(),
            criteria: splitLines(m.criteria),
            evidence: buildEvidence(m),
            rewardUsd: Number(m.rewardUsd),
            slots: Number(m.slots),
            ...(Number(m.effortMinutes) > 0 ? { effortMinutes: Number(m.effortMinutes) } : {}),
          })),
          ...(wallets.length > 0 ? { allowlist: wallets } : {}),
        }),
      });
      const data = await res.json();
      if (!data.ok) {
        setError(data.error ?? "Something went wrong.");
        setSubmitting(false);
        return;
      }
      rememberInspection(data.jobId, productUrl.trim());
      router.push(data.planUrl as string);
    } catch {
      setError("Could not reach Sage. Please try again.");
      setSubmitting(false);
    }
  };

  return (
    <div>
      <section className="lx-card pad-lg" aria-label="Campaign">
        <div className="lx-field">
          <label className="lx-label">What is this campaign?</label>
          <div className="lx-seg" role="group" aria-label="Campaign kind">
            <button type="button" className={kind === "grant" ? "on" : ""} onClick={() => setKind("grant")}>
              Milestone grant
            </button>
            <button type="button" className={kind === "gig" ? "on" : ""} onClick={() => setKind("gig")}>
              Gig payouts
            </button>
          </div>
          <p className="lx-hint">
            {kind === "grant"
              ? "Fund a recipient (or several) in tranches — each tranche releases only when its milestone is verified."
              : "Pay people for finished deliverables — each one verified before it pays."}
          </p>
        </div>

        <div className="lx-field">
          <label className="lx-label" htmlFor="dx-title">Campaign title</label>
          <input id="dx-title" className="lx-input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder={kind === "grant" ? "Community storefront micro-grant" : "Landing page build — gig"} />
        </div>

        <div className="lx-field">
          <label className="lx-label" htmlFor="dx-url">Context URL</label>
          <input id="dx-url" className="lx-input" value={productUrl} onChange={(e) => setProductUrl(e.target.value)} placeholder="https://your-program-or-product.org" inputMode="url" />
          <p className="lx-hint">The program or product this work is for — shown to recipients as the target surface.</p>
        </div>

        <div className="lx-field" style={{ marginBottom: 0 }}>
          <label className="lx-label" htmlFor="dx-why">Why it matters <span style={{ color: "var(--lx-muted)", fontWeight: 400 }}>(optional)</span></label>
          <textarea id="dx-why" className="lx-textarea" value={whyItMatters} onChange={(e) => setWhyItMatters(e.target.value)} placeholder="One or two sentences recipients see on every card." />
        </div>
      </section>

      {milestones.map((m, i) => (
        <section className="lx-card pad-lg" key={i} aria-label={`${Noun} ${i + 1}`}>
          <div className="lx-ms-head">
            <div className="lx-kicker">{Noun} {i + 1}</div>
            {milestones.length > 1 && (
              <button type="button" className="lx-ms-remove" onClick={() => setMilestones((l) => l.filter((_, j) => j !== i))}>
                Remove
              </button>
            )}
          </div>

          <div className="lx-field">
            <label className="lx-label">Title</label>
            <input className="lx-input" value={m.title} onChange={(e) => setMs(i, { title: e.target.value })} placeholder={kind === "grant" ? "Register the storefront on-chain" : "Deliver the landing page"} />
          </div>

          <div className="lx-field">
            <label className="lx-label">Instructions for the recipient</label>
            <textarea className="lx-textarea" value={m.instructions} onChange={(e) => setMs(i, { instructions: e.target.value })} placeholder="Step by step: what they do, and exactly what to submit." />
          </div>

          <div className="lx-field">
            <label className="lx-label">Acceptance criteria <span style={{ color: "var(--lx-muted)", fontWeight: 400 }}>(one per line)</span></label>
            <textarea className="lx-textarea" value={m.criteria} onChange={(e) => setMs(i, { criteria: e.target.value })} placeholder={"The page is publicly reachable\nIt carries the recipient's wallet address"} />
          </div>

          <div className="lx-field">
            <label className="lx-label">How Sage verifies it</label>
            <select className="lx-input" value={m.kind} onChange={(e) => setMs(i, { kind: e.target.value as EvidenceKind })}>
              {(Object.keys(KIND_COPY) as EvidenceKind[]).map((k) => (
                <option key={k} value={k}>{KIND_COPY[k].label}</option>
              ))}
            </select>
            <p className="lx-hint">{KIND_COPY[m.kind].hint}</p>
          </div>

          {m.kind === "onchain_tx" && (
            <>
              <div className="lx-row">
                <div className="lx-field">
                  <label className="lx-label">Chain</label>
                  <select className="lx-input" value={m.txChainId} onChange={(e) => setMs(i, { txChainId: Number(e.target.value) })}>
                    {/* EVM only: this picks the chain a tester's transaction must be on, and that
                        verification reads EVM logs. Starknet is in the registry for truthful
                        amounts and explorer links, not as a verification target. */}
                    {evmChains().map((c) => (
                      <option key={c.chainId} value={c.chainId}>{c.name}</option>
                    ))}
                  </select>
                </div>
                <div className="lx-field">
                  <label className="lx-label">Must interact with <span style={{ color: "var(--lx-muted)", fontWeight: 400 }}>(address, optional)</span></label>
                  <input className="lx-input" value={m.txTo} onChange={(e) => setMs(i, { txTo: e.target.value })} placeholder="0x…" spellCheck={false} />
                </div>
              </div>
              <div className="lx-row">
                <div className="lx-field">
                  <label className="lx-label">Method selector <span style={{ color: "var(--lx-muted)", fontWeight: 400 }}>(optional)</span></label>
                  <input className="lx-input" value={m.txSelector} onChange={(e) => setMs(i, { txSelector: e.target.value })} placeholder="0xa9059cbb" spellCheck={false} />
                </div>
                <div className="lx-field">
                  <label className="lx-label">Min native value, wei <span style={{ color: "var(--lx-muted)", fontWeight: 400 }}>(optional)</span></label>
                  <input className="lx-input" value={m.txMinValueWei} onChange={(e) => setMs(i, { txMinValueWei: e.target.value })} placeholder="0" inputMode="numeric" spellCheck={false} />
                </div>
              </div>
              <p className="lx-hint" style={{ marginTop: -8, marginBottom: 14 }}>Set at least one constraint — a contract with none would accept any transaction they ever sent.</p>
            </>
          )}

          {m.kind === "artifact_url" && (
            <div className="lx-field">
              <label className="lx-label">Allowed host(s)</label>
              <input className="lx-input" value={m.artifactHosts} onChange={(e) => setMs(i, { artifactHosts: e.target.value })} placeholder="app.example.org, example.org" spellCheck={false} />
              <p className="lx-hint">Bare hostnames, comma-separated. The artifact must live there and visibly contain the recipient&rsquo;s wallet address.</p>
            </div>
          )}

          {m.kind === "public_url" && (
            <div className="lx-field">
              <label className="lx-label">Required text on the page <span style={{ color: "var(--lx-muted)", fontWeight: 400 }}>(one per line, verbatim)</span></label>
              <textarea className="lx-textarea" value={m.publicExpected} onChange={(e) => setMs(i, { publicExpected: e.target.value })} placeholder="Deployment complete" />
            </div>
          )}

          <div className="lx-row-3">
            <div className="lx-field" style={{ margin: 0 }}>
              <label className="lx-label">Pay per completion (USDC)</label>
              <input className="lx-input" type="number" min="0.5" step="0.5" value={m.rewardUsd} onChange={(e) => setMs(i, { rewardUsd: e.target.value })} />
            </div>
            <div className="lx-field" style={{ margin: 0 }}>
              <label className="lx-label">Slots</label>
              <input className="lx-input" type="number" min="1" max="50" step="1" value={m.slots} onChange={(e) => setMs(i, { slots: e.target.value })} />
            </div>
            <div className="lx-field" style={{ margin: 0 }}>
              <label className="lx-label">Est. effort (min)</label>
              <input className="lx-input" type="number" min="1" max="240" step="1" value={m.effortMinutes} onChange={(e) => setMs(i, { effortMinutes: e.target.value })} />
            </div>
          </div>
        </section>
      ))}

      <button type="button" className="lx-add-ms" onClick={() => setMilestones((l) => [...l, blankMilestone()])} disabled={milestones.length >= 12}>
        + Add another {noun}
      </button>

      <section className="lx-card pad-lg" aria-label="Recipients and total">
        <div className="lx-field">
          <label className="lx-label" htmlFor="dx-allow">Named recipients <span style={{ color: "var(--lx-muted)", fontWeight: 400 }}>(optional — wallet addresses, one per line)</span></label>
          <textarea id="dx-allow" className="lx-textarea" value={allowlist} onChange={(e) => setAllowlist(e.target.value)} placeholder="0x…" spellCheck={false} />
          <p className="lx-hint">
            Leave empty and anyone can complete the work (it lists on the public marketplace). Name wallets and ONLY they
            can submit — the campaign stays off the public board.
          </p>
        </div>

        <div className="lx-total">
          <span className="lx-total-k">Total budget (derived, exact)</span>
          <span className="lx-total-v">${totalUsd.toFixed(2)}</span>
        </div>
        <p className="lx-hint">
          Σ of every {noun}&rsquo;s pay × slots — you fund exactly this in the next step. The vault enforces each amount;
          a {noun} pays only when its proof verifies, and a failed check refuses with the written reason.
        </p>

        <button className="lx-btn" style={{ marginTop: 14 }} onClick={submit} disabled={submitting}>
          {submitting ? "Compiling…" : siwe.authed ? "Review the plan" : "Connect & review the plan"}
        </button>
        {showSignIn && !founder.authed && (
          <div style={{ marginTop: 12 }}>
            <FounderSignIn
              explainer={<>Sign in to create this campaign — <b>Ethereum or Starknet.</b> Nothing is funded here.</>}
              onSignedIn={() => {
                setShowSignIn(false);
                void founder.refresh();
              }}
            />
          </div>
        )}
        {error && <div className="lx-err" role="alert">{error}</div>}
      </section>
    </div>
  );
}

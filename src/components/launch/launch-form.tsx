"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Plus } from "lucide-react";

/**
 * Step 1 — describe the launch as a GUIDED, cinematic sequence, kept deliberately short (P26): the
 * product + what to learn on one screen, then the budget. The optional GitHub repo hides behind an
 * "add repo" affordance so it never taxes the common path. On the final step it creates (or reuses) a
 * DURABLE inspection job and navigates to /launch/[inspectionId]; the id lives in the URL so refresh /
 * back-forward / reopen all resume the same state.
 */
const STEPS = [
  {
    q: "What should Sage test, and what do you want to learn?",
    hint: "A public page Sage can open — it only reads your product, never signs in, buys, or changes anything. Then say what you want to learn; Sage designs the missions around exactly that.",
  },
  {
    q: "Set the testing budget.",
    hint: "Sage allocates it precisely across the missions it designs. You fund it in the next step — nothing moves yet.",
  },
] as const;

function isHttpUrl(u: string): boolean {
  try {
    const x = new URL(u.trim());
    return x.protocol === "https:" || x.protocol === "http:";
  } catch {
    return false;
  }
}

export function LaunchForm() {
  const router = useRouter();
  const [step, setStep] = useState(0);
  // targetUsers is kept in state (the API still accepts it) but no longer asked — the goal carries intent.
  const [form, setForm] = useState({ productUrl: "", repoUrl: "", goal: "", targetUsers: "", budgetUsd: "5" });
  const [showRepo, setShowRepo] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const set = (k: keyof typeof form, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const stepValid = (i = step): boolean => {
    if (i === 0) return isHttpUrl(form.productUrl) && form.goal.trim().length > 3;
    return Number(form.budgetUsd) >= 0.5;
  };

  const back = () => {
    setError(null);
    setStep((s) => Math.max(0, s - 1));
  };
  const next = () => {
    setError(null);
    if (stepValid()) setStep((s) => Math.min(STEPS.length - 1, s + 1));
  };

  const submit = async () => {
    if (!stepValid()) return;
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch("/api/launch", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!data.ok) {
        setError(data.error ?? "Something went wrong.");
        setSubmitting(false);
        return;
      }
      router.push(`/launch/${data.job.id}`);
    } catch {
      setError("Could not reach Sage. Please try again.");
      setSubmitting(false);
    }
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== "Enter") return;
    if ((e.target as HTMLElement).tagName === "TEXTAREA" && !e.metaKey) return;
    e.preventDefault();
    if (step < STEPS.length - 1) next();
    else void submit();
  };

  const s = STEPS[step];
  const last = step === STEPS.length - 1;

  return (
    <div className="lxo" onKeyDown={onKeyDown}>
      <div className="lxo-progress" aria-hidden>
        {STEPS.map((_, i) => (
          <span key={i} className={`lxo-pip${i === step ? " on" : ""}${i < step ? " done" : ""}`} />
        ))}
      </div>

      {/* key=step remounts the panel so the entrance animation replays each step */}
      <div className="lxo-step" key={step}>
        <h2 className="lxo-q">{s.q}</h2>

        {step === 0 && (
          <>
            <input
              autoFocus
              className="lx-input lxo-input"
              type="url"
              inputMode="url"
              placeholder="https://yourproduct.com"
              value={form.productUrl}
              onChange={(e) => set("productUrl", e.target.value)}
            />
            <textarea
              className="lx-textarea"
              style={{ marginTop: 10 }}
              placeholder="What do you want to learn? e.g. can a first-time user reach the dashboard without getting stuck?"
              value={form.goal}
              onChange={(e) => set("goal", e.target.value)}
            />
            {showRepo ? (
              <input
                className="lx-input"
                style={{ marginTop: 10 }}
                type="url"
                placeholder="Public GitHub repo"
                value={form.repoUrl}
                onChange={(e) => set("repoUrl", e.target.value)}
              />
            ) : (
              <button type="button" className="lx-edit-link lxo-addrepo" onClick={() => setShowRepo(true)}>
                <Plus size={14} /> Add a GitHub repo <span className="muted">— optional</span>
              </button>
            )}
          </>
        )}

        {step === 1 && (
          <div className="lxo-budget">
            <input
              autoFocus
              className="lxo-budget-input"
              type="number"
              min="0.5"
              step="0.5"
              value={form.budgetUsd}
              onChange={(e) => set("budgetUsd", e.target.value)}
              aria-label="Testing budget"
            />
            <span className="lxo-budget-unit">USDC</span>
          </div>
        )}

        <div className="lxo-hint">{s.hint}</div>
      </div>

      {error && (
        <div className="lx-err" role="alert">
          {error}
        </div>
      )}

      <div className="lxo-nav">
        {step > 0 ? (
          <button type="button" className="lx-btn ghost" onClick={back}>
            Back
          </button>
        ) : (
          <span className="lxo-step-count">Step {step + 1} of {STEPS.length}</span>
        )}
        {last ? (
          <button type="button" className="lx-btn" onClick={submit} disabled={submitting || !stepValid()}>
            {submitting ? "Starting…" : "Let Sage inspect"}
            <span aria-hidden>→</span>
          </button>
        ) : (
          <button type="button" className="lx-btn" onClick={next} disabled={!stepValid()}>
            Continue
            <span aria-hidden>→</span>
          </button>
        )}
      </div>
    </div>
  );
}

"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/**
 * Step 1 — describe the launch, as a GUIDED, cinematic sequence: one focused question at a
 * time (product → goal → budget) instead of a dense form, so it feels effortless. On the final
 * step it creates (or reuses) a DURABLE inspection job and navigates to /launch/[inspectionId].
 * The id lives in the URL, so refresh / back-forward / reopen all resume the same state.
 */
const STEPS = [
  {
    q: "What should Sage test?",
    hint: "A public page Sage can open. It only reads your product — it never signs in, buys, or changes anything.",
  },
  {
    q: "What do you want to learn?",
    hint: "Be specific — Sage designs the testing missions around exactly this.",
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
  const [form, setForm] = useState({ productUrl: "", repoUrl: "", goal: "", targetUsers: "", budgetUsd: "5" });
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const set = (k: keyof typeof form, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const stepValid = (i = step): boolean => {
    if (i === 0) return isHttpUrl(form.productUrl);
    if (i === 1) return form.goal.trim().length > 3 && form.targetUsers.trim().length > 0;
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
            <input
              className="lx-input"
              style={{ marginTop: 10 }}
              type="url"
              placeholder="Public GitHub repo — optional"
              value={form.repoUrl}
              onChange={(e) => set("repoUrl", e.target.value)}
            />
          </>
        )}

        {step === 1 && (
          <>
            <textarea
              autoFocus
              className="lx-textarea lxo-input"
              placeholder="e.g. We shipped a new onboarding — can a first-time user reach the dashboard without getting stuck?"
              value={form.goal}
              onChange={(e) => set("goal", e.target.value)}
            />
            <input
              className="lx-input"
              style={{ marginTop: 10 }}
              placeholder="Who should test it? e.g. non-technical founders"
              value={form.targetUsers}
              onChange={(e) => set("targetUsers", e.target.value)}
            />
          </>
        )}

        {step === 2 && (
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
            <span className="lxo-budget-unit">test mUSDC</span>
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

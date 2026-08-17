"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Plus } from "lucide-react";
import { rememberInspection } from "@/lib/launch/recent-inspections";
import { useSiwe } from "@/lib/auth/use-siwe";

/** The mailbox Sage owns and reads sign-in codes from. A founder registers their TEST account with
 *  this address when their product has no password, so nobody ever hands Sage an inbox credential. */
const SAGE_TESTER_EMAIL =
  process.env.NEXT_PUBLIC_SAGE_TESTER_EMAIL ?? "briefaiagent@gmail.com";

/** Proven goal shapes — the exact wording styles that produced good plans in real campaigns:
 *  action verbs the journey compiler recognizes, stable facts, no volatile counts. */
const GOAL_CHIPS: { label: string; goal: string }[] = [
  { label: "Let Sage decide", goal: "" },
  {
    label: "First impressions",
    goal: "Can a first-time visitor understand what this product does and find where to start? Report what you actually saw on each screen.",
  },
  {
    label: "Signup & onboarding",
    goal: "Can a new user sign up and get through onboarding without getting stuck? Report each step and anything confusing.",
  },
  {
    label: "Find pricing",
    goal: "Can a visitor find the pricing and understand what it costs to get started? Report what you actually saw.",
  },
  {
    label: "Docs vs reality",
    goal: "Follow the getting-started guide and check the docs match the real product. Identify confusing or missing information.",
  },
];

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
  /**
   * SIGN IN BEFORE INSPECTING — asked for HERE, not after four minutes of typing.
   *
   * An inspection costs real model spend and used to be open to anyone: a quarter came from
   * `anonymous`, and when one of those people later left feedback there was no way to tell whose
   * run it was. The server now refuses an unsigned request, so the form has to say so up front —
   * discovering it at the submit button would be the worst possible moment.
   *
   * It is a free signature: no gas, no transaction, no funds moved. The copy says that, because
   * "connect your wallet" reads like a charge to anyone who has not done it before.
   */
  const siwe = useSiwe();
  const [step, setStep] = useState(0);
  // targetUsers is kept in state (the API still accepts it) but no longer asked — the goal carries intent.
  const [form, setForm] = useState({ productUrl: "", repoUrl: "", goal: "", targetUsers: "", budgetUsd: "5", testEmail: "", testPassword: "" });
  const [showAuth, setShowAuth] = useState(false);
  // One request id per form mount — the request-scoped idempotency token. A double-submit reuses it
  // (one job, not two); a fresh form (new page/reload) is a new turn. The server namespaces it.
  const [requestId] = useState(() =>
    typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  const [showRepo, setShowRepo] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const set = (k: keyof typeof form, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const stepValid = (i = step): boolean => {
    // The goal is OPTIONAL — measured founder behavior: a paragraph-sized "what do you want to
    // learn?" is where people stall or close the tab. An empty goal is a delegation, not a gap:
    // the pipeline forces full exploration and Sage infers the first-visit goal from what it sees.
    if (i === 0) return isHttpUrl(form.productUrl);
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
    if (!siwe.authed) {
      setError(null);
      const ok = siwe.address ? await siwe.signIn() : (await siwe.connect(), false);
      if (!ok) {
        setError(
          siwe.address
            ? "Sign the message to start — it's free, no gas and nothing is spent."
            : "Connect your wallet to start — it's a free signature, no gas and nothing is spent.",
        );
        return;
      }
    }
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch("/api/launch", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...form,
          requestId,
          // The EMAIL alone is enough: an email-code product has no password, and Sage reads the
          // sign-in code from its own mailbox. Requiring both would have silently dropped exactly
          // the credential this feature exists for. The server seals it before anything else.
          testAccount: form.testEmail.trim()
            ? { email: form.testEmail.trim(), password: form.testPassword }
            : null,
        }),
      });
      const data = await res.json();
      if (!data.ok) {
        setError(data.error ?? "Something went wrong.");
        setSubmitting(false);
        return;
      }
      rememberInspection(data.job.id, form.productUrl);
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
            {/* ONE TAP INSTEAD OF ONE PARAGRAPH. Each chip writes a proven goal shape — the same
                wording that produced good mission plans in real campaigns — so the founder who
                cannot be bothered to write still hands Sage a sharp goal, and the founder who can
                write gets a head start to edit. "Let Sage decide" is a first-class choice, not a
                fallback: it clears the goal, and the pipeline treats that as full delegation. */}
            <div className="lxo-chips" role="group" aria-label="Quick goals">
              {GOAL_CHIPS.map((c) => (
                <button
                  key={c.label}
                  type="button"
                  className={`lxo-chip${form.goal === c.goal ? " on" : ""}`}
                  onClick={() => set("goal", c.goal)}
                >
                  {c.label}
                </button>
              ))}
            </div>
            <textarea
              className="lx-textarea"
              style={{ marginTop: 10 }}
              placeholder="Optional — pick a chip, write your own, or leave empty and Sage decides what to test from what it sees."
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
            {/* THE TEST ACCOUNT. Sage can only design and auto-verify work it can actually reach, so on
                a product whose value sits behind a login this is the difference between missions about
                the homepage and missions about the real thing. Encrypted at rest, used only to sign in
                during the inspection, and anything secret it sees is stripped before anyone reads it. */}
            {showAuth ? (
              <div style={{ marginTop: 10 }}>
                <input
                  className="lx-input"
                  type="email"
                  autoComplete="off"
                  placeholder="Test account email"
                  value={form.testEmail}
                  onChange={(e) => set("testEmail", e.target.value)}
                />
                <input
                  className="lx-input"
                  style={{ marginTop: 8 }}
                  type="password"
                  autoComplete="new-password"
                  placeholder="Test account password — leave empty for email-code logins"
                  value={form.testPassword}
                  onChange={(e) => set("testPassword", e.target.value)}
                />
                <p className="muted" style={{ fontSize: 12, lineHeight: 1.55, marginTop: 8 }}>
                  <b style={{ color: "var(--lx-ink)" }}>If your product uses a password:</b> put the
                  test account&apos;s email and password above.
                  <br />
                  <b style={{ color: "var(--lx-ink)" }}>
                    If it emails a sign-in code instead (no password):
                  </b>{" "}
                  create the test account using{" "}
                  <span className="mono">{SAGE_TESTER_EMAIL}</span>, enter that address above, and
                  leave the password empty — Sage reads the code from its own inbox.
                </p>
                <p className="muted" style={{ fontSize: 12, lineHeight: 1.55, marginTop: 6 }}>
                  Always a throwaway TEST account, never a real one. Sage signs in only during this
                  inspection, credentials are stored encrypted and never shown again, and any keys or
                  emails it sees are stripped before they reach a mission or a tester.
                </p>
              </div>
            ) : (
              <button type="button" className="lx-edit-link lxo-addrepo" onClick={() => setShowAuth(true)}>
                <Plus size={14} /> Add a test login <span className="muted">— optional, unlocks work behind your login</span>
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
        {!siwe.authed && last && (
          <p className="lxo-hint" style={{ marginTop: 6, opacity: 0.85 }}>
            You&apos;ll sign a free message to start — no gas, no transaction, nothing spent. It just
            ties this inspection to you so your plan and any feedback stay yours.
          </p>
        )}
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
          <button type="button" className="lx-btn" onClick={submit} disabled={submitting || !stepValid() || siwe.connecting || siwe.signingIn}>
            {submitting
              ? "Starting…"
              : siwe.connecting || siwe.signingIn
                ? "Connecting…"
                : siwe.authed
                  ? "Let Sage inspect"
                  : "Connect wallet & inspect"}
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

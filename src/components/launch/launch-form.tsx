"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/**
 * Step 1 — describe the launch. On submit it creates (or reuses) a DURABLE inspection
 * job and NAVIGATES to /launch/[inspectionId]. No transient client state holds the
 * results: the id lives in the URL, so refresh, back/forward, and reopening all work.
 */
export function LaunchForm() {
  const router = useRouter();
  const [form, setForm] = useState({ productUrl: "", repoUrl: "", goal: "", targetUsers: "", budgetUsd: "5" });
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch("/api/launch", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!data.ok) { setError(data.error ?? "Something went wrong."); setSubmitting(false); return; }
      // navigate to the durable, refresh-safe results route.
      router.push(`/launch/${data.job.id}`);
    } catch {
      setError("Could not reach Sage. Please try again.");
      setSubmitting(false);
    }
  };

  return (
    <form className="lx-card pad-lg" onSubmit={submit}>
      <div className="lx-field">
        <label className="lx-label" htmlFor="url">Product URL</label>
        <input id="url" className="lx-input" type="url" required placeholder="https://yourproduct.com"
          value={form.productUrl} onChange={(e) => setForm({ ...form, productUrl: e.target.value })} />
        <div className="lx-hint">A public page Sage can open. Sage only reads it — it never signs in, buys, or changes anything.</div>
      </div>
      <div className="lx-field">
        <label className="lx-label" htmlFor="repo">Public GitHub repository <span style={{ color: "var(--lx-muted)", fontWeight: 400 }}>· optional</span></label>
        <input id="repo" className="lx-input" type="url" placeholder="https://github.com/you/project"
          value={form.repoUrl} onChange={(e) => setForm({ ...form, repoUrl: e.target.value })} />
      </div>
      <div className="lx-field">
        <label className="lx-label" htmlFor="goal">What are you launching or trying to learn?</label>
        <textarea id="goal" className="lx-textarea" required placeholder="e.g. We just shipped a new onboarding — I want to know if a first-time user can reach the dashboard without getting stuck."
          value={form.goal} onChange={(e) => setForm({ ...form, goal: e.target.value })} />
      </div>
      <div className="lx-row">
        <div className="lx-field">
          <label className="lx-label" htmlFor="users">Target users</label>
          <input id="users" className="lx-input" required placeholder="e.g. non-technical founders"
            value={form.targetUsers} onChange={(e) => setForm({ ...form, targetUsers: e.target.value })} />
        </div>
        <div className="lx-field">
          <label className="lx-label" htmlFor="budget">Testing budget (test mUSDC)</label>
          <input id="budget" className="lx-input" type="number" min="0.5" step="0.5" required
            value={form.budgetUsd} onChange={(e) => setForm({ ...form, budgetUsd: e.target.value })} />
          <div className="lx-hint">Sage allocates this exactly across the missions it designs.</div>
        </div>
      </div>
      <button className="lx-btn" type="submit" disabled={submitting}>
        {submitting ? "Starting…" : "Let Sage inspect"}
        <span aria-hidden>→</span>
      </button>
      {error && <div className="lx-err" role="alert">{error}</div>}
    </form>
  );
}

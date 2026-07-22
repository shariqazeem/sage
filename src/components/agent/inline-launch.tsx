"use client";

import { useEffect, useRef, useState } from "react";
import { BudgetBar } from "@/components/launch/budget-bar";
import type { JobView } from "@/components/launch/types";
import "@/app/launch/launch.css";

/**
 * P27+ — inline launch: the agent drives the founder's CONNECTED wallet right in the chat, so a
 * campaign goes live without leaving /agent. It REUSES the tested, money-critical deploy path verbatim
 * — `BudgetBar` (durable server-verified approval) → `DeployFlow` (the wallet signatures + the vault
 * setup, all resumable and re-validated server-side). This component only fetches the plan and mounts
 * that flow inside the `.lx` scope; it adds NO money logic of its own.
 */
export function InlineLaunch({ inspectionId }: { inspectionId: string }) {
  const [job, setJob] = useState<JobView | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const settled = useRef(false); // stop polling once the plan is ready so DeployFlow owns the state

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (settled.current) return;
      try {
        const res = await fetch(`/api/launch/${inspectionId}`, { cache: "no-store" });
        const data = (await res.json().catch(() => null)) as
          | { ok?: boolean; job?: JobView; error?: string }
          | null;
        if (cancelled) return;
        if (data?.ok && data.job) {
          setJob(data.job);
          const s = data.job.status;
          // Stop only on terminal states. `needs_input` is transient — the founder answers in the
          // chat above (the agent's sage_answer_questions), the plan builds, and this poll catches
          // the flip to `ready` and swaps itself for the funded flow. So keep polling through it.
          if (s === "ready" || s === "failed" || s === "superseded") {
            settled.current = true;
          }
        } else if (data?.error) {
          setErr(data.error);
          settled.current = true;
        }
      } catch {
        if (!cancelled) setErr("Couldn't reach the server — try again.");
      }
    };
    void load();
    const iv = setInterval(() => void load(), 2500);
    return () => {
      cancelled = true;
      clearInterval(iv);
    };
  }, [inspectionId]);

  if (err) {
    return (
      <div className="lx ac-inline">
        <p className="lx-err">{err}</p>
      </div>
    );
  }
  if (!job) return <div className="ac-inline-note">Loading your plan…</div>;
  if (job.status === "failed") {
    return <div className="ac-inline-note">That inspection didn&apos;t finish — start a new one.</div>;
  }
  // `needs_input`: Sage has questions only the founder can answer. Surface them and point back to
  // the chat (where the agent resolves them) — this panel keeps polling and opens itself once ready.
  if (job.status === "needs_input") {
    const questions = (job.result?.questions ?? []).filter((q) => q.trim()).slice(0, 4);
    return (
      <div className="ac-inline-needs">
        <p className="ac-inline-note">
          Sage needs a couple details to finish your plan — answer in the chat above and this opens
          automatically.
        </p>
        {questions.length > 0 && (
          <ul className="ac-inline-qs">
            {questions.map((q, i) => (
              <li key={i}>{q}</li>
            ))}
          </ul>
        )}
      </div>
    );
  }
  if (job.status !== "ready" || !job.plan) {
    return <div className="ac-inline-note">Sage is still building your plan — this will open the moment it&apos;s ready.</div>;
  }
  return (
    <div className="lx ac-inline">
      <BudgetBar
        plan={job.plan}
        jobId={inspectionId}
        approval={job.approval}
        onRevised={(j) => setJob(j)}
        onApproved={(j) => setJob(j)}
      />
    </div>
  );
}

"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { Button } from "@/components/sage/button";
import { Stage } from "./parts";

/**
 * GIVE THIS TEST TO ITS BUILDER (27 Nov 2026). Ran Sage on someone else's product? Send its builder what a
 * stranger hits on a first visit. The link shows Sage's first look to whoever opens it, and the first
 * person to sign in with it takes the test, once, within 7 days. Paying for real people stays theirs.
 */
export function GiveAway({ jobId, host }: { jobId: string; host: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const make = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/t/${encodeURIComponent(jobId)}/gift`, { method: "POST" });
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; url?: string; error?: string };
      if (res.ok && data.ok && data.url) setUrl(data.url);
      else setError(data.error ?? "Sage couldn't make the link. Try again.");
    } catch {
      setError("Sage couldn't be reached. Try again.");
    }
    setBusy(false);
  };

  return (
    <Stage state="next" title="Made this for someone else?" id="give">
      <p className="sg-small">
        Give this test to the builder of <span className="sg-mono sg-ink">{host}</span>. Their link shows what a stranger hits on a first visit, and the first person to sign in with it takes the test. It works once, for 7 days, and you keep nothing of it after.
      </p>
      {url ? (
        <div className="sg-stack sg-gap-2">
          <div className="sg-t-copy">
            <input className="sg-field" readOnly value={url} aria-label="The link to send the builder" onFocus={(e) => e.currentTarget.select()} />
            <Button
              variant="quiet"
              onClick={() => {
                void navigator.clipboard?.writeText(url).then(() => {
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1600);
                });
              }}
            >
              {copied ? <Check size={16} aria-hidden /> : <Copy size={16} aria-hidden />}
              {copied ? "Copied" : "Copy"}
            </Button>
          </div>
          <p className="sg-small">Send it to them yourself, in a message they expect. Sage never sends it for you.</p>
        </div>
      ) : (
        <div>
          <Button variant="quiet" size="sm" disabled={busy} onClick={() => void make()}>
            Make a link for its builder
          </Button>
        </div>
      )}
      {error ? (
        <p className="sg-small sg-note-problem" role="alert">
          {error}
        </p>
      ) : null}
    </Stage>
  );
}

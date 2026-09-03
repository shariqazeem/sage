"use client";

import { useState } from "react";
import { BellRing } from "lucide-react";

/**
 * THE ONE THING A PAID WORKER CAN DO NEXT. Sage had no way to reach anyone who finished a job, so
 * every campaign started from nothing and four of fifty-four people ever came back. This is the
 * channel, asked for rather than assumed: one tap opens Telegram, and one word stops it forever.
 */
export function WorkAlerts({ wallet }: { wallet: string }) {
  const [state, setState] = useState<"idle" | "busy" | "opened">("idle");
  const [err, setErr] = useState<string | null>(null);

  const link = async () => {
    setState("busy");
    setErr(null);
    try {
      const r = await fetch("/api/roster", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ wallet }) });
      const j = (await r.json()) as { url?: string; error?: string };
      if (!r.ok || !j.url) {
        setErr(j.error ?? "Couldn't open that right now.");
        setState("idle");
        return;
      }
      window.open(j.url, "_blank", "noopener,noreferrer");
      setState("opened");
    } catch {
      setErr("Couldn't open that right now.");
      setState("idle");
    }
  };

  return (
    <div className="wa">
      <div className="wa-main">
        <p className="wa-t"><BellRing size={14} /> Get told when there is more work</p>
        <p className="wa-s">
          {state === "opened"
            ? "Telegram is open — press Start there and you're on. At most one message a day, only work you haven't already done, and “stop” ends it."
            : "Sage messages you on Telegram when new paid work opens that you haven't already done. At most one a day, and “stop” ends it."}
        </p>
        {err && <p className="wa-e">{err}</p>}
      </div>
      <button type="button" className="nm-btn" onClick={() => void link()} disabled={state === "busy"}>
        {state === "busy" ? "…" : state === "opened" ? "Open again" : "Turn on alerts"}
      </button>
    </div>
  );
}

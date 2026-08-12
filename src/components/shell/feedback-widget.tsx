"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";
import { MessageSquarePlus, X } from "lucide-react";
import "./feedback-widget.css";

/**
 * THE ONE-TEXTAREA FEEDBACK PIPE — floating, anonymous-first, everywhere the product works.
 *
 * A founder watching an inspection or a tester on the board is the only usability lab this product
 * has; the cost of telling us something read wrong must be a single textarea. No account, contact
 * optional. The current path (and the plan id when on one) rides along so "the missions were
 * confusing" arrives pinned to the exact plan on screen. The cinematic landing stays clean — this
 * mounts only on working surfaces.
 */
export function FeedbackWidget() {
  const pathname = usePathname() ?? "";
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [contact, setContact] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");

  // working surfaces only — never the marketing landing or proof receipts.
  const show =
    pathname.startsWith("/launch") ||
    pathname.startsWith("/missions") ||
    pathname.startsWith("/app") ||
    pathname.startsWith("/agent") ||
    pathname.startsWith("/campaigns") ||
    pathname.startsWith("/hire");
  if (!show) return null;

  const inspectionId = /^\/launch\/([A-Za-z0-9_-]{6,40})/.exec(pathname)?.[1] ?? null;

  const submit = async () => {
    if (message.trim().length < 3 || state === "sending") return;
    setState("sending");
    try {
      const res = await fetch("/api/feedback", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message, contact, page: pathname, inspectionId }),
      });
      const data = (await res.json()) as { ok?: boolean };
      if (data.ok) {
        setState("sent");
        setMessage("");
        setContact("");
      } else {
        setState("error");
      }
    } catch {
      setState("error");
    }
  };

  return (
    <div className="fbw">
      {open && (
        <div className="fbw-panel" role="dialog" aria-label="Leave feedback">
          <div className="fbw-head">
            <span>Tell us anything</span>
            <button className="fbw-x" aria-label="Close" onClick={() => setOpen(false)}>
              <X size={14} />
            </button>
          </div>
          {state === "sent" ? (
            <div className="fbw-thanks">
              Got it — thank you. It goes straight to the person building this.
              <button className="fbw-again" onClick={() => setState("idle")}>
                Send another
              </button>
            </div>
          ) : (
            <>
              <textarea
                className="fbw-text"
                placeholder="What felt wrong, confusing, or great? A sentence is plenty."
                value={message}
                maxLength={2000}
                rows={4}
                onChange={(e) => setMessage(e.target.value)}
              />
              <input
                className="fbw-contact"
                placeholder="Reply-to (optional — email, Telegram, X)"
                value={contact}
                maxLength={200}
                onChange={(e) => setContact(e.target.value)}
              />
              <div className="fbw-row">
                <a className="fbw-agent" href="/agent">
                  or chat with Sage
                </a>
                <button
                  className="fbw-send"
                  disabled={message.trim().length < 3 || state === "sending"}
                  onClick={() => void submit()}
                >
                  {state === "sending" ? "Sending…" : "Send"}
                </button>
              </div>
              {state === "error" && (
                <div className="fbw-err">Couldn&apos;t send — try again in a moment.</div>
              )}
            </>
          )}
        </div>
      )}
      <button className="fbw-fab" onClick={() => setOpen((v) => !v)} aria-label="Leave feedback">
        <MessageSquarePlus size={15} />
        Feedback
      </button>
    </div>
  );
}

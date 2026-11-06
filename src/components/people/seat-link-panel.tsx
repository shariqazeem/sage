"use client";

import { useEffect, useState } from "react";
import { Check, Copy, Loader2, Send, Users } from "lucide-react";

interface SeatLink {
  url: string;
  seats: number;
  taken: number;
  message: string;
  programmeId: string | null;
}

/**
 * THE NEXT MOVE AFTER LAUNCHING WORK FOR YOUR OWN PEOPLE IS SENDING IT TO THEM (6 Nov 2026).
 *
 * One link for the whole group, and a message in the founder's voice, ready to paste where their people
 * already are: a group chat, a DM, an email. Each person who opens it and signs in takes one of the job's
 * places. The message is written from the job's own title and reward. No model writes it, and no amount
 * appears that the founder didn't set.
 */
export function SeatLinkPanel({ campaignId }: { campaignId: string }) {
  const [link, setLink] = useState<SeatLink | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [copied, setCopied] = useState<"link" | "message" | null>(null);

  useEffect(() => {
    let live = true;
    void fetch("/api/seats", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ campaignId }) })
      .then(async (r) => {
        const j = (await r.json()) as { link?: SeatLink; error?: string };
        if (!live) return;
        if (!r.ok || !j.link) setErr(j.error ?? "Could not make the link.");
        else setLink(j.link);
      })
      .catch(() => live && setErr("Could not make the link. Open the job to try again."));
    return () => {
      live = false;
    };
  }, [campaignId]);

  const copy = (what: "link" | "message") => {
    if (!link) return;
    void navigator.clipboard
      ?.writeText(what === "link" ? link.url : link.message)
      .then(() => setCopied(what))
      .catch(() => undefined);
  };

  if (err) return <p className="seat-panel-err">{err}</p>;
  if (!link) {
    return (
      <p className="seat-panel-wait">
        <Loader2 size={13} className="sage-spin2" /> Making the link for your people…
      </p>
    );
  }
  const enc = encodeURIComponent;
  return (
    <div className="seat-panel">
      <p className="seat-panel-head">
        <Users size={14} /> <b>Send it to your people.</b> One link, {link.seats} {link.seats === 1 ? "place" : "places"}
        {link.programmeId ? ", the same link every week" : ""}.{" "}
        <span className="seat-panel-count">
          {link.taken} of {link.seats} joined
        </span>
      </p>
      <p className="seat-panel-msg">{link.message}</p>
      <div className="seat-panel-row">
        <button type="button" className="lxo-chip" onClick={() => copy("message")}>
          {copied === "message" ? <><Check size={13} /> Copied</> : <><Copy size={13} /> Copy the message</>}
        </button>
        <a className="lxo-chip" href={`https://wa.me/?text=${enc(link.message)}`} target="_blank" rel="noopener noreferrer">
          <Send size={13} /> WhatsApp
        </a>
        <a className="lxo-chip" href={`https://t.me/share/url?url=${enc(link.url)}&text=${enc(link.message.replace(link.url, "").trim())}`} target="_blank" rel="noopener noreferrer">
          <Send size={13} /> Telegram
        </a>
        <button type="button" className="lxo-chip" onClick={() => copy("link")}>
          {copied === "link" ? <><Check size={13} /> Copied</> : "Copy the link only"}
        </button>
      </div>
    </div>
  );
}

"use client";
import { MessageCircle } from "lucide-react";

/**
 * WHATSAPP IS THE CARIBBEAN'S MESSENGER. A share link needs no API, no business account and no
 * approval: `wa.me` opens the user's own WhatsApp with the text prefilled, on phone or desktop.
 * Used wherever a person would forward something — an invite, a receipt, a record, a statement.
 */
export function WhatsAppShare({ text, url, label = "Share on WhatsApp", className = "sage-sub-link" }: { text: string; url?: string; label?: string; className?: string }) {
  const body = url ? `${text} ${url}` : text;
  return (
    <a className={className} href={`https://wa.me/?text=${encodeURIComponent(body)}`} target="_blank" rel="noopener noreferrer">
      <MessageCircle size={13} /> {label}
    </a>
  );
}

"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

/**
 * THE SHEET: the only thing in the kit that floats. A panel from the right on a desktop (or centred,
 * for a short question like signing in), and from the bottom on a phone.
 *
 * Escape closes it, a tap on the page behind closes it, Tab stays inside it, and focus goes back to
 * whatever opened it. It is deliberately NOT a native modal <dialog>: a modal dialog makes the rest
 * of the page inert, and the email sign-in opens its own window on top of the page, which would then
 * be unreachable from inside a sheet.
 */
export function Sheet({
  open,
  onClose,
  title,
  side = "right",
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  side?: "right" | "center";
  children: ReactNode;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    const opener = document.activeElement as HTMLElement | null;
    const el = panel.current;
    el?.focus();
    const scroll = document.documentElement.style.overflow;
    document.documentElement.style.overflow = "hidden";

    const onKey = (e: KeyboardEvent) => {
      if (!el) return;
      if (e.key === "Escape") {
        e.stopPropagation();
        closeRef.current();
        return;
      }
      // Tab stays inside the sheet, but only while focus is in it: a sign-in window opened from here
      // takes focus for itself, and is left alone.
      if (e.key !== "Tab" || !el.contains(document.activeElement)) return;
      const stops = Array.from(el.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])')).filter(
        (n) => n.offsetParent !== null,
      );
      if (stops.length === 0) return;
      const first = stops[0];
      const last = stops[stops.length - 1];
      if (e.shiftKey && (document.activeElement === first || document.activeElement === el)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.documentElement.style.overflow = scroll;
      opener?.focus?.();
    };
  }, [open]);

  if (!open || typeof document === "undefined") return null;
  return createPortal(
    <>
      <div className="sg-sheet-scrim" onClick={onClose} aria-hidden />
      <div ref={panel} className="sg-sheet" data-side={side} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}>
        <header className="sg-sheet-head">
          <h2 className="sg-sheet-title" id={titleId}>
            {title}
          </h2>
          <button type="button" className="sg-sheet-close" onClick={onClose} aria-label="Close">
            <X size={18} strokeWidth={1.75} />
          </button>
        </header>
        <div className="sg-sheet-body">{children}</div>
      </div>
    </>,
    document.body,
  );
}

"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";

/** Small, safe copy-to-clipboard button with a brief confirmation state. */
export function CopyButton({ value, label }: { value: string; label?: string }) {
  const [done, setDone] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setDone(true);
      window.setTimeout(() => setDone(false), 1400);
    } catch {
      // Clipboard unavailable (e.g. insecure context) — fail silently.
    }
  }

  return (
    <button
      type="button"
      className={`hcopy${done ? " done" : ""}`}
      onClick={copy}
      aria-label={label ? `Copy ${label}` : "Copy"}
      title={done ? "Copied" : "Copy"}
    >
      {done ? <Check size={14} /> : <Copy size={14} />}
    </button>
  );
}

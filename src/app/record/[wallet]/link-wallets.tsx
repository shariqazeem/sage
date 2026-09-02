"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Link2 } from "lucide-react";

/**
 * "Link my other wallet to this record" — shown only when the viewer is signed in with BOTH
 * wallets and this record belongs to one of them. The server links exactly the two sessions.
 */
export function LinkWalletsButton({ otherLabel }: { otherLabel: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  return (
    <div className="rec-link">
      <button
        type="button"
        className="rec-link-btn"
        disabled={busy}
        onClick={async () => {
          setBusy(true); setErr(null);
          try {
            const res = await fetch("/api/record/link", { method: "POST" });
            const j = (await res.json()) as { ok?: boolean; error?: string };
            if (!res.ok || !j.ok) setErr(j.error ?? "Could not link.");
            else router.refresh();
          } catch { setErr("Could not link."); } finally { setBusy(false); }
        }}
      >
        <Link2 size={14} /> {busy ? "Linking…" : `Link my ${otherLabel} wallet to this record`}
      </button>
      <span className="rec-link-hint">One business, two rails: both wallets are proven by your own sign-ins; nothing is claimed.</span>
      {err && <span className="rec-link-err">{err}</span>}
    </div>
  );
}

import Link from "next/link";
import { Check, ShieldCheck } from "lucide-react";
import type { EcosystemStatus } from "@/lib/ecosystem/status";

/**
 * A small, HONEST ecosystem strip — one presentational render of the canonical
 * {@link EcosystemStatus}, shown on the landing + agent page. Each capability asserts only
 * what is really true: a check + "verified/paid/live" when backed by evidence, a muted
 * "· claimed / · configured" otherwise, and nothing at all when not configured. Inline
 * styles (with the page's design tokens) so it reads the same on every surface.
 */
const POSITIVE = new Set(["verified", "paid", "live"]);

const wrap: React.CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: 8,
  alignItems: "center",
};
const base: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 5,
  fontFamily: "var(--font-mono)",
  fontSize: 11.5,
  lineHeight: 1,
  padding: "5px 9px",
  borderRadius: 4,
  border: "1px solid var(--line, #ece7de)",
  color: "var(--sec, #6b6f76)",
  textDecoration: "none",
  whiteSpace: "nowrap",
};

function chipStyle(positive: boolean): React.CSSProperties {
  return positive
    ? { ...base, color: "var(--pos, #15803d)", borderColor: "color-mix(in srgb, var(--pos, #15803d) 34%, transparent)" }
    : base;
}

function Chip({ label, state, href }: { label: string; state?: string; href?: string }) {
  const positive = state ? POSITIVE.has(state) : true;
  const body = (
    <>
      {positive && <Check size={12} strokeWidth={2.4} />}
      {label}
      {state ? ` · ${state}` : ""}
    </>
  );
  return href ? (
    <Link href={href} target="_blank" rel="noopener noreferrer" style={chipStyle(positive)}>
      {body}
    </Link>
  ) : (
    <span style={chipStyle(positive)}>{body}</span>
  );
}

export function EcosystemStrip({ status }: { status: EcosystemStatus }) {
  const s = status;
  return (
    <div style={wrap}>
      {s.campaignExecution && <Chip label={`Live on ${s.campaignExecution.network}`} />}
      {s.erc8004.state !== "not_configured" && (
        <Chip
          label={`ERC-8004${s.erc8004.agentId ? ` #${s.erc8004.agentId}` : ""}`}
          state={s.erc8004.state}
          href={s.erc8004.scanUrl}
        />
      )}
      {s.x402.state !== "not_configured" && <Chip label="x402 payments" state={s.x402.state} />}
      {s.clawup.state !== "not_configured" && <Chip label="ClawUp agent" state={s.clawup.state} />}
      {!s.mainnetAutopilot.enabled && (
        <span style={base}>
          <ShieldCheck size={12} strokeWidth={2.2} /> Mainnet autopilot off
        </span>
      )}
    </div>
  );
}

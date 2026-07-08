import { chainConfig } from "@/lib/deputy/networks";

/**
 * The network truth chip. Names the chain a campaign / payout lives on so nothing
 * over- or under-promises: GOAT Mainnet reads warm (real money), a testnet reads
 * quiet grey. Self-styled (inline) so it renders correctly inside any surface —
 * the app shell, the /proof page, /c/[slug] — without a shared stylesheet. Works
 * in both server and client trees (no hooks).
 */
export function NetworkChip({
  chainId,
  size = "sm",
}: {
  chainId: number;
  size?: "sm" | "xs";
}) {
  const cfg = chainConfig(chainId);
  const mainnet = cfg.isMainnet;
  const pad = size === "xs" ? "2px 7px" : "3px 9px";
  const font = size === "xs" ? 10 : 11;
  const dot = size === "xs" ? 5 : 6;
  return (
    <span
      title={`${cfg.name} · chain ${cfg.chainId}`}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: pad,
        borderRadius: 999,
        fontSize: font,
        fontWeight: 600,
        lineHeight: 1.2,
        letterSpacing: "0.02em",
        fontFamily: "var(--font-mono, ui-monospace), monospace",
        whiteSpace: "nowrap",
        border: `1px solid ${mainnet ? "rgba(245,158,11,0.42)" : "rgba(120,132,148,0.32)"}`,
        color: mainnet ? "#b45309" : "#6b7280",
        background: mainnet ? "rgba(245,158,11,0.09)" : "rgba(120,132,148,0.07)",
      }}
    >
      <span
        aria-hidden
        style={{
          width: dot,
          height: dot,
          borderRadius: "50%",
          background: mainnet ? "#f59e0b" : "#9aa2b1",
          flex: "none",
        }}
      />
      {cfg.chipLabel}
    </span>
  );
}

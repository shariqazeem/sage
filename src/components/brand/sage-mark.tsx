import Image from "next/image";

/**
 * THE ONE SAGE MARK.
 *
 * It was a drawn receipt glyph in terracotta. Nice idea, but at 20-22px in a nav rail it read as a
 * small red shape rather than a logo, and a shape that appears in six places without being
 * recognisable is decoration, not a brand. This renders the real logo asset, so every surface that
 * already used <SageMark/> — rail, landing nav, agent page, tester board, proof page, agent profile
 * — picks up the actual mark with no per-surface change.
 *
 * Square source (1254x1254), rounded on a radius that scales with the size: a hard-edged photo in a
 * nav reads as an image someone pasted, a rounded one reads as an app icon.
 */
export function SageMark({
  size = 22,
  className = "",
}: {
  size?: number;
  className?: string;
}) {
  return (
    <Image
      src="/sagelogo.jpg"
      alt=""
      width={size}
      height={size}
      className={className}
      // `priority` is deliberately not set — the mark is chrome on every page, and flagging chrome
      // as priority competes with the content the visitor actually came for.
      style={{
        width: size,
        height: size,
        borderRadius: Math.max(4, Math.round(size * 0.26)),
        objectFit: "cover",
        flex: "none",
        display: "block",
      }}
    />
  );
}

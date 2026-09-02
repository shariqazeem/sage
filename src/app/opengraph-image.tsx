import { ImageResponse } from "next/og";

// The DEFAULT share card — every surface without its own OG (landing, board, console, dashboard) gets
// this. Receipt-minimalism, using the LITERAL token values (Satori can't read CSS vars), so the OG
// palette matches tokens.css instead of drifting.
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const alt = "Sage: pay people for work an AI has verified — public receipts on GOAT, private payouts on Starknet";

const PAPER = "#fbfbf9";
const INK = "#1a1d21";
const ACCENT = "#c2410c";
const MUTED = "#565c64";
const BORDER = "#e9e6df";
const MARK = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAIAAAAlC+aJAAABY2lDQ1BrQ0dDb2xvclNwYWNlRGlzcGxheVAzAAAokX2QsUvDUBDGv1aloHUQHRwcMolDlJIKuji0FURxCFXB6pS+pqmQxkeSIgU3/4GC/4EKzm4Whzo6OAiik+jm5KTgouV5L4mkInqP435877vjOCA5bnBu9wOoO75bXMorm6UtJfWMBL0gDObxnK6vSv6uP+P9PvTeTstZv///jcGK6TGqn5QZxl0fSKjE+p7PJe8Tj7m0FHFLshXyieRyyOeBZ71YIL4mVljNqBC/EKvlHt3q4brdYNEOcvu06WysyTmUE1jEDjxw2DDQhAId2T/8s4G/gF1yN+FSn4UafOrJkSInmMTLcMAwA5VYQ4ZSk3eO7ncX3U+NtYMnYKEjhLiItZUOcDZHJ2vH2tQ8MDIEXLW54RqB1EeZrFaB11NguASM3lDPtlfNauH26Tww8CjE2ySQOgS6LSE+joToHlPzA3DpfAEDp2ITpJYOWwAAAARjSUNQDA0AAW4D4+8AAACoZVhJZk1NACoAAAAIAAUBEgADAAAAAQABAAABGgAFAAAAAQAAAEoBGwAFAAAAAQAAAFIBKAADAAAAAQACAACHaQAEAAAAAQAAAFoAAAAAAAAASAAAAAEAAABIAAAAAQAGkAAABwAAAAQwMjIxkQEABwAAAAQBAgMAoAAABwAAAAQwMTAwoAIABAAAAAEAAABAoAMABAAAAAEAAABApAYAAwAAAAEAAAAAAAAAABRi4EoAAAAJcEhZcwAACxMAAAsTAQCanBgAAAR6aVRYdFhNTDpjb20uYWRvYmUueG1wAAAAAAA8eDp4bXBtZXRhIHhtbG5zOng9ImFkb2JlOm5zOm1ldGEvIiB4OnhtcHRrPSJYTVAgQ29yZSA2LjAuMCI+CiAgIDxyZGY6UkRGIHhtbG5zOnJkZj0iaHR0cDovL3d3dy53My5vcmcvMTk5OS8wMi8yMi1yZGYtc3ludGF4LW5zIyI+CiAgICAgIDxyZGY6RGVzY3JpcHRpb24gcmRmOmFib3V0PSIiCiAgICAgICAgICAgIHhtbG5zOnRpZmY9Imh0dHA6Ly9ucy5hZG9iZS5jb20vdGlmZi8xLjAvIgogICAgICAgICAgICB4bWxuczpleGlmPSJodHRwOi8vbnMuYWRvYmUuY29tL2V4aWYvMS4wLyI+CiAgICAgICAgIDx0aWZmOllSZXNvbHV0aW9uPjcyPC90aWZmOllSZXNvbHV0aW9uPgogICAgICAgICA8dGlmZjpSZXNvbHV0aW9uVW5pdD4yPC90aWZmOlJlc29sdXRpb25Vbml0PgogICAgICAgICA8dGlmZjpYUmVzb2x1dGlvbj43MjwvdGlmZjpYUmVzb2x1dGlvbj4KICAgICAgICAgPHRpZmY6T3JpZW50YXRpb24+MTwvdGlmZjpPcmllbnRhdGlvbj4KICAgICAgICAgPGV4aWY6UGl4ZWxYRGltZW5zaW9uPjEyNTQ8L2V4aWY6UGl4ZWxYRGltZW5zaW9uPgogICAgICAgICA8ZXhpZjpDb2xvclNwYWNlPjE8L2V4aWY6Q29sb3JTcGFjZT4KICAgICAgICAgPGV4aWY6U2NlbmVDYXB0dXJlVHlwZT4wPC9leGlmOlNjZW5lQ2FwdHVyZVR5cGU+CiAgICAgICAgIDxleGlmOkV4aWZWZXJzaW9uPjAyMjE8L2V4aWY6RXhpZlZlcnNpb24+CiAgICAgICAgIDxleGlmOkNvbXBvbmVudHNDb25maWd1cmF0aW9uPgogICAgICAgICAgICA8cmRmOlNlcT4KICAgICAgICAgICAgICAgPHJkZjpsaT4xPC9yZGY6bGk+CiAgICAgICAgICAgICAgIDxyZGY6bGk+MjwvcmRmOmxpPgogICAgICAgICAgICAgICA8cmRmOmxpPjM8L3JkZjpsaT4KICAgICAgICAgICAgICAgPHJkZjpsaT4wPC9yZGY6bGk+CiAgICAgICAgICAgIDwvcmRmOlNlcT4KICAgICAgICAgPC9leGlmOkNvbXBvbmVudHNDb25maWd1cmF0aW9uPgogICAgICAgICA8ZXhpZjpGbGFzaFBpeFZlcnNpb24+MDEwMDwvZXhpZjpGbGFzaFBpeFZlcnNpb24+CiAgICAgICAgIDxleGlmOlBpeGVsWURpbWVuc2lvbj4xMjU0PC9leGlmOlBpeGVsWURpbWVuc2lvbj4KICAgICAgPC9yZGY6RGVzY3JpcHRpb24+CiAgIDwvcmRmOlJERj4KPC94OnhtcG1ldGE+CnSpYJ0AAA2ZSURBVGgF7VlrjFXVFT6v+5gZZxwe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";

export default function OG() {
  return new ImageResponse(
    (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          width: "100%",
          height: "100%",
          background: PAPER,
          color: INK,
          padding: "72px 84px",
          justifyContent: "space-between",
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 20, fontSize: 44, fontWeight: 700, letterSpacing: -1 }}>
          {/* The real mark, inlined as a data URI: Satori renders this in a serverless context with
              no access to the filesystem or to a fetch of our own origin at build time. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={MARK} width={58} height={58} alt="" style={{ borderRadius: 14 }} />
          Sage
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ fontSize: 66, fontWeight: 800, letterSpacing: -2.5, lineHeight: 1.05 }}>Pay people for work</div>
          <div style={{ fontSize: 66, fontWeight: 800, letterSpacing: -2.5, lineHeight: 1.05, color: ACCENT }}>
            an AI has verified.
          </div>
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            fontSize: 26,
            color: MUTED,
            borderTop: `2px solid ${BORDER}`,
            paddingTop: 28,
          }}
        >
          <div style={{ display: "flex" }}>Testing · gigs · grants — paid in USDC, privately on Starknet.</div>
          <div style={{ display: "flex" }}>sagepays.xyz</div>
        </div>
      </div>
    ),
    size,
  );
}

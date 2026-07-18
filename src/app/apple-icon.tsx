import { ImageResponse } from "next/og";

// The home-screen (apple-touch) icon — the SageMark receipt glyph centered on paper, rendered to PNG
// (iOS won't reliably render an SVG home-screen icon). Literal token colors; iOS rounds the corners.
export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#fbfbf9",
        }}
      >
        <svg width="118" height="118" viewBox="0 0 24 24" fill="none">
          <path
            d="M5 5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v13.6L17.25 20 15.5 18.6 13.75 20 12 18.6 10.25 20 8.5 18.6 6.75 20 5 18.6Z"
            fill="#c2410c"
          />
          <rect x="8" y="8" width="8" height="1.7" rx="0.85" fill="#fbfbf9" />
          <rect x="8" y="11.3" width="5" height="1.7" rx="0.85" fill="#fbfbf9" />
        </svg>
      </div>
    ),
    size,
  );
}

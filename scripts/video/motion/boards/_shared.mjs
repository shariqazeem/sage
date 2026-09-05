import { readFileSync } from "node:fs";
import { resolve } from "node:path";
export const W = 1080, H = 1080;
export const rec = (name) => `file://${resolve(`docs/posts/videos/rec/${name}.webm`)}`;
export const marksOf = (name) => JSON.parse(readFileSync(`docs/posts/videos/rec/${name}.marks.json`, "utf8")).marks;
export const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;");
/** type-on: every character fades in on its own beat */
export const typeOn = (text, at, cps = 34) => [...text].map((ch, i) => `<span style="animation:fade .05s ${(at + i / cps).toFixed(3)}s both">${ch === " " ? "&nbsp;" : esc(ch)}</span>`).join("");

/**
 * RE-TIME a narrated cut to a voiceover: one audio file per scene (vo/scene-1.m4a … scene-8.m4a,
 * any ffmpeg-readable format). Each scene's picture is stretched to its recording by adding holds
 * to its shots (captioned shots by word count, others evenly), never by slowing motion; the files
 * are concatenated into one track in scene order and muxed under the cut.
 *
 *   node scripts/video/retime.mjs --cut docs/posts/videos/cuts/fc-film.json --vo docs/posts/videos/vo
 *   → writes <cut>-vo.json and renders <name>-vo.mp4 via cine.mjs --audio
 */
import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync } from "node:fs";
import { join, resolve, basename } from "node:path";
import { execFileSync } from "node:child_process";

const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : d; };
const cutPath = arg("cut"); const voDir = arg("vo");
if (!cutPath || !voDir) throw new Error("--cut <cut.json> --vo <dir>");
const cut = JSON.parse(readFileSync(cutPath, "utf8"));
const recDir = resolve(cut.recDir ?? "docs/posts/videos/rec");
const dur = (f) => Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", f]).toString().trim());
const marks = new Map();
const at = (rec, v) => { if (typeof v === "number") return v; const m = /^m:([a-zA-Z0-9_-]+)([+-][0-9.]+)?$/.exec(v); if (!marks.has(rec)) marks.set(rec, JSON.parse(readFileSync(join(recDir, `${rec}.marks.json`), "utf8")).marks); return marks.get(rec)[m[1]] + (m[2] ? Number(m[2]) : 0); };

// scene audio files: scene-<n>.<ext>
const files = readdirSync(voDir).filter((f) => /^scene-\d+\./.test(f)).sort((a, b) => Number(a.match(/\d+/)[0]) - Number(b.match(/\d+/)[0]));
const voOf = new Map(files.map((f) => [Number(f.match(/\d+/)[0]), join(voDir, f)]));
const scenes = [...new Set(cut.shots.map((s) => s.scene ?? 0))];
for (const sc of scenes) {
  const shots = cut.shots.filter((s) => (s.scene ?? 0) === sc);
  const vo = voOf.get(sc);
  const base = shots.map((s) => (s.card != null ? (s.seconds ?? 1.2) : (at(s.rec, s.to ?? "m:end") - at(s.rec, s.from ?? 0)) / (s.speed ?? 1)));
  const pictureNow = base.reduce((a, b) => a + b, 0);
  if (!vo) { console.log(`scene ${sc}: no voiceover file — keeps ${pictureNow.toFixed(1)}s`); continue; }
  const want = dur(vo) + 0.4;
  const extra = Math.max(0, want - pictureNow);
  // distribute the extra by caption word count over recorded shots (cards keep their seconds)
  const weights = shots.map((s) => (s.card != null ? 0 : Math.max(3, String(s.caption ?? "").split(/\s+/).length)));
  const wsum = weights.reduce((a, b) => a + b, 0) || 1;
  shots.forEach((s, i) => { if (s.card == null) s.hold = Number(((s.hold ?? 0) + (extra * weights[i]) / wsum).toFixed(2)); });
  console.log(`scene ${sc}: voice ${dur(vo).toFixed(1)}s, picture ${pictureNow.toFixed(1)}s → +${extra.toFixed(1)}s of holds`);
}
cut.narrated = false; // holds are now explicit
const outCut = cutPath.replace(/\.json$/, "-vo.json");
cut.name = `${cut.name}-vo`;
writeFileSync(outCut, JSON.stringify(cut, null, 1));
// one voice track in scene order, with the same gaps the picture has (0.4s per scene)
const work = join("docs/posts/videos/out", ".vo-work"); mkdirSync(work, { recursive: true });
const list = join(work, "vo-list.txt");
const parts = [];
for (const sc of scenes) { const vo = voOf.get(sc); if (!vo) continue; const p = join(work, `s${sc}.wav`); execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-i", vo, "-af", "apad=pad_dur=0.4", "-ar", "48000", "-ac", "1", p]); parts.push(p); }
writeFileSync(list, parts.map((p) => `file '${resolve(p)}'`).join("\n"));
const track = join(work, `${cut.name}.wav`);
execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-f", "concat", "-safe", "0", "-i", list, "-c", "copy", track]);
console.log(`voice track ${dur(track).toFixed(1)}s → rendering ${cut.name}.mp4`);
execFileSync("node", ["scripts/video/cine.mjs", "--cut", outCut, "--audio", track], { stdio: "inherit" });

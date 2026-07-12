import "server-only";

/**
 * Optional, read-only, bounded public GitHub inspection. It reads a handful of useful
 * artifacts (README, manifest, routes, config, tests, docs, schemas) via the public
 * GitHub REST API — it NEVER clones, executes, installs, or runs anything, caps file
 * count + bytes, ignores binary/oversized/secret-like files, and sanitizes content as
 * untrusted. Repository capabilities are labeled repo-observed (NOT browser-confirmed).
 * If GitHub is private / unavailable / rate-limited, it returns an empty result with an
 * honest reason — inspection continues web-only.
 */

import { createHash } from "node:crypto";
import type { RepoArtifact } from "./schemas";

export interface RepoInspectResult {
  artifacts: RepoArtifact[];
  reason: string | null;
}

const MAX_FILES = 10;
const MAX_BYTES = 60 * 1024;
const SECRET_LIKE = /\.(env|pem|key|p12|pfx)$|(^|\/)\.env|secrets?|credential/i;
const BINARY_EXT = /\.(png|jpe?g|gif|webp|ico|svg|pdf|zip|gz|tar|mp4|mp3|wasm|woff2?|ttf|lock)$/i;

const USEFUL: { re: RegExp; kind: string; observation: (p: string) => string }[] = [
  { re: /^readme(\.md|\.txt)?$/i, kind: "readme", observation: () => "project README" },
  { re: /^package\.json$/i, kind: "manifest", observation: () => "npm manifest (dependencies + scripts names)" },
  { re: /(^|\/)(app|pages|src\/app|src\/pages|routes?)\//i, kind: "route", observation: (p) => `route/page file: ${p}` },
  { re: /(^|\/)openapi|swagger|schema\.(json|ya?ml|graphql|prisma)$/i, kind: "schema", observation: (p) => `API/data schema: ${p}` },
  { re: /(^|\/)(vercel|netlify|dockerfile|docker-compose|next\.config|\.env\.example)/i, kind: "config", observation: (p) => `deploy/config example: ${p}` },
  { re: /(^|\/)(test|tests|__tests__|e2e|spec)\//i, kind: "test", observation: (p) => `test file: ${p}` },
  { re: /(^|\/)docs?\//i, kind: "doc", observation: (p) => `documentation: ${p}` },
];

function parseRepo(url: string): { owner: string; repo: string } | null {
  try {
    const u = new URL(url);
    if (u.host.toLowerCase() !== "github.com") return null;
    const [owner, repo] = u.pathname.replace(/^\/+/, "").split("/");
    if (!owner || !repo) return null;
    return { owner, repo: repo.replace(/\.git$/, "") };
  } catch {
    return null;
  }
}

async function gh(path: string): Promise<Response> {
  return fetch(`https://api.github.com${path}`, {
    headers: { accept: "application/vnd.github+json", "user-agent": "SageMissionBrain/1.0" },
    signal: AbortSignal.timeout(10_000),
  });
}

export async function inspectRepo(url: string): Promise<RepoInspectResult> {
  const parsed = parseRepo(url);
  if (!parsed) return { artifacts: [], reason: "not a public github.com repository URL" };
  const { owner, repo } = parsed;

  let defaultBranch = "main";
  try {
    const meta = await gh(`/repos/${owner}/${repo}`);
    if (meta.status === 404) return { artifacts: [], reason: "repository not found or private" };
    if (meta.status === 403) return { artifacts: [], reason: "github rate-limited — repository coverage skipped" };
    if (!meta.ok) return { artifacts: [], reason: `github unavailable (${meta.status})` };
    defaultBranch = ((await meta.json()) as { default_branch?: string })?.default_branch ?? "main";
  } catch {
    return { artifacts: [], reason: "github unreachable" };
  }

  let tree: { path: string; type: string; size?: number }[] = [];
  try {
    const res = await gh(`/repos/${owner}/${repo}/git/trees/${defaultBranch}?recursive=1`);
    if (!res.ok) return { artifacts: [], reason: `could not read repository tree (${res.status})` };
    tree = ((await res.json()) as { tree?: { path: string; type: string; size?: number }[] })?.tree ?? [];
  } catch {
    return { artifacts: [], reason: "could not read repository tree" };
  }

  // pick useful, non-binary, non-secret, small files — de-duped by kind, capped.
  const picks: { path: string; kind: string; observation: string }[] = [];
  const kindSeen = new Map<string, number>();
  for (const node of tree) {
    if (node.type !== "blob") continue;
    if (BINARY_EXT.test(node.path) || SECRET_LIKE.test(node.path)) continue;
    if ((node.size ?? 0) > MAX_BYTES) continue;
    const match = USEFUL.find((u) => u.re.test(node.path));
    if (!match) continue;
    const n = kindSeen.get(match.kind) ?? 0;
    if (match.kind === "route" && n >= 4) continue;
    if (match.kind !== "route" && n >= 2) continue;
    kindSeen.set(match.kind, n + 1);
    picks.push({ path: node.path, kind: match.kind, observation: match.observation(node.path) });
    if (picks.length >= MAX_FILES) break;
  }

  const artifacts: RepoArtifact[] = [];
  for (const p of picks) {
    try {
      const raw = await fetch(`https://raw.githubusercontent.com/${owner}/${repo}/${defaultBranch}/${p.path}`, {
        headers: { "user-agent": "SageMissionBrain/1.0" },
        signal: AbortSignal.timeout(8_000),
      });
      if (!raw.ok) continue;
      const buf = new Uint8Array(await raw.arrayBuffer());
      if (buf.byteLength > MAX_BYTES) continue;
      // never store raw content as instructions — only a sanitized structural observation.
      const contentSha256 = createHash("sha256").update(buf).digest("hex");
      let observation = p.observation;
      if (p.kind === "manifest") {
        try {
          const pkg = JSON.parse(new TextDecoder().decode(buf)) as { name?: string; scripts?: Record<string, string>; dependencies?: Record<string, string> };
          const deps = Object.keys(pkg.dependencies ?? {}).slice(0, 12).join(", ");
          observation = `manifest '${pkg.name ?? repo}' — scripts: ${Object.keys(pkg.scripts ?? {}).slice(0, 8).join(", ")}; deps: ${deps}`;
        } catch {
          /* keep default */
        }
      }
      artifacts.push({ path: p.path, kind: p.kind, observation: observation.slice(0, 300), contentSha256 });
    } catch {
      /* skip this file */
    }
  }

  return { artifacts, reason: artifacts.length === 0 ? "no useful public artifacts found" : null };
}

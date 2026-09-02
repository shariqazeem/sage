/**
 * GITHUB PROVENANCE — a held signal for "create it on GitHub" deliverables.
 *
 * The artifact contract proves a page is live and carries the submitter's marker. It cannot see
 * WHEN the repository came to exist or whether it is someone else's work under a new name. Two
 * cheap, deterministic facts from GitHub's public API close most of that: a repository that is a
 * FORK is not the submitter's own creation, and a repository CREATED BEFORE THE GIG EXISTED is
 * pre-existing work being passed off as new. Both are HELD for the founder's review, never an
 * auto-reject — and the check degrades to NO SIGNAL (never a hold) when the API is unreachable or
 * rate-limited, because an honest tester must never be held for GitHub's rate limit.
 *
 * Only ever consulted for artifact_url deliverables whose host is github.com. Reads nothing that
 * needs an account; `GITHUB_TOKEN` (optional) only raises the rate limit and is never logged.
 */
export interface GithubRepoRef {
  owner: string;
  repo: string;
}

/** github.com/{owner}/{repo}[/anything] → the repo; null for any other shape or host. */
export function parseGithubRepo(url: string): GithubRepoRef | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (u.hostname.toLowerCase() !== "github.com" && u.hostname.toLowerCase() !== "www.github.com") return null;
  const parts = u.pathname.split("/").filter(Boolean);
  if (parts.length < 2) return null;
  const owner = parts[0]!;
  const repo = parts[1]!.replace(/\.git$/i, "");
  if (!/^[A-Za-z0-9_.-]+$/.test(owner) || !/^[A-Za-z0-9_.-]+$/.test(repo)) return null;
  // reserved top-level paths are not repositories
  if (["settings", "orgs", "marketplace", "explore", "topics", "sponsors", "features", "login", "join"].includes(owner.toLowerCase())) return null;
  return { owner, repo };
}

export interface ProvenanceSignal {
  /** audit-side reason. */
  reason: string;
  /** leak-safe, founder/tester-readable line. */
  publicDetail: string;
}

export interface ProvenanceCheck {
  /** a held signal, or null when the repository looks like the submitter's own fresh work. */
  signal: ProvenanceSignal | null;
  /** set when the API could not be consulted — no signal was derived, and none should be inferred. */
  degraded?: string;
  /** the facts read, for the audit trail (never written to a tester-facing surface). */
  facts?: { fork: boolean; createdAt: string; pushedAt: string | null };
}

/** How much older than the campaign a repository may be and still count as work done FOR it. */
export const PREDATE_GRACE_SECONDS = 24 * 3600;

export async function checkGithubProvenance(
  url: string,
  opts: { campaignCreatedAt: number; fetchImpl?: typeof fetch; token?: string | null },
): Promise<ProvenanceCheck> {
  const ref = parseGithubRepo(url);
  if (!ref) return { signal: null, degraded: "not a github repository url" };
  const f = opts.fetchImpl ?? fetch;
  const headers: Record<string, string> = { Accept: "application/vnd.github+json", "User-Agent": "sagepays-work-proof" };
  const token = opts.token === undefined ? process.env.GITHUB_TOKEN?.trim() : opts.token ?? undefined;
  if (token) headers.Authorization = `Bearer ${token}`;
  let res: Response;
  try {
    res = await f(`https://api.github.com/repos/${ref.owner}/${ref.repo}`, { headers, redirect: "follow" });
  } catch {
    return { signal: null, degraded: "github api unreachable" };
  }
  if (res.status !== 200) return { signal: null, degraded: `github api status ${res.status}` };
  let body: { fork?: unknown; created_at?: unknown; pushed_at?: unknown };
  try {
    body = (await res.json()) as typeof body;
  } catch {
    return { signal: null, degraded: "github api returned no json" };
  }
  const fork = body.fork === true;
  const createdAt = typeof body.created_at === "string" ? body.created_at : "";
  const pushedAt = typeof body.pushed_at === "string" ? body.pushed_at : null;
  const facts = { fork, createdAt, pushedAt };
  if (fork) {
    return {
      signal: {
        reason: `repository is a fork (${ref.owner}/${ref.repo})`,
        publicDetail: "This repository is a fork of another repository, so Sage can't treat it as work created for this gig — held for the founder's review.",
      },
      facts,
    };
  }
  const createdUnix = createdAt ? Math.floor(Date.parse(createdAt) / 1000) : NaN;
  if (Number.isFinite(createdUnix) && createdUnix < opts.campaignCreatedAt - PREDATE_GRACE_SECONDS) {
    return {
      signal: {
        reason: `repository created ${createdAt}, before the campaign`,
        publicDetail: "This repository existed before this gig did, so Sage can't treat it as work created for it — held for the founder's review.",
      },
      facts,
    };
  }
  return { signal: null, facts };
}

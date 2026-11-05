/**
 * WHAT SAGE SEES, PER PLATFORM — one source of truth (6 Nov 2026).
 *
 * Sage Bench's payability audit (r9, Opus reading 168 launched jobs as the worker and as the check) found most
 * failures in one place: the job asked for something Sage cannot see. A criterion about a video's picture
 * (Sage reads its title, description, length and time), a Doc's images (it reads the text), a Sheet's notes or
 * other tabs (it reads one tab's cells), a Figma canvas (it reads the file's name). Or the steps put the
 * worker's wallet where the check never looks. Each made honest work unpayable, whatever the site.
 *
 * So what each platform shows is written ONCE, here, and every door reads it: the drafter's prompt, the
 * composer's wallet line and criterion, the feasibility check, and the bench's auditor. The reader
 * (read/page-reader.ts) is what actually reads; this says, in words, what that reading contains.
 */
import type { ReadKind } from "@/lib/read/page-reader";

export interface PlatformSight {
  /** what Sage's check and judge can read there, in words a founder or a worker understands */
  sees: string;
  /** where a worker types their wallet address so the check finds it */
  walletGoes: string;
  /** does the platform report when it was published (so "after the job went live" can be checked) */
  showsTime: boolean;
}

export const SIGHT: Record<Exclude<ReadKind, never>, PlatformSight> = {
  // the reader fetches /pulls/<n>/files with each file's patch (page-reader.ts), up to 30 files
  github_pull: { sees: "the pull request's title, description, target repository, whether it is merged, and the diff of each changed file (what was added and removed)", walletGoes: "in the pull request description", showsTime: true },
  github_issue: { sees: "the issue's title, text and comments", walletGoes: "in the issue or comment text", showsTime: true },
  github_repo: { sees: "the repository's README and file list", walletGoes: "in the README", showsTime: false },
  github_file: { sees: "the file's text", walletGoes: "in the file's text", showsTime: false },
  gist: { sees: "the gist's text", walletGoes: "in the gist's text", showsTime: false },
  google_doc: { sees: "the document's text (not its images, comments or version history)", walletGoes: "typed in the document's text", showsTime: false },
  google_sheet: { sees: "the cell values of the ONE tab the link opens (not notes, comments, or other tabs)", walletGoes: "typed in a cell on that same tab, such as A1", showsTime: false },
  google_slides: { sees: "the text on the slides (not images)", walletGoes: "typed on the first slide", showsTime: false },
  social_post: { sees: "the post's text, author and time", walletGoes: "in the post's text", showsTime: true },
  video: { sees: "the title, description, length and publish time, never the picture or the sound", walletGoes: "in the description", showsTime: true },
  design: { sees: "the file's name and owner, never the canvas", walletGoes: "in the file's name", showsTime: false },
  forum_post: { sees: "the post's text, author and time", walletGoes: "in the post's text", showsTime: true },
  page: { sees: "the page as a visitor sees it, one page only (Sage runs its scripts when it has to)", walletGoes: "visibly on the page", showsTime: false },
};

/**
 * Where work is KEPT but Sage cannot read it: a folder or an app's own view shows nothing a person can read
 * without signing in or running the app. Ask for a Google Sheet or Doc that lists the files (with links) or the
 * rows instead. Never a site rule about a job; a capability, like UNREADABLE_HOSTS.
 */
export const STORAGE_OR_APP_HOSTS = [
  "drive.google.com", "dropbox.com", "airtable.com", "box.com", "onedrive.live.com", "1drv.ms", "sharepoint.com",
  "icloud.com", "wetransfer.com", "discord.com", "discord.gg", "web.whatsapp.com", "whatsapp.com", "t.me", "slack.com",
];

export const onHost = (host: string, list: readonly string[]) => {
  const h = host.trim().toLowerCase().replace(/^www\./, "");
  return list.some((x) => h === x || h.endsWith(`.${x}`));
};

const HOST_KIND: [RegExp, ReadKind][] = [
  [/^docs\.google\.com$/, "google_doc"],
  [/^(?:x|twitter)\.com$|^bsky\.app$/, "social_post"],
  [/^(?:youtube\.com|youtu\.be|vimeo\.com|loom\.com|tiktok\.com|open\.spotify\.com|soundcloud\.com)$/, "video"],
  [/^figma\.com$/, "design"],
  [/^(?:reddit\.com|news\.ycombinator\.com)$/, "forum_post"],
  [/^gist\.github\.com$/, "gist"],
  [/^github\.com$/, "github_repo"],
];

/**
 * The platform a proof lives on, from what the job says about it: a merged pull request, a sheet with rows,
 * a single named host. Null when the work may live anywhere (any public page).
 */
export function proofPlatform(e: { allowedHosts?: readonly string[]; prMerged?: boolean; minRows?: number; minDurationSeconds?: number }): ReadKind | null {
  if (e.prMerged) return "github_pull";
  if (e.minRows) return "google_sheet";
  if (e.minDurationSeconds) return "video";
  const hosts = (e.allowedHosts ?? []).map((h) => h.trim().toLowerCase().replace(/^www\./, ""));
  if (hosts.length !== 1) return null;
  return HOST_KIND.find(([re]) => re.test(hosts[0]!))?.[1] ?? "page";
}

/** The sentence the worker reads: where their wallet goes on this platform. */
export function walletLine(e: Parameters<typeof proofPlatform>[0]): string {
  const p = proofPlatform(e);
  return p ? `Put your full wallet address ${SIGHT[p].walletGoes}: that is how Sage knows the work is yours.` : "Put your full wallet address visibly in the work you submit: that is how Sage knows it is yours.";
}

/** The automatic criterion, worded for where the check actually looks. */
export function markerCriterion(e: Parameters<typeof proofPlatform>[0]): string {
  switch (proofPlatform(e)) {
    case "github_pull":
      return "The pull request description carries the submitting wallet address";
    case "google_sheet":
      return "The linked tab shows the submitting wallet address in a cell";
    case "video":
      return "The video description carries the submitting wallet address";
    case "social_post":
    case "forum_post":
      return "The post carries the submitting wallet address";
    case "design":
      return "The file's name carries the submitting wallet address";
    default:
      return "The page carries the submitting wallet address";
  }
}

/** The whole table, as the drafter and the auditor read it. Generated, so it can never drift from SIGHT. */
export function whatSageSeesText(): string {
  const rows: [string, ReadKind][] = [
    ["a GitHub pull request", "github_pull"],
    ["a GitHub issue", "github_issue"],
    ["a GitHub repository", "github_repo"],
    ["a file on GitHub, or a gist", "github_file"],
    ["a Google Doc (shared: anyone with the link)", "google_doc"],
    ["a Google Sheet (shared: anyone with the link)", "google_sheet"],
    ["Google Slides", "google_slides"],
    ["a post on X or Bluesky", "social_post"],
    ["a video on YouTube, Vimeo, Loom or TikTok, or audio on Spotify or SoundCloud", "video"],
    ["a Figma file", "design"],
    ["a Reddit or Hacker News post", "forum_post"],
    ["any other public page", "page"],
  ];
  return [
    ...rows.map(([what, k]) => `· ${what}: Sage sees ${SIGHT[k].sees}. The wallet goes ${SIGHT[k].walletGoes}.`),
    `· Sage cannot open: Instagram, Facebook, Threads or LinkedIn; anything behind a sign-in; folders and app views (${STORAGE_OR_APP_HOSTS.slice(0, 9).join(", ")} and the like); emails, DMs, private groups; physical things.`,
  ].join("\n");
}

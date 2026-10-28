import { fetchEvidence, type EvidenceResult } from "@/lib/deputy/evidence";
import { firstUrl, labelFor } from "./hand-over-text";

/**
 * HAND IT TO SAGE: READ WHAT WAS HANDED OVER (28 Oct 2026).
 *
 * The founder, on the composer: "currently pay for work looks so packed", and of chat boxes: "simple
 * type to agent got too common that no one uses". The work people want done is usually written down
 * already: an issue, a doc, a page. So Post takes the link and Sage reads it itself, the way a person
 * handed the same link would, then drafts the job from it.
 *
 * The page is read with the same fetcher the judge reads evidence with (public addresses only, capped,
 * redirects checked), and it reaches the model fenced as UNTRUSTED (gig-draft.ts). It describes the
 * work; it never sets the money. A GitHub issue is read through GitHub's API, a Google Doc as its plain
 * text export, so Sage reads the words and not the site around them.
 */
export interface HandedOver {
  url: string;
  /** how the page is named back to the founder: "github.com/acme/app/issues/42" */
  label: string;
  read: boolean;
  /** what Sage read, capped; empty when it could not read it */
  text: string;
  /** why it could not, in plain words */
  reason: string | null;
}

export const MAX_SOURCE_CHARS = 6000;
const GITHUB_TIMEOUT_MS = 5000;

export interface HandedOverDeps {
  fetchEvidence?: (url: string) => Promise<EvidenceResult>;
  fetchImpl?: typeof fetch;
}

const GITHUB_ITEM = /^https:\/\/github\.com\/([\w.-]+)\/([\w.-]+)\/(issues|pull)\/(\d+)/i;
const GOOGLE_DOC = /^https:\/\/docs\.google\.com\/document\/d\/([\w-]+)/i;

export async function readHandedOver(text: string, deps: HandedOverDeps = {}): Promise<HandedOver | null> {
  const url = firstUrl(text);
  if (!url) return null;
  const label = labelFor(url);
  const done = (body: string): HandedOver => {
    const t = body.trim();
    if (t.length < 40) return { url, label, read: false, text: "", reason: "it had no readable text (it may need a sign-in)" };
    return { url, label, read: true, text: t.slice(0, MAX_SOURCE_CHARS), reason: null };
  };
  const failed = (reason: string): HandedOver => ({ url, label, read: false, text: "", reason });

  const gh = GITHUB_ITEM.exec(url);
  if (gh) {
    const [, owner, repo, kind, num] = gh;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), GITHUB_TIMEOUT_MS);
    try {
      const res = await (deps.fetchImpl ?? fetch)(`https://api.github.com/repos/${owner}/${repo}/issues/${num}`, {
        signal: controller.signal,
        headers: {
          accept: "application/vnd.github+json",
          "user-agent": "Sage (+https://sagepays.xyz)",
          ...(process.env.GITHUB_TOKEN ? { authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {}),
        },
      });
      if (res.status === 404) return failed("the issue wasn't found, or the repository is private");
      if (!res.ok) return failed("GitHub didn't answer just now");
      const j = (await res.json()) as { title?: string; body?: string | null; state?: string; labels?: { name?: string }[] };
      const labels = (j.labels ?? []).map((l) => l.name).filter(Boolean);
      return done(
        [
          `${kind === "pull" ? "Pull request" : "Issue"} #${num} in ${owner}/${repo}: ${j.title ?? ""}`,
          j.state ? `State: ${j.state}` : "",
          labels.length ? `Labels: ${labels.join(", ")}` : "",
          "",
          j.body ?? "",
        ].join("\n"),
      );
    } catch (e) {
      return failed(e instanceof Error && /abort/i.test(e.message) ? "GitHub took too long to answer" : "GitHub couldn't be reached");
    } finally {
      clearTimeout(timer);
    }
  }

  const doc = GOOGLE_DOC.exec(url);
  const target = doc ? `https://docs.google.com/document/d/${doc[1]}/export?format=txt` : url;
  const r = await (deps.fetchEvidence ?? fetchEvidence)(target);
  if (!r.ok) return failed(plainReason(r.failReason ?? "", !!doc));
  // a doc nobody shared answers with Google's sign-in page, not an error: that page is not the work
  if (doc && /sign in|accounts\.google\.com|to continue to (google )?docs/i.test(r.text.slice(0, 600))) return failed("the doc isn't shared with anyone who has the link");
  return done(r.text);
}

/** The fetcher's reason, as a founder would say it. */
function plainReason(failReason: string, isDoc: boolean): string {
  if (/blocked/i.test(failReason)) return "it isn't a public address";
  if (/timeout/i.test(failReason)) return "it took too long to open";
  if (/\b40[13]\b/.test(failReason) || (isDoc && /\b40\d\b/.test(failReason))) return isDoc ? "the doc isn't shared with anyone who has the link" : "it needs a sign-in";
  if (/\b404\b/.test(failReason)) return "the page wasn't found";
  return "it couldn't be opened";
}

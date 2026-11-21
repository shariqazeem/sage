"use client";

import { useState, type ReactNode } from "react";
import { ArrowUpRight, Check, Copy, Loader2 } from "lucide-react";

import { Button } from "@/components/sage/button";
import { short } from "@/lib/format";
import type { KeepPostedContact } from "@/lib/report/keep-posted";
import { count } from "@/lib/site/when";
import type { FirstUsersView } from "@/lib/users";
import { HN_TITLE_MAX, hnSubmit, isEmail, linkedinShare, mailto, redditSubmit, telegramShare, whatsappShare, xIntent, xProfile } from "@/lib/users/links";
import { X_POST_MAX, xLength } from "@/lib/x/prices";
import { Stage } from "./parts";

/**
 * GET YOUR FIRST USERS (21 Nov 2026): the owner's stage after the findings.
 *
 * Sage did the work (it counted what people did and kept what they wrote) and hands it over as words
 * the builder can post in their own voice, linking their own product. Four parts, top to bottom:
 * post it, tell the testers who asked, where people like yours gather, and what Sage shares itself.
 *
 * NOTHING HERE SENDS ANYTHING. Every button opens the channel's own compose screen, or the builder's
 * own mail app, with the words filled in; the builder reads them and presses send there. The words are
 * theirs to change first: an edit stays put when the page reads the test again.
 */
type Field = "post" | "long" | "redditTitle" | "hnTitle" | "emailSubject" | "tellSubject" | "tellBody";

function useCopied(): [boolean, (text: string) => void] {
  const [copied, setCopied] = useState(false);
  const copy = (text: string) => {
    void navigator.clipboard?.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    });
  };
  return [copied, copy];
}

function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [copied, copy] = useCopied();
  return (
    <Button variant="quiet" size="sm" onClick={() => copy(text)}>
      {copied ? <Check size={14} aria-hidden /> : <Copy size={14} aria-hidden />}
      {copied ? "Copied" : label}
    </Button>
  );
}

/** A door out: the channel's own compose screen, in a new tab. A mail link opens the mail app instead. */
function Go({ href, children, onClick }: { href: string; children: ReactNode; onClick?: () => void }) {
  const mail = href.startsWith("mailto:");
  return (
    <a className="sg-btn" data-variant="quiet" data-size="sm" href={href} target={mail ? undefined : "_blank"} rel={mail ? undefined : "noreferrer noopener"} onClick={onClick}>
      {children} <ArrowUpRight size={14} aria-hidden />
    </a>
  );
}

function Part({ title, meta, children }: { title: string; meta?: ReactNode; children: ReactNode }) {
  return (
    <div className="sg-u-part">
      <div className="sg-u-part-head">
        <h3 className="sg-u-part-title">{title}</h3>
        {meta ? <span className="sg-u-count">{meta}</span> : null}
      </div>
      {children}
    </div>
  );
}

export function FirstUsers({
  campaignId,
  users: seeded,
  contacts,
  wanted,
  children,
}: {
  campaignId: string;
  /** null when the test has no product address: there is nothing to send people to */
  users: FirstUsersView | null;
  /** the testers who tapped Keep me posted, for the owner alone */
  contacts: readonly KeepPostedContact[];
  /** how many tapped it (the same people, counted on the server) */
  wanted: number;
  /** what Sage shares itself: the owner's switches */
  children: ReactNode;
}) {
  // a wording the owner just asked for, until the page's own read carries it
  const [reworded, setReworded] = useState<FirstUsersView | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [edits, setEdits] = useState<Partial<Record<Field, string>>>({});
  const [linkedinCopied, copyForLinkedin] = useCopied();

  const users = reworded && seeded && reworded.version === seeded.version && seeded.engine === "plain" ? reworded : seeded;
  const d = users?.drafts ?? null;
  const drafted: Record<Field, string> = {
    post: d?.post ?? "",
    long: d?.long ?? "",
    redditTitle: d?.redditTitle ?? "",
    hnTitle: d?.hnTitle ?? "",
    emailSubject: d?.emailSubject ?? "",
    tellSubject: d?.tell.subject ?? "",
    tellBody: d?.tell.body ?? "",
  };
  const v = (f: Field): string => edits[f] ?? drafted[f];
  const set = (f: Field) => (e: { currentTarget: { value: string } }) => setEdits((was) => ({ ...was, [f]: e.currentTarget.value }));
  const edited = Object.keys(edits).length > 0;

  const reword = async () => {
    setBusy(true);
    setNote(null);
    try {
      const res = await fetch(`/api/campaigns/${campaignId}/users`, { method: "POST" });
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; users?: FirstUsersView };
      if (res.ok && data.ok && data.users) {
        setReworded(data.users);
        setNote(data.users.engine === "plain" ? "Sage couldn't reword them just now, so these are still its plain drafts. They are complete as they are." : null);
      } else setNote("Sage couldn't reword them just now. The drafts below are complete as they are.");
    } catch {
      setNote("Sage couldn't be reached. The drafts below are complete as they are.");
    }
    setBusy(false);
  };

  const emails = contacts.filter((c) => c.kind === "email" && isEmail(c.contact)).map((c) => c.contact);
  const handles = contacts.filter((c) => c.kind === "x").length;
  const wallets = contacts.filter((c) => c.kind === "wallet").length;
  const reachable = emails.length + handles;
  const xCount = xLength(v("post"));

  return (
    <Stage state={users?.hasFindings ? "now" : "next"} title="Get your first users" id="users">
      <p className="sg-small">
        {users
          ? users.hasFindings
            ? "Sage wrote these from this test: each number is counted from paid answers, and a quote is exactly what one person wrote. They link your product, in your voice. Change anything. Nothing is sent until you send it."
            : users.open
              ? "While places are open, these ask people to try your product. When the test is done they turn into what people found: posting answers earlier would hand them to the next tester. Nothing is sent until you send it."
              : "Nobody was paid on this test, so these ask people to try your product. Nothing is sent until you send it."
          : "This test has no product address, so there is nothing to send people to yet."}
      </p>

      {users && d ? (
        <Part title={users.hasFindings ? "Post what you learned" : "Ask people to try it"}>
          <div className="sg-u-draft">
            <label className="sg-label" htmlFor="u-post">
              The short one
            </label>
            <textarea id="u-post" className="sg-t-area" rows={6} value={v("post")} onChange={set("post")} />
            <div className="sg-u-foot">
              <div className="sg-t-share">
                <Go href={xIntent(v("post"))}>Post on X</Go>
                <Go href={telegramShare(users.productUrl, v("post"))}>Telegram</Go>
                <Go href={whatsappShare(v("post"))}>WhatsApp</Go>
                <CopyButton text={v("post")} />
              </div>
              <span className={xCount > X_POST_MAX ? "sg-u-count sg-note-problem" : "sg-u-count"} aria-live="polite">
                {xCount} of {X_POST_MAX} on X
              </span>
            </div>
          </div>

          <div className="sg-u-draft">
            <label className="sg-label" htmlFor="u-long">
              The long one
            </label>
            <textarea id="u-long" className="sg-t-area" rows={10} value={v("long")} onChange={set("long")} />
            <div className="sg-t-share">
              <Go href={linkedinShare(users.productUrl)} onClick={() => copyForLinkedin(v("long"))}>
                {linkedinCopied ? "Copied. Paste it there" : "Copy, then open LinkedIn"}
              </Go>
              <Go href={mailto({ subject: v("emailSubject"), body: v("long") })}>Email it</Go>
              <CopyButton text={v("long")} />
            </div>
            <p className="sg-small">LinkedIn&apos;s share screen takes only a link, so the words are copied for you to paste.</p>
          </div>

          <div className="sg-u-draft">
            <label className="sg-label" htmlFor="u-reddit">
              As a link post on Reddit
            </label>
            <div className="sg-u-line">
              <input id="u-reddit" className="sg-field sg-u-words" value={v("redditTitle")} onChange={set("redditTitle")} />
              <Go href={redditSubmit(users.productUrl, v("redditTitle"))}>Reddit</Go>
            </div>
            <p className="sg-small">Reddit asks you to choose the community. Check its rule on your own work first: some are listed below.</p>
          </div>

          {d.hnTitle !== null ? (
            <div className="sg-u-draft">
              <label className="sg-label" htmlFor="u-hn">
                As a Show HN
              </label>
              <div className="sg-u-line">
                <input id="u-hn" className="sg-field sg-u-words" value={v("hnTitle")} onChange={set("hnTitle")} />
                <Go href={hnSubmit(users.productUrl, v("hnTitle"))}>Hacker News</Go>
              </div>
              <p className={v("hnTitle").length > HN_TITLE_MAX ? "sg-small sg-note-problem" : "sg-small"}>
                <span className="sg-n">
                  {v("hnTitle").length} of {HN_TITLE_MAX}
                </span>{" "}
                characters. Only if people can try it right now, with no waitlist.
              </p>
            </div>
          ) : null}

          {users.canReword || edited || note ? (
            <div className="sg-t-share">
              {users.canReword ? (
                <Button variant="quiet" size="sm" disabled={busy} onClick={() => void reword()}>
                  {busy ? <Loader2 size={14} className="sg-spin" aria-hidden /> : null}
                  {busy ? "Sage is rewording them" : "Have Sage reword them"}
                </Button>
              ) : null}
              {edited ? (
                <Button variant="plain" size="sm" onClick={() => setEdits({})}>
                  Undo my changes
                </Button>
              ) : null}
            </div>
          ) : null}
          {note ? (
            <p className="sg-small" role="status">
              {note}
            </p>
          ) : null}
        </Part>
      ) : null}

      <Part title="Tell the people who asked" meta={wanted > 0 ? count(wanted, "person", "people") : null}>
        {contacts.length > 0 ? (
          <>
            <ul className="sg-t-contacts">
              {contacts.map((c) => {
                const profile = c.kind === "x" ? xProfile(c.contact) : null;
                return (
                  <li key={c.submissionId}>
                    {profile ? (
                      <a className="sg-link" href={profile} target="_blank" rel="noreferrer noopener">
                        {c.contact}
                      </a>
                    ) : c.kind === "wallet" ? (
                      short(c.contact)
                    ) : (
                      c.contact
                    )}
                    <span>{c.kind === "x" ? "X" : c.kind === "wallet" ? "wallet only" : c.kind}</span>
                  </li>
                );
              })}
            </ul>
            <p className="sg-small">Each of them tapped Keep me posted after trying it. Only you see this.</p>
            {d && reachable > 0 ? (
              <div className="sg-u-draft">
                <label className="sg-label" htmlFor="u-tell-subject">
                  Your note to them
                </label>
                <input id="u-tell-subject" className="sg-field sg-u-words" aria-label="Subject" value={v("tellSubject")} onChange={set("tellSubject")} />
                <textarea id="u-tell-body" className="sg-t-area" rows={9} aria-label="Your note" value={v("tellBody")} onChange={set("tellBody")} />
                <div className="sg-t-share">
                  {emails.length > 0 ? <Go href={mailto({ bcc: emails, subject: v("tellSubject"), body: v("tellBody") })}>Email {emails.length === 1 ? "them" : `all ${emails.length}`}</Go> : null}
                  <CopyButton text={v("tellBody")} label="Copy the note" />
                </div>
                <p className="sg-small">
                  {emails.length > 0 ? "The email opens in your own mail app with everyone in BCC, so nobody sees another person's address. " : ""}
                  {handles > 0 ? "On X, open a person's profile above and paste the note. " : ""}
                  {wallets > 0 ? `${count(wallets, "person", "people")} left only a wallet, and a wallet can't be written to.` : ""}
                </p>
              </div>
            ) : wallets > 0 ? (
              <p className="sg-small">A wallet can&apos;t be written to. Someone who leaves an email or an X handle can.</p>
            ) : null}
          </>
        ) : (
          <p className="sg-small">A tester who liked it can tap Keep me posted. Whoever does appears here, for you alone, with a note ready to send them.</p>
        )}
      </Part>

      {users && users.venues.length > 0 ? (
        <Part title="Where your users are">
          <ul className="sg-u-venues">
            {users.venues.map((venue) => (
              <li key={venue.name}>
                <a className="sg-link" href={venue.url} target="_blank" rel="noreferrer noopener">
                  {venue.name} <ArrowUpRight size={14} aria-hidden />
                </a>
                <p>{venue.rule}</p>
              </li>
            ))}
          </ul>
          <p className="sg-small">Places where people who try things like yours gather, with each one&apos;s rule on showing your own work. A community&apos;s own rules have the last word: read them before you post.</p>
        </Part>
      ) : null}

      <Part title="Sage shares it too">{children}</Part>
    </Stage>
  );
}

/**
 * WHERE A DRAFT GOES: each channel's own free share link (21 Nov 2026).
 *
 * Every one of these opens the channel's own compose screen in the builder's own account, with the text
 * filled in and nothing sent. No API key, no token held by Sage, no cost per post. Pure, so the same
 * functions run on the server and in the page as the builder edits.
 *
 * THE SEAM FOR A CONNECTED ACCOUNT. Posting through the builder's own X account (OAuth 2.0 with PKCE,
 * `tweet.write`) is not built: it needs the founder's X developer app, token custody and a price per post.
 * When it is, it is a second `PostDoor` beside "intent"; nothing else in this stage changes.
 */
export type PostDoor = "intent";
export const POST_DOOR: PostDoor = "intent";

/** A Show HN title, by Hacker News's own limit. */
export const HN_TITLE_MAX = 80;

const enc = encodeURIComponent;

export const xIntent = (text: string): string => `https://x.com/intent/post?text=${enc(text)}`;

/** LinkedIn's share link takes a URL and nothing else: the words are copied first, then pasted there. */
export const linkedinShare = (url: string): string => `https://www.linkedin.com/sharing/share-offsite/?url=${enc(url)}`;

export const redditSubmit = (url: string, title: string): string => `https://www.reddit.com/submit?url=${enc(url)}&title=${enc(title)}`;

export const hnSubmit = (url: string, title: string): string => `https://news.ycombinator.com/submitlink?u=${enc(url)}&t=${enc(title)}`;

/** Telegram takes the link by itself, so it is lifted out of the words rather than sent twice. */
export function telegramShare(url: string, text: string): string {
  const words = text.split(url).join(" ").replace(/[ \t]+\n/g, "\n").trim();
  return `https://t.me/share/url?url=${enc(url)}&text=${enc(words)}`;
}

export const whatsappShare = (text: string): string => `https://wa.me/?text=${enc(text)}`;

const EMAIL = /^[^\s@,;<>()"]+@[^\s@,;<>()"]+\.[^\s@,;<>()"]+$/;
export const isEmail = (s: string): boolean => EMAIL.test(s.trim());

/**
 * An email in the builder's own mail app. People written to together go in BCC, so none of them sees
 * another's address. Anything that is not an address is left out.
 */
export function mailto(input: { bcc?: readonly string[]; subject: string; body: string }): string {
  const bcc = [...new Set((input.bcc ?? []).map((a) => a.trim()).filter(isEmail))];
  const parts = [...(bcc.length > 0 ? [`bcc=${bcc.map(enc).join(",")}`] : []), `subject=${enc(input.subject)}`, `body=${enc(input.body.replace(/\r?\n/g, "\r\n"))}`];
  return `mailto:?${parts.join("&")}`;
}

/** An X handle's profile, or null when the stored contact is not a handle. */
export function xProfile(contact: string): string | null {
  const handle = contact.trim().replace(/^@/, "");
  return /^[A-Za-z0-9_]{1,15}$/.test(handle) ? `https://x.com/${handle}` : null;
}

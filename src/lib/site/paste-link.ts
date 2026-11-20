/**
 * WHAT SOMEONE PASTED, AS A LINK. People paste "myapp.com", "www.myapp.com/pricing" and
 * "https://myapp.com" and mean the same thing, so a bare domain gets https. Anything that is not a
 * web address with a real hostname is null: the server validates again (and guards against private
 * hosts); this only saves a round trip and a sign-in for something that could never be opened.
 */
export function pastedLink(raw: string): string | null {
  const text = raw.trim();
  if (!text || /\s/.test(text)) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `https://${text}`;
  try {
    const url = new URL(withScheme);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    if (url.username || url.password) return null;
    // a name with a dot and a top-level part: "localhost" and "myapp" are not products on the web
    if (!/^([a-z0-9-]+\.)+[a-z]{2,}$/i.test(url.hostname)) return null;
    return url.toString();
  } catch {
    return null;
  }
}

/** The default test: 10 people, $2.00 each. The budget compiler still sets every reward. */
export const DEFAULT_TEST = { people: 10, eachUsd: 2, budgetUsd: 20 } as const;

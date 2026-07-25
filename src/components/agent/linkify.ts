/**
 * Sentence punctuation that follows a URL is part of the SENTENCE, not the link.
 *
 * The agent writes "…you can approve and fund the campaign at https://sagepays.xyz/launch/<id>."
 * and the greedy URL match took the full stop with it — so the one click that matters, the founder
 * going to approve and fund their plan, landed on a 404. A closing bracket only belongs to the link
 * when its opener is inside it.
 *
 * Pure and dependency-free so it can be tested without loading the chat component.
 */
export function trimUrlPunctuation(url: string): string {
  let end = url.length;
  while (end > 0) {
    const c = url[end - 1]!;
    if (".,;:!?'\"".includes(c)) {
      end--;
      continue;
    }
    if (c === ")" || c === "]" || c === "}") {
      const open = c === ")" ? "(" : c === "]" ? "[" : "{";
      const slice = url.slice(0, end);
      const opens = slice.split(open).length - 1;
      const closes = slice.split(c).length - 1;
      if (closes > opens) {
        end--;
        continue;
      }
    }
    break;
  }
  return url.slice(0, end);
}

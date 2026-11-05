/**
 * WORK SAGE WILL NOT POST, said plainly, on every door.
 *
 * The drafter declines deceptive, fraudulent and harmful work in its own words (gig-draft.ts). This is the
 * deterministic backstop for the clearest cases, which no model and no door should be able to post: the
 * web composer, the Telegram concierge, MCP and the Agent API all reach the compiler, so the compiler asks
 * here too.
 *
 * Every rule is narrow on purpose. A refusal of legitimate work is a failure too: "an honest review from
 * someone who used it, with the payment disclosed" must pass while "5-star reviews, they don't need to
 * have eaten here" must not. Measured against all 180 Sage Bench scenarios, the rules refuse only work the
 * corpus marks for refusal. Each message says what Sage won't do and, when there is one, the honest version.
 */
const RULES: { re: RegExp; says: string }[] = [
  {
    re: /\b(?:5|five)[\s-]*stars?\b[^.!?\n]{0,90}\breviews?\b|\breviews?\b[^.!?\n]{0,90}\b(?:5|five)[\s-]*stars?\b|\bfake (?:reviews?|testimonials?)\b|\b(?:5|five)[\s-]*stars?\b[^.!?\n]{0,60}\b(?:comments?|ratings?)\b/i,
    says: "Sage won't pay for star ratings or reviews written to order: it misleads buyers and breaks every review platform's rules. If you want honest reviews from people who really used it, with the payment disclosed, describe that instead.",
  },
  {
    re: /\b(?:aged|fresh|new|burner|throwaway)\s+(?:\w+\s+){0,2}accounts?\b[^.!?\n]{0,90}\b(?:upvot\w*|votes?|reviews?|follow\w*|likes?|comments?)\b|\b(?:upvot\w*|votes?)\b[^.!?\n]{0,90}\b(?:aged|fresh|new|burner)\s+(?:\w+\s+){0,2}accounts?\b|\bVPNs?\b[^.!?\n]{0,60}\b(?:upvot\w*|farm|reviews?)\b|\b(?:upvot\w*|reviews?)\b[^.!?\n]{0,60}\bVPNs?\b/i,
    says: "Sage won't pay for votes, followers or comments from accounts set up to game a platform. Pay for something real instead, such as a post people choose to engage with, or a review of the product someone actually used.",
  },
  {
    // ACTIONS only: honest briefs name these to FORBID them ("sybil farming gets you disqualified",
    // "flag wash trading"), so the bare words "sybil" or "wash trading" are never grounds on their own.
    re: /\bround[\s-]*trip\s+swaps?\b|\bbuy\s+(?:then|and)\s+sell\s+(?:it\s+)?(?:right\s+)?back\b|\b(?:so\s+(?:the\s+)?volume\s+looks)\b|\b(?:spin\s+up|create|generate|make|cycle|rotate|run|operate)\b[^.!?\n]{0,40}\b(?:~\s*)?\d[\d,]*\+?\s+(?:fresh\s+|new\s+|burner\s+)?wallets?\b[^.!?\n]{0,160}\b(?:airdrop|snapshot|points|incentive|volume|faucet)\b/i,
    says: "Sage won't pay one operator to act as many users or to fake volume: that is sybil farming or wash trading, and it defrauds the people relying on those numbers. Pay real people for real use instead, one person each.",
  },
  {
    re: /\bhoneypot\b|\bhidden\s+sell\s+(?:block|tax|lock)\b|\bbackdoor\s+admin\b|\b(?:renounce\w*|renounced)\b[^.!?\n]{0,60}\b(?:look\s+real|fake)\b/i,
    says: "Sage won't pay for a contract with hidden controls that trap buyers. That is a rug pull. An honest token with real, visible ownership is work Sage can post.",
  },
  {
    // academic transcripts only: an interview transcript is everyday work (Sage Bench, 5 Nov 2026)
    re: /\b(?:edit|change|alter|forge|fake)\w*\b[^.!?\n]{0,60}\b(?:bank\s+statements?|pay\s?stubs?|passports?|diplomas?|(?:academic|school|university|college)\s+transcripts?|tax\s+returns?)\b|\b(?:bank\s+statements?|pay\s?stubs?)\b[^.!?\n]{0,60}\b(?:so\s+the\s+balance|shows?\s+around|instead\s+of)\b/i,
    says: "Sage won't pay to alter financial or identity documents: that is forgery.",
  },
  {
    re: /\b(?:find|pull|scrape|dig\s+up|look\s+up|unmask|track\s+down)\b[^.!?\n]{0,120}\b(?:home\s+address(?:es)?|where\s+(?:he|she|they)\s+lives?|personal\s+(?:cell|phone)\s+numbers?)\b|\b(?:home\s+address(?:es)?)\b[^.!?\n]{0,40}\bif\s+you\s+can\s+find\b|\bd[oó]nde\s+vive\b|\bqui[eé]n\s+es\s+en\s+realidad\b/i,
    says: "Sage won't pay anyone to find a private person's home, phone or identity. If someone wronged you, report it to the platform or the authorities.",
  },
  {
    re: /\b(?:write|do|take|complete|ghostwrite)\w*\b[^.!?\n]{0,50}\b(?:my|his|her|their|a\s+student'?s|the\s+student'?s|client'?s)\b[^.!?\n]{0,30}\b(?:exam|homework|assignment|coursework|thesis|dissertation)\b/i,
    says: "Sage won't pay someone to do coursework, an exam or a thesis another person will submit as their own. Tutoring or feedback on their own draft is work Sage can post.",
  },
  {
    re: /\b(?:don'?t|do\s+not|never)\s+(?:mention|say|disclose)\b[^.!?\n]{0,30}\b(?:we|that\s+we|you\s+were|it\s+was)\s+paid\b|\b(?:look|looks|sound|sounds)\s+(?:organic|real)\b[^.!?\n]{0,60}\b(?:review|testimonial|post|comment)s?\b|\b(?:review|testimonial)s?\b[^.!?\n]{0,80}\b(?:look|looks)\s+organic\b/i,
    says: "Sage won't pay for endorsements that hide the payment: that deceives the people reading them and breaks advertising law. Paid posts are fine when they say they were paid.",
  },
];

/** The sentence Sage says when the work is something it won't post, or null when it is fine to draft. */
export function refusedWork(text: string): string | null {
  const t = text.replace(/\s+/g, " ");
  for (const r of RULES) if (r.re.test(t)) return r.says;
  return null;
}

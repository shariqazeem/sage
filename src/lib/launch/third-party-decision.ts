/**
 * Money that releases on someone else's private decision — a bank, a court, an employer, a client.
 *
 * Rule (1) of the concierge's DIRECT_BLOCK, in code, so it holds on every path: the model may be
 * told to refuse-or-ask and still call the tool (Haiku 4.5 did, P-DIRECT 6, 2026-09-05), and the
 * deterministic rung has no model to ask. A page the recipient writes about someone else's decision
 * proves nothing; when the decision produces a public checkable surface, the founder can name THAT.
 */
// "reviewer" left this list (Sage Bench, 5 Nov 2026): "an audit by two reviewers the founder approves" is the
// funder choosing who reviews, not a decision about the worker, and a public review is itself evidence.
const DECIDER =
  "(?:bank|lender|landlord|court|judge|embassy|consulate|university|college|school|admissions?|employer|boss|hr|client|customer|investor|insurer|insurance|government|ministry|council|committee|board|jury|manager|recruiter|banco|prestamista|tribunal|juez|embajada|universidad|cliente|empleador|jefe|gobierno|ministerio|comit[eé]|banque|employeur|ambassade)s?";
/*
  The verbs are DECISIONS about the recipient — approve, accept, hire, admit, award, rule, sign off.
  "Confirm", "issue", "agree" and "clear" were here too, and P-DIRECT 7 (2026-09-05) refused a
  catering grant's "first confirmed booking": a customer confirming a booking is business activity
  the recipient can show, not a gate on someone's judgment of them. The passive pattern below still
  catches "the loan is confirmed".
*/
const DECIDES =
  "(?:approv\\w*|accept\\w*|grant(?:s|ed)?|award\\w*|hir(?:e|es|ed)|admit\\w*|decid\\w*|rul(?:es|ed)|sign(?:s|ed)?\\s+off|says?\\s+yes|green-?light\\w*|apru\\w*|acept\\w*|otorg\\w*|contrat\\w*|conced\\w*|approuv\\w*|accord\\w*|embauch\\w*)";
export const THIRD_PARTY_DECISION_RE = new RegExp(
  `\\b${DECIDER}\\b[^.!?]{0,60}\\b${DECIDES}` +
    `|\\b(?:loan|visa|application|mortgage|claim|permit|licen[cs]e|scholarship|appeal|offer|tender|bid|funding|pr[eé]stamo|visado|solicitud)\\b[^.!?]{0,40}\\b(?:is|gets?|has\\s+been|was|are|sea|est[eé]|quede)\\s+(?:finally\\s+)?(?:approved|accepted|granted|awarded|cleared|confirmed|issued|aprobad[oa]|aceptad[oa]|concedid[oa])` +
    // "contract" here is a client's contract won, never a smart contract fetched: "get the contract's source code"
    // and "get the contract address" are steps of on-chain work (Sage Bench, 5 Nov 2026).
    `|\\b(?:gets?|got|lands?|landed|wins?|won)\\s+(?:the|a|an|her|his|their)\\s+(?:job|loan|visa|permit|mortgage|scholarship|approval|contract(?!'s|\\s+(?:address|source|code|abi|on|at|from|in|to))|offer|promotion|grant)\\b` +
    // A PERSON (or their application) being hired, promoted, admitted, accepted or approved. Not any subject:
    // "the code TESTDRIVE was accepted" at a checkout is a QA check the worker can show, and the bare passive
    // refused a real QA job as "pays on a bank's decision" (Sage Bench, 5 Nov 2026).
    `|\\b(?:i|we|you|he|she|they|him|her|them|my\\s+\\w+|our\\s+\\w+|his\\s+\\w+|their\\s+\\w+|(?:the\\s+)?(?:candidate|applicant|application|student|employee|worker|recipient|grantee))\\s+(?:is|gets?|was|has\\s+been)\\s+(?:hired|promoted|admitted|accepted|approved)\\b` +
    `|\\b(?:le\\s+)?(?:aprueben|apruebe|acepten|acepte|contraten|contrate|concedan|conceda)\\b` +
    `|\\bconsig(?:a|ue|an|uen)\\s+(?:el|un|la|una)\\s+(?:trabajo|pr[eé]stamo|visado|visa|beca)\\b`,
  "i",
);

/** A confirmation on a public chain is a fact anyone can check, the opposite of a private decision. */
const PUBLIC_CHAIN_CONTEXT = /\b(?:transaction|tx|txs|on-?chain|block|blocks|hash|testnet|mainnet|sepolia|metis|ethereum|swap|deposit|stake|unstake|mint)\b/i;

/** True when the words release the money on a third party's private decision. */
export function releasesOnThirdPartyDecision(text: string): boolean {
  const re = new RegExp(THIRD_PARTY_DECISION_RE.source, "gi");
  for (let m = re.exec(text); m; m = re.exec(text)) {
    // "the claim transaction is confirmed on Metis" is a public on-chain fact, not anyone's decision
    if (PUBLIC_CHAIN_CONTEXT.test(m[0])) continue;
    return true;
  }
  return false;
}

/** The one sentence every refusal of this kind says, wherever it is said. */
export const THIRD_PARTY_DECISION_REFUSAL =
  "this pays on a third party's private decision (a bank, a client, an employer), which no page the recipient writes can prove — name the verifiable form the outcome takes (a published listing, an on-chain state, a public confirmation) and Sage can pay on that";

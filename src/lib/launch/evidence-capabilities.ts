/**
 * The evidence capabilities Sage can actually verify — the single source of truth shared by
 * the Mission Architect + Critic prompts (as a trusted platform constraint) and the
 * deterministic mission validator (as a hard gate). A tester submits evidence as a public
 * HTTPS URL + exact quoted text + a structured text observation; Sage fetches the URL
 * (SSRF-guarded) and judges the quoted/observed text against the mission. It CANNOT ingest
 * a screenshot, image, video, uploaded file, or private/authenticated content — so a
 * mission that REQUIRES one of those can never be verified or paid, and must be regenerated
 * before a founder ever sees it. Pure + framework-agnostic.
 */

export const SUPPORTED_EVIDENCE = [
  "a public HTTPS URL to the work",
  "the exact quoted text observed on that URL",
  "a short structured text observation describing what was seen",
] as const;

export const UNSUPPORTED_EVIDENCE = [
  "screenshot",
  "image upload",
  "video / screen recording",
  "arbitrary file / document upload",
  "private or authenticated (logged-in) evidence",
] as const;

/** Prompt-ready constraint block fed to the Architect + Critic. */
export const EVIDENCE_CAPABILITY_PROMPT = [
  "PLATFORM EVIDENCE CONSTRAINT (hard): Sage verifies a submission ONLY from:",
  ...SUPPORTED_EVIDENCE.map((s) => `  - ${s}`),
  "Sage CANNOT ingest any of these, so a mission must NEVER require them as evidence:",
  ...UNSUPPORTED_EVIDENCE.map((s) => `  - ${s}`),
  "Every evidenceRequirement MUST be provable from a public URL + quoted/observed text.",
  "A mission may TEST an interactive/login surface, but its EVIDENCE must still be a public",
  "URL + quoted text + observation — never a screenshot, file, image, video, or logged-in data.",
].join("\n");

/** The unsupported categories, matched conservatively against evidence-requirement prose. */
const PATTERNS: { category: (typeof UNSUPPORTED_EVIDENCE)[number]; re: RegExp }[] = [
  { category: "screenshot", re: /\bscreen[\s-]?shots?\b|\bscreen[\s-]?grabs?\b|\bscreen[\s-]?captures?\b/i },
  { category: "video / screen recording", re: /\bvideos?\b|\bscreen[\s-]?recordings?\b|\brecord(?:ing)?\s+(?:a|the|your)\s+\w+|\.mp4\b|\bgifs?\b/i },
  { category: "image upload", re: /\b(?:upload|attach|provide|submit|include|share|send|paste|capture|take)\b[^.]{0,40}\b(?:image|images|photo|photos|picture|pictures)\b|\.(?:png|jpe?g|gif|webp|heic)\b/i },
  { category: "arbitrary file / document upload", re: /\b(?:upload|attach|submit|provide|include)\b[^.]{0,40}\b(?:files?|documents?|attachments?|pdfs?|recordings?)\b|\.(?:pdf|docx?|xlsx?|zip)\b/i },
  { category: "private or authenticated (logged-in) evidence", re: /\blogged[\s-]?in\b|\bauthenticated\b|\bcredentials?\b|\bbehind a (?:login|paywall)\b|\byour (?:account|dashboard) (?:screenshot|export|data)\b/i },
];

export interface UnsupportedEvidenceHit {
  category: (typeof UNSUPPORTED_EVIDENCE)[number];
  match: string;
  field: string;
}

/**
 * Scan a mission's evidence-bearing prose (its evidenceRequirements, plus any criterion or
 * instruction that demands an artifact as proof) for an UNSUPPORTED evidence type. Returns
 * the first hit or null. Conservative: an image/file only matches under a provision verb or
 * a file extension, so "describe the hero image" is fine but "upload a screenshot" is not.
 */
export function detectUnsupportedEvidence(m: {
  evidenceRequirements: string[];
  criteria?: string[];
  instructions?: string;
}): UnsupportedEvidenceHit | null {
  const fields: { field: string; text: string }[] = [
    ...m.evidenceRequirements.map((e, i) => ({ field: `evidenceRequirements[${i}]`, text: e })),
    ...(m.criteria ?? []).map((c, i) => ({ field: `criteria[${i}]`, text: c })),
    ...(m.instructions ? [{ field: "instructions", text: m.instructions }] : []),
  ];
  for (const { field, text } of fields) {
    for (const { category, re } of PATTERNS) {
      const found = text.match(re);
      if (found) return { category, match: found[0], field };
    }
  }
  return null;
}

/**
 * FIXTURES FOR "A REAL TRY" (22 Nov 2026): the offline measure's products, missions and voices.
 *
 * Four missions, built beside the existing observation fixtures (`observation-fixtures.ts`):
 *
 *   - yara, excalidraw: the two rich interactive products already in the spec. What Sage saw there is
 *     behind clicks, and the card says none of it. The gate must change nothing here.
 *   - frameworks: a RECONSTRUCTION of the 12 Aug 2026 mission that leaked. The production key is not in
 *     the repo, so this one is written to have the same shape: criteria that quote the product's own
 *     words, a public landing page and documentation that repeat them. Its voices are the live eval's
 *     own 8 honest and 4 junk accounts (`tests/live/judge-acceptance-accounts.ts`).
 *   - core: round 2's first-try mission, built by the real `buildCoreMission` on an interactive product
 *     whose header repeats on later screens (as real products' do).
 *
 * Every voice is labelled with what it IS (honest or junk), never with what the code should say: the
 * measure reports what the code says.
 */

import type { FieldTestSummary } from "@/lib/launch/schemas";
import { composeCoreAccount } from "@/lib/core-test/shape";
import { buildCoreMission } from "@/lib/launch/core-mission";
import { JUNK, LEGIT } from "../../../tests/live/judge-acceptance-accounts";
import {
  excalidrawFieldTest,
  excalidrawPublicStrings,
  observationCases,
  yaraFieldTest,
  yaraPublicStrings,
} from "./observation-fixtures";

export interface RealTryVoice {
  name: string;
  honest: boolean;
  /** what kind of answer this is, for the table */
  kind: string;
  account: string;
}

export interface RealTryMission {
  name: string;
  fieldTest: FieldTestSummary;
  /** every string on the mission card */
  publicStrings: string[];
  criteria: string[];
  evidenceRequirements: string[];
  voices: RealTryVoice[];
}

/* ───────────────────────── frameworks: the mission that leaked, reconstructed ───────────────────────── */

const page = (url: string, title: string, h1: string, ctas: string[], text: string) => ({
  url,
  title,
  h1,
  ctas,
  visibleTextExcerpt: text,
  screenshot: null,
  status: 200,
});

export const frameworksFieldTest = {
  ran: true,
  startUrl: "https://clawup.org/",
  mode: "static",
  pages: [
    page(
      "https://clawup.org/",
      "ClawUp",
      "Build and Power Up Your AI Agent",
      ["Start Free"],
      "Works with leading agent frameworks\nOpenClaw and Hermes Agent by Nous Research\n200+ models via Nous Portal and OpenRouter\nInstant launch with memory inheritance",
    ),
    page(
      "https://clawup.org/pricing",
      "Pricing",
      "Simple pay as you go pricing",
      [],
      "Starter tier includes one agent and 100 messages\nCredits are billed per agent call",
    ),
  ],
  states: [],
  classification: "Website · 2 pages",
  limitation: null,
  durationMs: 10,
  docs: [
    { url: "https://docs.clawup.org/quick-start", title: "Quick start", excerpt: "Create account\nCreate your agent\nConnect a channel such as Telegram or Discord", soughtBecause: "sign-in required" },
    { url: "https://docs.clawup.org/hermes", title: "Hermes Agent", excerpt: "Hermes Agent runs on models from Nous Portal\nNous Portal and OpenRouter models are compatible with Hermes Agent", soughtBecause: "sign-in required" },
    { url: "https://docs.clawup.org/openrouter", title: "OpenRouter", excerpt: "OpenRouter gives your agent 200+ models\nNavigate to OpenRouter via the portal link", soughtBecause: "sign-in required" },
    { url: "https://docs.clawup.org/frameworks", title: "Frameworks", excerpt: "Works with leading agent frameworks OpenClaw and Hermes Agent\nThe frameworks section lists every model count", soughtBecause: "sign-in required" },
    { url: "https://docs.clawup.org/models", title: "Models", excerpt: "The portal lists the name of each model available\nAn observed count of models consistent with 200+", soughtBecause: "sign-in required" },
  ],
} as unknown as FieldTestSummary;

const frameworksCriteria = [
  "The tester locates the 'Works with leading agent frameworks' section on https://clawup.org/.",
  "The tester navigates to Nous Portal or OpenRouter via a link in that section.",
  "The tester identifies and quotes the name of at least one model available on the portal that is compatible with Hermes Agent.",
  "The tester reports an observed count of models, confirming whether it is consistent with 200+.",
];

const frameworks: RealTryMission = {
  name: "frameworks (12 Aug, reconstructed)",
  fieldTest: frameworksFieldTest,
  publicStrings: [
    "Check the frameworks claim on ClawUp",
    "Find the agent frameworks section, follow it to the model portal and check the 200+ models claim.",
    "1. Open https://clawup.org/. 2. Find the section about agent frameworks. 3. Follow a link to Nous Portal or OpenRouter. 4. Name one model and count the models.",
    "https://clawup.org/",
    ...frameworksCriteria,
  ],
  criteria: frameworksCriteria,
  evidenceRequirements: [],
  voices: [
    ...LEGIT.map((a) => ({ name: a.name, honest: true, kind: "honest", account: a.note })),
    ...JUNK.map((a) => ({ name: a.name, honest: false, kind: a.name, account: a.note })),
    {
      name: "page-only",
      honest: false,
      kind: "page-only",
      account:
        "ClawUp says Build and Power Up Your AI Agent. It works with leading agent frameworks, OpenClaw and Hermes Agent by Nous Research, with 200+ models via Nous Portal and OpenRouter. There is a Start Free button and instant launch with memory inheritance. The count of models is consistent with 200+.",
    },
  ],
};

/* ───────────────────────────── core: round 2's first-try mission ───────────────────────────── */

const HEADER = "Driftboard Templates Sign in";
const state = (trigger: string, text: string, elements: string[] = []) => ({
  trigger,
  screenshot: null,
  visibleTextExcerpt: text,
  notableElements: elements.map((t) => ({ tag: "button", text: t, role: "button" })),
  pixelDeltaPct: 40,
  url: "https://driftboard.example/",
});

export const driftboardFieldTest = {
  ran: true,
  startUrl: "https://driftboard.example/",
  mode: "interactive",
  pages: [],
  states: [
    state("initial load", `${HEADER}\nPlan anything on one board\nBoards for teams who hate meetings`, ["New board"]),
    state("clicked 'New board'", `${HEADER}\nName your board\nPick a starting layout: Kanban, Timeline or Blank`, ["Untitled board"]),
    state("picked 'Kanban'", `${HEADER}\nThree empty columns: To do, Doing, Done`, ["Add a card"]),
    state("added a card", "Card saved\nDrag cards between columns to reorder", ["Invite teammates"]),
    state("clicked 'Invite teammates'", "Copy share link\nAnyone holding the link can view this board", ["Copy share link"]),
    state("clicked 'Templates'", "Template gallery\nSprint planning, Content calendar, Wedding seating chart", []),
  ],
  classification: "Interactive app · 6 states",
  limitation: null,
  durationMs: 10,
} as unknown as FieldTestSummary;

const coreMission = buildCoreMission(
  { mainAction: "make your first board", startsAt: "New board", from: "model" },
  { productName: "Driftboard", targetSurface: "https://driftboard.example/", anchors: ["New board", "Plan anything on one board"], sources: [] },
);

const core: RealTryMission = {
  name: "core first try",
  fieldTest: driftboardFieldTest,
  publicStrings: [coreMission.title, coreMission.objective, coreMission.instructions, coreMission.targetSurface, ...coreMission.criteria, ...coreMission.evidenceRequirements],
  criteria: coreMission.criteria,
  evidenceRequirements: coreMission.evidenceRequirements,
  voices: [
    {
      name: "finished",
      honest: true,
      kind: "honest",
      account: composeCoreAccount([
        "Driftboard looks like a planning board for small teams that want fewer meetings.",
        "The heading says Plan anything on one board and there is a New board button under it.",
        "I clicked New board. It asked me to name your board, then to pick a starting layout, Kanban, Timeline or Blank. I took Kanban and got three empty columns, To do, Doing and Done. I added a card and it said Card saved. The last button I used was Invite teammates, which gave me Copy share link.",
        "Yes, for a side project. A phone app would make me use it daily.",
      ]),
    },
    {
      name: "stopped-midway",
      honest: true,
      kind: "honest",
      account: composeCoreAccount([
        "Some kind of whiteboard for planning work with a team.",
        "Big line at the top: Plan anything on one board.",
        "Pressed New board and a box came up, name your board, with a starting layout to pick. I chose Kanban and saw three empty columns but I could not work out how to rename them, so I stopped at Add a card.",
        "Maybe. I would need to rename columns.",
      ]),
    },
    {
      name: "own-words",
      honest: true,
      kind: "honest",
      account: composeCoreAccount([
        "A tool where a team keeps its plans in one place instead of talking about them.",
        "It calls itself boards for teams who hate meetings.",
        "I made a board and it wanted a title first, then a layout. I went with the kanban one, three lanes showed up, I typed a task in and it told me the card was saved. I gave up when it wanted me to invite teammates through a share link.",
        "Probably, if it stays this simple.",
      ]),
    },
    {
      name: "stuck-on-first-screen",
      honest: true,
      kind: "honest, never left the first screen",
      account: composeCoreAccount([
        "A planning board for teams who hate meetings.",
        "The heading reads Plan anything on one board, and the menu has Templates and Sign in.",
        "I looked for where to begin and pressed New board but my browser blocked something and nothing opened, so I stopped on the first screen.",
        "Not until it opens for me.",
      ]),
    },
    {
      name: "card-parrot",
      honest: false,
      kind: "card parrot",
      account: composeCoreAccount([
        "In one sentence, I took Driftboard to be a product for a first-time visitor, from the first screen.",
        "I named one specific thing from the first screen that matches what Sage saw there: the words of a heading, a button or a label.",
        "I tried to make your first board, starting from New board. I named the screen or button where I finished or stopped while trying to make your first board, and what happened there.",
        "I would use Driftboard again and I said what would change that.",
      ]),
    },
    {
      name: "page-only",
      honest: false,
      kind: "page-only",
      account: composeCoreAccount([
        "Driftboard is boards for teams who hate meetings.",
        "Plan anything on one board, with New board, Templates and Sign in.",
        "I tried to make my first board starting from New board and it went fine, I finished and nothing stopped or confused me.",
        "Yes I would use Driftboard again.",
      ]),
    },
    {
      // the page's own phrases, thinned with enough of the writer's filler to read as "own words"
      name: "page-only-own-filler",
      honest: false,
      kind: "page-only, thinned with filler",
      account: composeCoreAccount([
        "Honestly my gut feeling after a short while was that this is aimed at small companies, people like my cousin who run a bakery and dislike long calls, though I could be wrong about that.",
        "What caught my eye: Plan anything on one board, Boards for teams who hate meetings, plus New board, Templates and Sign in.",
        "Everything went smoothly for me, quick and painless, no hiccups anywhere, I reached the end without trouble and felt quite pleased about how little effort it took overall.",
        "Sure, probably during busy weeks, especially if my cousin joins too.",
      ]),
    },
    {
      name: "wrong-product",
      honest: false,
      kind: "wrong product",
      account: JUNK.find((j) => j.name === "wrong-product")!.note,
    },
    {
      name: "generic-praise",
      honest: false,
      kind: "generic praise",
      account: JUNK.find((j) => j.name === "generic-praise")!.note,
    },
  ],
};

/* ───────────────────────── yara and excalidraw: the existing spec, unchanged ───────────────────────── */

const fromSpec = (product: "yara" | "excalidraw"): RealTryVoice[] =>
  observationCases
    // an injected or copied answer is stopped by its own layer (the detector, the near-duplicate watch)
    .filter((c) => c.product === product && !c.expect.injection && !c.expect.nearDupOf)
    .map((c) => ({ name: c.label, honest: c.label.startsWith("genuine"), kind: c.label.startsWith("genuine") ? "honest" : c.label.replace(/-(yara|excalidraw)$/, ""), account: c.account }));

const yara: RealTryMission = {
  name: "yara",
  fieldTest: yaraFieldTest,
  publicStrings: yaraPublicStrings,
  criteria: ["Confirm the experience evokes calm and wonder"],
  evidenceRequirements: [],
  voices: fromSpec("yara"),
};

const excalidraw: RealTryMission = {
  name: "excalidraw",
  fieldTest: excalidrawFieldTest,
  publicStrings: excalidrawPublicStrings,
  criteria: ["Confirm a new user can draw something in under a minute"],
  evidenceRequirements: [],
  voices: [
    ...fromSpec("excalidraw"),
    {
      name: "parrot-excalidraw",
      honest: false,
      kind: "card parrot",
      account: "I opened the canvas and created my first shape. I confirm a new user can draw something in under a minute on Excalidraw. I validated the first drawing.",
    },
  ],
};

export const realTryMissions: RealTryMission[] = [yara, excalidraw, frameworks, core];

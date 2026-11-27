import { FLAG_SHARE } from "@/lib/campaigns/builder-flag";
import { emailConfigured } from "@/lib/builder-updates/email-core";
import { DEFAULT_FINALIZE_MINUTES } from "@/lib/deputy/finalization";
import { OBS_MAX_ATTEMPTS } from "@/lib/deputy/observation-verify";
import { identityDoorArmed } from "@/lib/identity/door";
import { socialCeilingBase, socialDoorArmed } from "@/lib/identity/social-door";
import { worldIdConfig } from "@/lib/identity/worldid";
import { NEVER_A_SECRET } from "@/lib/launch/product-kind";
import { DEFAULT_TEST } from "@/lib/site/paste-link";
import { dollars } from "@/lib/site/when";
import { GIFT_TTL_SEC } from "@/lib/test-page/gift-code";
import { EACH_PRESETS_USD, MAX_EACH_BASE, MAX_PLACES_PER_MISSION, MIN_EACH_BASE, PEOPLE_PRESETS, baseToUsd } from "@/lib/test-page/offer-shape";

/**
 * WHAT THE DOCS SAY IN NUMBERS AND SWITCHES, read from the code that enforces each one, so a page cannot
 * drift from the product: the default test, the offer's bounds, the window, the tester's door as this
 * server is configured, and which channels are switched on. No page under /docs writes one of these by hand.
 */
const list = (xs: readonly string[]): string => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} or ${xs[xs.length - 1]}`);

export const TEST = {
  people: DEFAULT_TEST.people,
  each: dollars(DEFAULT_TEST.eachUsd),
  total: dollars(DEFAULT_TEST.budgetUsd),
};
export const OFFER = {
  peopleChoices: list(PEOPLE_PRESETS.map(String)),
  eachChoices: list(EACH_PRESETS_USD.map((u) => dollars(u))),
  minEach: baseToUsd(MIN_EACH_BASE),
  maxEach: baseToUsd(MAX_EACH_BASE),
  placesPerMission: MAX_PLACES_PER_MISSION,
};
export const WINDOW_MINUTES = DEFAULT_FINALIZE_MINUTES;
export const ATTEMPTS = OBS_MAX_ATTEMPTS;
/** "one in 5": the share of a test's places a builder may flag as not a real try. */
export const FLAG_ONE_IN = Math.round(1 / FLAG_SHARE);
export const GIFT_DAYS = Math.round(GIFT_TTL_SEC / 86_400);
export const NEVER_A_SECRET_LINE = NEVER_A_SECRET;

/** Sign in with X shows only where it is switched on (the same build flag the sign-in sheet reads). */
const X_ON = process.env.NEXT_PUBLIC_LOGIN_X === "1";
/** The sign-ins that name one person, as this server offers them. */
export const SOCIAL_SIGN_IN = X_ON ? "Google or X" : "Google";
/** Every way to sign in, for a builder. */
export const BUILDER_SIGN_IN = X_ON ? "an email, Google, X or MetaMask" : "an email, Google or MetaMask";

/** How a public test keeps one person to one place, as this server is configured. */
export function onePlaceLines(): string[] {
  if (socialDoorArmed()) {
    const ceiling = baseToUsd(socialCeilingBase());
    return [
      `A public test gives one place per person, so taking a place asks for a ${SOCIAL_SIGN_IN} sign-in. The same account on a second wallet is the same person.`,
      ...(worldIdConfig() ? [`A test that pays above ${ceiling} each also asks for a one-time World ID check.`] : []),
    ];
  }
  if (identityDoorArmed()) return ["A public test gives one place per person, so taking a place asks for a one-time World ID check. Sage keeps a number tied to that check, never a name or a document."];
  return ["Each wallet takes one place on a mission."];
}

/** Whether a builder can pay from the wallet an email sign-in holds (the offer card reads the same flag). */
export const PAY_FROM_EMAIL_WALLET = process.env.NEXT_PUBLIC_PAY_FROM_EMBEDDED === "1";
/** Whether a launch asked for in the Telegram chat is handed to the web to pay from the builder's own wallet. */
export const TELEGRAM_HANDS_TO_WEB = process.env.TELEGRAM_LAUNCH_ON_WEB?.trim() === "1";
export const EMAIL_UPDATES = emailConfigured();

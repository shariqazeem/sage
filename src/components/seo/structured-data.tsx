import { siteUrl } from "@/lib/site";
import { FAQ } from "@/lib/seo/faq";
import { PLAN_ORDER, PLANS } from "@/lib/plans/catalog";
import { planPriceUsd } from "@/lib/plans/billing-math";

/**
 * STRUCTURED DATA — written for the engines that ANSWER rather than the ones that rank.
 *
 * A search crawler wants keywords. An answer engine wants facts it can restate without being wrong,
 * because it will be quoted and it cannot check. So everything here is a claim Sage can back: the
 * currency it pays in, the chain it settles on, the fact that a payout publishes a receipt. There is
 * no positioning language, no "leading" or "revolutionary", nothing a model could repeat that we
 * would not want attributed to us in someone else's answer.
 *
 * `mainEntity` FAQs exist because the questions a stranger actually asks ("does it really pay",
 * "what stops it overpaying") are the questions an assistant gets asked on our behalf. Answering them
 * here, in the words we would use, is the difference between being summarised and being paraphrased
 * badly.
 */
export function StructuredData() {
  const site = siteUrl();

  const graph = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Organization",
        "@id": `${site}/#org`,
        name: "Sage",
        url: site,
        logo: `${site}/sagelogo.jpg`,
        description:
          "Sage builds AI agents you can trust with money: limits enforced in code, and a public receipt for everything they do. Its first product pays people in USDC for work it has verified.",
      },
      {
        "@type": "WebSite",
        "@id": `${site}/#site`,
        url: site,
        name: "Sage",
        publisher: { "@id": `${site}/#org` },
      },
      {
        "@type": "SoftwareApplication",
        "@id": `${site}/#app`,
        name: "Sage",
        applicationCategory: "BusinessApplication",
        operatingSystem: "Web",
        url: site,
        // The plans as the server enforces them (src/lib/plans/catalog.ts): a price a model repeats
        // must be the price a customer is charged. Programs is arranged per programme, so it has none.
        offers: PLAN_ORDER.flatMap((id) => {
          const price = planPriceUsd(id);
          return price === null
            ? []
            : [{ "@type": "Offer", name: PLANS[id].name, price: String(price), priceCurrency: "USD", description: PLANS[id].blurb }];
        }),
        featureList: [
          "Turns a one-sentence description of work into tasks with a fixed reward each",
          "Checks every submission with AI against links, on-chain state and its own observations",
          "Pays people in USDC from an on-chain vault the agent cannot overspend",
          "Publishes a verifiable receipt for every payout and a written reason for every refusal",
          "Keeps a public record of verified work for everyone it pays",
        ],
      },
      {
        "@type": "FAQPage",
        // The visible /faq page renders this SAME list (see lib/seo/faq.ts). One entity, one source:
        // maintaining the schema and the page separately is how a site ends up telling a model one
        // thing and a reader another, and the schema is the copy that gets quoted.
        "@id": `${site}/faq#faq`,
        url: `${site}/faq`,
        mainEntity: FAQ.map((e) => ({
          "@type": "Question",
          name: e.q,
          acceptedAnswer: { "@type": "Answer", text: e.a },
        })),
      },
    ],
  };

  return (
    <script
      type="application/ld+json"
      // Server-rendered from a literal we control; no user input reaches this string.
      dangerouslySetInnerHTML={{ __html: JSON.stringify(graph) }}
    />
  );
}

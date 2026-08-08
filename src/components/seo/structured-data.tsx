import { siteUrl } from "@/lib/site";
import { FAQ } from "@/lib/seo/faq";

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
          "Sage runs an AI agent that inspects a live web product, designs paid user-testing missions, and pays human testers in USDC for verified evidence.",
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
        offers: {
          "@type": "Offer",
          price: "0",
          priceCurrency: "USD",
          description:
            "Free to use. A founder funds their own campaign vault; Sage pays testers out of it.",
        },
        featureList: [
          "Inspects a live product in a real browser and designs testing missions from what it observes",
          "Pays human testers in USDC from an on-chain vault the agent cannot exceed",
          "Publishes a verifiable receipt for every payout",
          "Judges tester evidence against what the agent itself saw, in any language",
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

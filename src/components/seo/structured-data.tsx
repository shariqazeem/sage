import { siteUrl } from "@/lib/site";

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
        "@id": `${site}/#faq`,
        mainEntity: [
          {
            "@type": "Question",
            name: "How do I get paid to test products on Sage?",
            acceptedAnswer: {
              "@type": "Answer",
              text: "Open the Sage marketplace, pick a mission, do the short task it describes, and write what you actually saw. There is no application and no interview. Sage checks your account against what it observed exploring the product itself and pays in USDC.",
            },
          },
          {
            "@type": "Question",
            name: "Does Sage actually pay, or is it a claim?",
            acceptedAnswer: {
              "@type": "Answer",
              text: "Every payout is an on-chain transaction on GOAT Network and publishes a receipt page anyone can open and verify. The marketplace lists recent payouts with links to those transactions, so the total paid is read from settled transfers rather than typed in.",
            },
          },
          {
            "@type": "Question",
            name: "What stops the AI agent from overspending?",
            acceptedAnswer: {
              "@type": "Answer",
              text: "The agent proposes, a smart contract disposes. Each campaign has an on-chain vault that derives the exact reward, enforces the per-mission cap and completion limits, and rejects anything outside them. No model output can move money by itself.",
            },
          },
          {
            "@type": "Question",
            name: "Can I write my submission in my own words or my own language?",
            acceptedAnswer: {
              "@type": "Answer",
              text: "Yes. Sage matches your account against phrases from inside the product rather than requiring particular wording, so a genuine account written in your own voice or another language still verifies. One thing to keep: write the product's own words for what you saw on screen, such as button and heading labels, because those are what Sage matches against. Copying the mission description back scores nothing.",
            },
          },
          {
            "@type": "Question",
            name: "What does a founder give Sage to start?",
            acceptedAnswer: {
              "@type": "Answer",
              text: "A product URL, what you want proven, who should test it, and a budget in USDC. Sage browses the product itself and designs the missions, so there is nothing else to fill in.",
            },
          },
        ],
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

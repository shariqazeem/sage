/**
 * SCENES — each drives the live product and drops marks. Public scenes need no session; the
 * signed-in ones (composer, operator) run under a throwaway SIWE wallet (`--key`).
 * Timing rule: move, pause just long enough to read, move. The cut speeds the rest up.
 */
// A Starknet payout that carries the private leg (escrow 0x68ebf1…8af4) — the receipt draws it.
const STARKNET_RECEIPT = "0x2b03ed6532b29771723c996a667b468e367935d0c2ff839840d5f00656449fb";
const FARMED_GIG = "gig-1c3e_FjffE";

export const SCENES = {
  // The farm, drawn from the chain: one operator, twelve wallets, every slot.
  async graph(c) {
    await c.go(`/graph/${FARMED_GIG}`);
    c.mark("start");
    await c.wait(1200);
    c.mark("graph");
    await c.caption("One operator. Twelve wallets. Every slot.", 1800);
    await c.wait(2200);
    await c.scrollTo(420, 1100);
    c.mark("scrolled");
    await c.wait(1400);
    await c.caption("Drawn from the chain, not from a story.", 1600);
    await c.wait(2000);
    await c.scrollTo(900, 1100);
    c.mark("legend");
    await c.wait(1600);
  },

  // A Starknet receipt: released by the vault, escrowed behind a commitment, collected privately.
  async receipt(c) {
    await c.go(`/proof/${STARKNET_RECEIPT}`);
    c.mark("start");
    await c.wait(1400);
    await c.scrollTo(520, 1000);
    c.mark("verdict");
    await c.wait(1600);
    await c.scrollTo(1100, 1000);
    c.mark("leg");
    await c.caption("Released. Escrowed. Collected.", 1800);
    await c.wait(2400);
    await c.scrollTo(1700, 1000);
    c.mark("chain");
    await c.wait(1800);
  },

  // The ledger: every number on the site from one settlement ledger.
  async explorer(c) {
    await c.go("/explorer");
    c.mark("start");
    await c.wait(1500);
    await c.scrollTo(380, 900);
    c.mark("rows");
    await c.wait(1400);
    await c.caption("Every payout. Every refusal. One ledger.", 1700);
    await c.scrollTo(900, 1400);
    c.mark("refusals");
    await c.wait(1800);
    await c.scrollTo(1500, 1400);
    c.mark("deep");
    await c.wait(1600);
  },

  async outcomes(c) {
    await c.go("/outcomes");
    c.mark("start");
    await c.wait(1500);
    await c.scrollTo(420, 1000);
    c.mark("fees");
    await c.wait(1600);
    await c.scrollTo(900, 1000);
    c.mark("people");
    await c.wait(1600);
    await c.scrollTo(1400, 1000);
    c.mark("bench");
    await c.wait(1600);
  },

  // The lender's view of a record.
  async lender(c) {
    const w = process.env.RECORD_WALLET;
    if (w) {
      await c.go(`/record/${w}`);
      c.mark("start");
      await c.wait(1500);
      await c.scrollTo(450, 1000);
      c.mark("record");
      await c.wait(1600);
      await c.go(`/lender?wallet=${w}`);
      await c.wait(1500);
      await c.scrollTo(420, 1000);
      c.mark("call");
      await c.caption("One call. A verified cash-flow record.", 1700);
      await c.wait(2000);
      await c.scrollTo(1000, 1000);
      c.mark("advance");
      await c.wait(1800);
      return;
    }
    await c.go("/lender");
    c.mark("start");
    await c.wait(1500);
    await c.scrollTo(500, 1000);
    c.mark("record");
    await c.wait(1500);
    await c.scrollTo(1100, 1000);
    c.mark("call");
    await c.caption("One call. A verified cash-flow record.", 1700);
    await c.wait(2000);
    await c.scrollTo(1700, 1000);
    c.mark("advance");
    await c.wait(1600);
  },

  // The front door, scrolled like a reader would.
  async landing(c) {
    await c.go("/");
    c.mark("start");
    await c.wait(1600);
    for (const [y, m] of [[700, "s1"], [1500, "s2"], [2400, "s3"], [3400, "s4"], [4600, "s5"], [5800, "s6"], [7200, "s7"]]) {
      await c.scrollTo(y, 1300);
      c.mark(m);
      await c.wait(1300);
    }
  },

  // The marketplace board: open work, the door mark on public work.
  async marketplace(c) {
    await c.go("/marketplace");
    c.mark("start");
    await c.wait(1500);
    await c.scrollTo(400, 900);
    c.mark("rows");
    await c.wait(1500);
    await c.scrollTo(900, 1000);
    c.mark("more");
    await c.wait(1500);
  },

  // A public campaign board — pass --path /c/<id> via env CAMPAIGN_PATH.
  async board(c) {
    const path = process.env.CAMPAIGN_PATH || "/marketplace";
    await c.go(path);
    c.mark("start");
    await c.wait(1600);
    await c.scrollTo(500, 1000);
    c.mark("brief");
    await c.wait(1500);
    await c.scrollTo(1000, 1000);
    c.mark("door");
    await c.wait(1800);
    await c.scrollTo(1500, 1000);
    c.mark("form");
    await c.wait(1500);
  },
  // SIGNED-IN (throwaway wallet, --key). The composer: one sentence, the plan forming as you type.
  async composer(c) {
    if (!c.signedIn) throw new Error("composer needs --key");
    const p = c.page;
    await c.go("/launch?do=pay");
    c.mark("start");
    await c.wait(1200);
    const sel = 'textarea[placeholder^="e.g. Pay 5 people"]';
    const ta = p.locator(sel).first();
    await ta.waitFor({ state: "visible", timeout: 20000 });
    await ta.scrollIntoViewIfNeeded();
    c.mark("field");
    await c.wait(500);
    await c.type(sel, "Pay J$800 to each of 8 people who publish a post of at least 250 words about how they get paid for remote work in the Caribbean today, with their wallet address on the page. One per person.", 30);
    c.mark("typed");
    await c.wait(600);
    await p.getByRole("button", { name: /draft with sage/i }).click();
    c.mark("drafting");
    // the draft is a model turn — wait for the button to come back
    await p.getByRole("button", { name: /^draft with sage$/i }).waitFor({ state: "visible", timeout: 60000 }).catch(() => {});
    await c.wait(1200);
    c.mark("drafted");
    // money is never in the draft: the founder prices it — currency, amount, headcount
    const cur = p.locator('select[aria-label="The currency you are pricing in"]').first();
    await cur.scrollIntoViewIfNeeded();
    await c.wait(400);
    await cur.selectOption("JMD");
    await c.wait(700);
    const slots = p.locator("label", { hasText: "How many can earn it" }).locator("select").first();
    if (await slots.count()) { await slots.selectOption("8").catch(() => {}); await c.wait(600); }
    const pays = p.locator('input[type="number"]').first();
    await pays.scrollIntoViewIfNeeded();
    await pays.click({ clickCount: 3 });
    await p.keyboard.type("800", { delay: 90 });
    c.mark("priced");
    await c.wait(2200);
    await c.caption("Priced in J$. Paid in USDC at the stamped rate.", 1800);
    await c.wait(2400);
    // the plan panel: what Sage will do, the total, the evidence rule
    const panel = p.getByText(/what sage will do/i).first();
    if (await panel.count()) await panel.scrollIntoViewIfNeeded();
    c.mark("plan");
    await c.wait(2200);
    await c.scrollTo(1200, 1100);
    c.mark("bottom");
    await c.wait(1600);
  },

  // The operator at $0: a new founder names the product and sees the move Sage would make.
  async operator(c) {
    if (!c.signedIn) throw new Error("operator needs --key");
    await c.go("/start");
    c.mark("start");
    await c.wait(1400);
    const p = c.page;
    const choice = p.locator("button.st-choice").first();
    if (await choice.count()) { await choice.click(); await c.wait(900); }
    const nameField = p.locator('input[placeholder="Kingston Market Co-op"]');
    if (await nameField.count()) {
      c.mark("name");
      await c.type('input[placeholder="Kingston Market Co-op"]', "Kingston Market Co-op", 22);
      await c.wait(500);
      await p.getByRole("button", { name: /create workspace/i }).click();
      await c.wait(2500);
    }
    c.mark("workspace");
    await c.go("/workspace/autopilot");
    await c.wait(1500);
    c.mark("autopilot");
    const url = p.locator('input[placeholder="https://yourproduct.com"]').first();
    if (await url.count()) {
      await url.scrollIntoViewIfNeeded();
      await c.type('input[placeholder="https://yourproduct.com"]', "https://sagepays.xyz", 24);
      const goal = p.locator('input[placeholder="get developers through the quickstart"]').first();
      if (await goal.count()) await c.type('input[placeholder="get developers through the quickstart"]', "get a founder from the landing page to a funded campaign", 26);
      c.mark("named");
      const save = p.getByRole("button", { name: /sage run it|let sage run|save|arm/i }).first();
      if (await save.count()) await save.click(); else await p.keyboard.press("Enter");
      await c.wait(3000);
      c.mark("saved");
    }
    // the rehearsal takes a model turn — give it time, then reload so the card renders it
    await c.wait(14000);
    await c.go("/workspace/autopilot");
    await c.wait(1800);
    c.mark("move");
    await c.scrollTo(".nm-body", 900).catch(() => {});
    await c.wait(1800);
    await c.caption("Proposed at $0. Recorded before it moves.", 1800);
    await c.wait(2600);
    c.mark("hold");
  },
  // FILM SCENES (16:9). The J$ two-milestone grant composed as a milestone grant.
  async "composer-grant"(c) {
    if (!c.signedIn) throw new Error("composer-grant needs --key");
    const p = c.page;
    await c.go("/launch?do=pay");
    c.mark("start");
    await c.wait(1200);
    const grantChip = p.getByRole("button", { name: /^milestone grant$/i }).first();
    if (await grantChip.count()) { await grantChip.click(); await c.wait(600); }
    const sel = 'textarea[placeholder^="e.g. Pay 5 people"]';
    await p.locator(sel).first().scrollIntoViewIfNeeded();
    c.mark("field");
    await c.type(sel, "Give a market seller J$10,000 in two equal parts — half when her catalogue page is online with her wallet address on it, half when she posts her first customer review.", 30);
    c.mark("typed");
    await c.wait(500);
    await p.getByRole("button", { name: /draft with sage/i }).click();
    c.mark("drafting");
    await p.getByRole("button", { name: /^draft with sage$/i }).waitFor({ state: "visible", timeout: 90000 }).catch(() => {});
    await c.wait(1200);
    c.mark("drafted");
    const cur = p.locator('select[aria-label="The currency you are pricing in"]').first();
    if (await cur.count()) { await cur.scrollIntoViewIfNeeded(); await cur.selectOption("JMD").catch(() => {}); await c.wait(700); }
    // the money is the founder's: one total, split exactly by Sage into the two milestones
    const total = p.locator("label", { hasText: /split exactly by Sage/i }).locator('input[type="number"]').first();
    if (await total.count()) {
      await total.scrollIntoViewIfNeeded();
      await total.click({ clickCount: 3 });
      await p.keyboard.type("10000", { delay: 90 });
    }
    c.mark("priced");
    await c.wait(2200);
    const panel = p.getByText(/what sage will do/i).first();
    if (await panel.count()) await panel.scrollIntoViewIfNeeded();
    c.mark("plan");
    await c.wait(2800);
    await c.scrollTo(1100, 1200);
    c.mark("bottom");
    await c.wait(1600);
  },

  // A recipient's record and the lender's view of it (RECORD_WALLET env).
  async record(c) {
    const w = process.env.RECORD_WALLET;
    if (!w) throw new Error("RECORD_WALLET=0x… needed");
    await c.go(`/record/${w}`);
    c.mark("start");
    await c.wait(1600);
    await c.scrollTo(450, 1000);
    c.mark("signals");
    await c.wait(1800);
    await c.scrollTo(1000, 1000);
    c.mark("payouts");
    await c.wait(1600);
    await c.go(`/lender?wallet=${w}`);
    c.mark("lender");
    await c.wait(1800);
    await c.scrollTo(500, 1000);
    c.mark("capacity");
    await c.wait(1800);
    await c.scrollTo(1100, 1000);
    c.mark("call");
    await c.wait(1800);
  },

  // Two receipts back to back (the honest cut): an AI-earner receipt and a Starknet autonomous payout.
  async receipts(c) {
    const a = process.env.RECEIPT_A || "0xb0120330aba99dcf25d5aba913d1c8ecf341782653f1b20b4eaafa575155d827";
    const b = process.env.RECEIPT_B || "0x2b03ed6532b29771723c996a667b468e367935d0c2ff839840d5f00656449fb";
    await c.go(`/proof/${a}`);
    c.mark("a");
    await c.wait(1500);
    await c.scrollTo(500, 1000);
    c.mark("a-verdict");
    await c.wait(1600);
    await c.scrollTo(1000, 1000);
    c.mark("a-evidence");
    await c.wait(1500);
    await c.go(`/proof/${b}`);
    c.mark("b");
    await c.wait(1500);
    await c.scrollTo(600, 1000);
    c.mark("b-verdict");
    await c.wait(1600);
    await c.scrollTo(1200, 1000);
    c.mark("b-leg");
    await c.wait(1800);
    await c.scrollTo(1800, 1000);
    c.mark("b-chain");
    await c.wait(1600);
  },
};

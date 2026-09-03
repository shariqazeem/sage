import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("@/lib/db/campaigns", () => ({ isKnownSubmitterWallet: () => false, listRecentPaidStarknetSubmissions: () => [], recordEvent: () => {} }));
vi.mock("@/lib/campaigns/wallet-links", () => ({ linkWallets: () => ({ linked: false }) }));
vi.mock("./notify", () => ({ notifyTelegram: async () => {} }));
import { consolidationLinks } from "./consolidation";
import { padFelt, type Transfer } from "@/lib/starknet/transfers";

// Tonight's graph, verbatim: seven paid wallets forwarded $1.10 to the hub 0x0270…, which had itself
// submitted (a refused tweet); 0x05e5… forwarded to 0x01d9…, another paid submitter.
const HUB = padFelt("0x270f1135c91912cd47d8d434aaf8698d4a5fc32a525c3033b90aaa284a0b8de");
const paid = ["0x775e78dc7035cd00f0192452d326ba3467cbe06661c4d5d04816dd5f46a25ab", "0x4a4e04babb990b9f7e8a7afb0900222624665026431158b5031b46687211526", "0x5e58fce8a55a23025f45b66251d93cb93b9f7514607f1c8cc3e94211ebd5d8f", "0x1d9029ec661f4ecf11c9d34255d923af47fcd62ebd25486f8e42fec94e7367c", "0x7054446cdadaddedf40f1a31c2961b8b5d12295a695d41cf38cad81a427aa67"]
  .map((w, i) => ({ submissionId: `s${i}`, campaignId: "gig", wallet: w }));
const t = (from: string, to: string): Transfer => ({ from: padFelt(from), to: padFelt(to), value: BigInt(1_100_000), block: 1, tx: "0x" });

describe("consolidationLinks — where the money went after Sage paid it", () => {
  it("a forward to a wallet that submitted anywhere links the pair", () => {
    const out = new Map<string, Transfer[]>([[padFelt(paid[0].wallet), [t(paid[0].wallet, HUB)]]]);
    const links = consolidationLinks(paid, out, (w) => w === HUB);
    expect(links).toHaveLength(1);
    expect(links[0]).toMatchObject({ from: padFelt(paid[0].wallet), to: HUB, submissionId: "s0" });
    expect(links[0].why).toMatch(/also submitted to Sage/);
  });

  it("a forward to another PAID wallet is a link even if that wallet is not otherwise known", () => {
    const out = new Map<string, Transfer[]>([[padFelt(paid[2].wallet), [t(paid[2].wallet, paid[3].wallet)]]]);
    expect(consolidationLinks(paid, out, () => false)).toHaveLength(1);
  });

  it("an unknown collector becomes a hub once two paid wallets feed it; one forward to a stranger is not a link", () => {
    const stranger = padFelt("0x0aaa");
    const one = new Map<string, Transfer[]>([[padFelt(paid[0].wallet), [t(paid[0].wallet, stranger)]]]);
    expect(consolidationLinks(paid, one, () => false)).toHaveLength(0);
    const two = new Map<string, Transfer[]>([[padFelt(paid[0].wallet), [t(paid[0].wallet, stranger)]], [padFelt(paid[1].wallet), [t(paid[1].wallet, stranger)]]]);
    const links = consolidationLinks(paid, two, () => false);
    expect(links).toHaveLength(2);
    expect(links[0].why).toMatch(/collected from 2 paid wallets/);
  });

  it("a wallet that keeps its reward links nothing", () => {
    expect(consolidationLinks(paid, new Map(), () => true)).toHaveLength(0);
  });
});

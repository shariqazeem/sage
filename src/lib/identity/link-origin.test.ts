import { describe, expect, it } from "vitest";
import { linkWallets, flaggingLinksOf, linkedWalletsOf } from "@/lib/campaigns/wallet-links";
import { standingOf } from "./standing";

/**
 * WHICH LINKS ARE EVIDENCE AGAINST SOMEONE — which is not the same as which links exist.
 *
 * One table held opposite meanings. The consolidation watch writes a link when it INFERS a cluster
 * from on-chain behaviour. The Settings "bind" button writes one when a person proves control of
 * both wallets and asks for their two RAILS to be one record — something Sage itself tells them to
 * do, so a business paid on GOAT and on Starknet is not underwritten as two half-records. Standing
 * flagged on either.
 *
 * Measured on prod 2026-09-05, on the operator's OWN bound pair: both wallets came back "linked
 * on-chain to 1 other that took paid work here" and were refused the paid tiers, for using the
 * feature exactly as the UI invites.
 *
 * The exemption is deliberately the narrowest thing that fixes it — the single cross-rail pair the
 * bind route can produce, since it reads exactly one EVM session and one Starknet session.
 */
const evm = (n: string) => `0x${n.repeat(40).slice(0, 40)}`;
const felt = (n: string) => `0x${n.repeat(63).slice(0, 63)}`;

describe("which links count against a wallet", () => {
  it("a discovered link is evidence — it is what the watch found", () => {
    const [a, b] = [evm("1"), evm("2")];
    expect(linkWallets(a, b, 1_800_000_000, "discovered").linked).toBe(true);
    expect(flaggingLinksOf(a).length).toBe(1);
    expect(standingOf(a).tier).toBe("flagged");
  });

  it("the bound cross-rail pair is not — that pair IS the feature", () => {
    const [e, s] = [evm("3"), felt("4")];
    expect(linkWallets(e, s, 1_800_000_000, "declared").linked).toBe(true);
    expect(flaggingLinksOf(e)).toEqual([]);
    expect(flaggingLinksOf(s)).toEqual([]);
    expect(standingOf(e).tier).not.toBe("flagged");
  });

  it("but the record still merges over the whole cluster — one business, both rails", () => {
    const [e, s] = [evm("5"), felt("6")];
    linkWallets(e, s, 1_800_000_000, "declared");
    expect(linkedWalletsOf(e).length).toBe(2);
  });

  it("a SECOND declared link is not the bind feature, so the exemption lapses", () => {
    const [e, s1, s2] = [evm("7"), felt("8"), felt("9")];
    linkWallets(e, s1, 1_800_000_000, "declared");
    linkWallets(e, s2, 1_800_000_001, "declared");
    expect(flaggingLinksOf(e).length).toBe(2);
    expect(standingOf(e).tier).toBe("flagged");
  });

  it("nor is a same-rail declaration — the bind route cannot produce one", () => {
    const [a, b] = [evm("a"), evm("b")];
    linkWallets(a, b, 1_800_000_000, "declared");
    expect(flaggingLinksOf(a).length).toBe(1);
    expect(standingOf(a).tier).toBe("flagged");
  });

  it("a declaration can never overwrite a discovery — whoever rotated the wallets holds both", () => {
    const [e, s] = [evm("c"), felt("d")];
    expect(linkWallets(e, s, 1_800_000_000, "discovered").linked).toBe(true);
    expect(linkWallets(e, s, 1_800_000_001, "declared").linked).toBe(false);
    expect(flaggingLinksOf(e).length).toBe(1);
    expect(standingOf(e).tier).toBe("flagged");
  });

  it("defaults to discovered, so every existing caller keeps meaning what it meant", () => {
    const [a, b] = [evm("e"), evm("f")];
    expect(linkWallets(a, b).linked).toBe(true);
    expect(flaggingLinksOf(a).length).toBe(1);
  });
});

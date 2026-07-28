import { describe, it, expect } from "vitest";
import {
  classifyFieldValue,
  isQuantityField,
  isSensitiveField,
  resolveSyntheticValue,
} from "./browser-controller";

/**
 * Sage could only ever type in ONE situation: a conversation (`completeConversation` — probe, send,
 * wait for a reply). Every other form was unreachable, so a founder's signup, launch or search flow
 * was something Sage could click AT but never THROUGH. Two things blocked the general case:
 *
 *  1. there was no URL value, so a product whose job is to accept a URL had nothing valid to receive;
 *  2. `type="number"` was refused outright to keep card numbers out — which also refused every
 *     budget, quantity and count box, i.e. most of what a form asks for.
 *
 * The safety property must survive the generalisation: no password, email, phone, card, account,
 * wallet, or personal datum is ever typed, and the text Sage types is always one of a closed set of
 * fixed strings that no model authored.
 */

describe("the value Sage types is always fixed and synthetic", () => {
  it.each([
    ["display_name", "Sage Test"],
    ["search", "test"],
    ["quantity", "1"],
    ["url", "https://example.com"],
  ] as const)("%s resolves to exactly %s", (kind, expected) => {
    expect(resolveSyntheticValue(kind)).toBe(expected);
  });

  it("uses the RFC-2606 reserved domain, never a real service", () => {
    expect(resolveSyntheticValue("url")).toMatch(/example\.com$/);
  });

  it("keeps a quantity at the smallest thing it can be", () => {
    expect(Number(resolveSyntheticValue("quantity"))).toBe(1);
  });
});

describe("the field decides what it is asking for", () => {
  it.each([
    [{ type: "url" }, "url"],
    [{ placeholder: "https://yourproduct.com" }, "url"],
    [{ label: "Product URL" }, "url"],
    [{ name: "website" }, "url"],
    [{ type: "search" }, "search"],
    [{ placeholder: "Search missions" }, "search"],
    [{ label: "Budget", type: "number" }, "quantity"],
    [{ label: "How many testers", type: "number" }, "quantity"],
    [{ tag: "textarea", label: "Tell us more" }, "ai_probe"],
    [{ label: "Message" }, "ai_probe"],
    [{ label: "Your name" }, "display_name"],
    [{}, "display_name"],
  ])("%o → %s", (el, kind) => {
    expect(classifyFieldValue(el)).toBe(kind);
  });
});

describe("a credential or payment field is still never typed into", () => {
  it.each([
    { type: "password" },
    { type: "email" },
    { type: "tel" },
    { name: "cardNumber" },
    { label: "CVV", type: "number" },
    { label: "Card number", type: "number" },
    { name: "account_number", type: "number" },
    { label: "Routing number", type: "number" },
    { placeholder: "Wallet address" },
    { name: "ssn" },
    { label: "Seed phrase" },
    { name: "api_key" },
    { label: "Date of birth" },
    { placeholder: "Street address" },
  ])("refuses %o", (el) => {
    expect(isSensitiveField(el)).toBe(true);
  });

  it("a password field is never rescued by quantity-sounding words", () => {
    expect(isSensitiveField({ type: "password", label: "amount" })).toBe(true);
  });

  it("an email field is never rescued either", () => {
    expect(isSensitiveField({ type: "email", label: "how many" })).toBe(true);
  });
});

describe("a benign quantity is no longer collateral damage", () => {
  it.each([
    { label: "Budget", type: "number" },
    { label: "Amount of testers", type: "number" },
    { name: "quantity", type: "number" },
    { placeholder: "How many", type: "number" },
    { label: "Number of seats", type: "number" },
  ])("allows %o", (el) => {
    expect(isSensitiveField(el)).toBe(false);
  });

  it("a bare number field with no wording stays refused", () => {
    // Nothing says it is a quantity, so it could be anything — including a card.
    expect(isSensitiveField({ type: "number" })).toBe(true);
    expect(isQuantityField({ type: "number" })).toBe(false);
  });

  it("a quantity word does not override an explicit payment word", () => {
    expect(isQuantityField({ label: "card amount", type: "number" })).toBe(
      false,
    );
    expect(isSensitiveField({ label: "card amount", type: "number" })).toBe(
      true,
    );
  });
});

/**
 * The identifier spellings a real form actually uses. `account\b` cannot match `account_number`
 * because `_` is a word character, so the boundary never occurs — the same trap that once hid a
 * broken `not require\b` guard. Every sensitive check now normalises camelCase and separators into
 * spaces first, so the boundaries in the pattern mean what they say.
 */
describe("real-world field identifiers are matched, not just tidy ones", () => {
  it.each([
    "account_number",
    "accountNumber",
    "account-number",
    "cardNumber",
    "card_number",
    "apiKey",
    "api_key",
    "privateKey",
    "walletAddress",
    "postalCode",
    "phoneNumber",
    "emailAddress",
    "socialSecurityNumber",
  ])("refuses a field named %s", (name) => {
    expect(isSensitiveField({ name, type: "number" })).toBe(true);
    expect(isSensitiveField({ name })).toBe(true);
  });

  it("does not find a quantity hiding inside a longer word", () => {
    // "account" contains "count"; "amounted" contains "amount". Neither is a quantity field.
    expect(isQuantityField({ name: "account", type: "number" })).toBe(false);
    expect(isQuantityField({ name: "discountCode" })).toBe(false);
  });

  it("still finds the quantity when it is genuinely there", () => {
    expect(isQuantityField({ name: "itemCount", type: "number" })).toBe(true);
    expect(isQuantityField({ name: "max_budget", type: "number" })).toBe(true);
  });
});

describe("ordinary text fields are unaffected", () => {
  it.each([
    { type: "text", label: "Display name" },
    { type: "search", placeholder: "Search" },
    { tag: "textarea", label: "Message" },
    { type: "url", label: "Product URL" },
  ])("allows %o", (el) => {
    expect(isSensitiveField(el)).toBe(false);
  });
});

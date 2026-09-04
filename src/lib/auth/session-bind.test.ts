import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { bindDecision } from "./session";

/**
 * ONE PERSON, ONE ACCOUNT.
 *
 * Email sign-in and wallet sign-in wrote the same cookie, so connecting an Ethereum wallet after
 * signing in by email REPLACED the account and the founder was asked to set up from scratch
 * ("it should be binded in same email right?", 2026-09-05). `mode: "bind"` joins the proven wallet
 * to the account already signed in and leaves the session alone.
 */
describe("bindDecision — what a proven wallet becomes", () => {
  it("with no session there is nothing to bind to — and no way to attach a wallet to a stranger", () => {
    expect(bindDecision(null, "0xabc")).toBe("no_session");
  });
  it("the same wallet is a no-op, not a second link", () => {
    expect(bindDecision("0xABC", "0xabc")).toBe("same");
  });
  it("a different wallet binds", () => {
    expect(bindDecision("0xabc", "0xdef")).toBe("bind");
  });
});

describe("the bind path never replaces the session", () => {
  const src = readFileSync(resolve(process.cwd(), "src/lib/auth/session.ts"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  // the bind function only — mintSession is DEFINED further down the file, which is not a call
  const start = src.indexOf("export async function verifyAndBindToSession");
  const bind = src.slice(start, src.indexOf("\nexport ", start + 1));
  it("verifies with the same proof as sign-in, writes a DECLARED link, and does not mint", () => {
    expect(bind).toMatch(/verifySiweSignature\(args\)/);
    expect(bind).toMatch(/linkWallets\(session, proven,[\s\S]*?"declared"\)/);
    expect(bind).not.toMatch(/mintSession\(/);
  });
  it("sign-in still mints — the replace behaviour is unchanged", () => {
    const signin = src.slice(src.indexOf("export async function verifyAndCreateSession"), src.indexOf("export function bindDecision"));
    expect(signin).toMatch(/mintSession\(address\)/);
  });
  it("the route reads the mode from the body and 401s without a session", () => {
    const route = readFileSync(resolve(process.cwd(), "src/app/api/auth/verify/route.ts"), "utf8");
    expect(route).toMatch(/body\.mode === "bind"/);
    expect(route).toMatch(/no account to add this wallet to/);
  });
  it("the hook and the sign-in component carry the intent through", () => {
    const hook = readFileSync(resolve(process.cwd(), "src/lib/auth/use-siwe.ts"), "utf8");
    expect(hook).toMatch(/mode: opts\.mode \?\? "signin"/);
    const comp = readFileSync(resolve(process.cwd(), "src/components/wallet/founder-sign-in.tsx"), "utf8");
    expect(comp).toMatch(/evm\.signIn\(\{ mode: intent \}\)/);
  });
});

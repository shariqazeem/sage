import { afterEach, describe, expect, it } from "vitest";
import { isSageVaultClass, starknetKnownVaultClasses } from "./config";

const NEW = "0x6d55773e63601dfbd861c78e03c5ac3085b472d7c067d9c5634da03a00b5aa0";
const OLD = "0x715ab98f0d29548209259a6283d1b1db317b07b4f16441b068c02eaa40ffa87";
const env = { ...process.env };
afterEach(() => { process.env = { ...env }; });

/**
 * Declaring the privacy class must not orphan the vaults declared before it. Provenance is
 * "any class Sage declared"; deployment is "the first one". (2026-09-02)
 */
describe("Sage's declared vault classes", () => {
  it("recognises the previous class beside the new deploy target", () => {
    process.env.STARKNET_VAULT_CLASS_HASH = NEW;
    process.env.STARKNET_VAULT_CLASS_HASHES_PREVIOUS = OLD;
    expect(starknetKnownVaultClasses()).toEqual([NEW, OLD]);
    expect(isSageVaultClass(OLD)).toBe(true);
    expect(isSageVaultClass(NEW)).toBe(true);
    // felt comparison, not string comparison — a leading-zero form of the same class is the same class
    expect(isSageVaultClass(`0x0${OLD.slice(2)}`)).toBe(true);
  });

  it("a stranger's class is still not a Sage vault", () => {
    process.env.STARKNET_VAULT_CLASS_HASH = NEW;
    process.env.STARKNET_VAULT_CLASS_HASHES_PREVIOUS = OLD;
    expect(isSageVaultClass("0x1234")).toBe(false);
  });

  it("with no previous classes configured, only the deploy target is recognised", () => {
    process.env.STARKNET_VAULT_CLASS_HASH = NEW;
    delete process.env.STARKNET_VAULT_CLASS_HASHES_PREVIOUS;
    expect(starknetKnownVaultClasses()).toEqual([NEW]);
    expect(isSageVaultClass(OLD)).toBe(false);
  });

  it("a malformed previous entry throws at use, like a malformed target", () => {
    process.env.STARKNET_VAULT_CLASS_HASH = NEW;
    process.env.STARKNET_VAULT_CLASS_HASHES_PREVIOUS = "not-a-hash";
    expect(() => starknetKnownVaultClasses()).toThrow(/not a class hash/);
  });
});

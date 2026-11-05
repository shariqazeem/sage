import { beforeEach, describe, expect, it } from "vitest";
import { factKind, normalizeFact } from "./remembered";
import { db } from "@/lib/db";
import { workspaceFacts } from "@/lib/db/schema";
import { getWorkspaceFacts, rememberWorkspaceFacts } from "@/lib/db/workspace-facts";

/**
 * WHAT A FOUNDER TOLD SAGE ONCE, SAGE DOESN'T ASK AGAIN — and never what it must not keep.
 * The labels are the drafter's own words from real cards (Sage Bench and the 5 Nov walkthrough).
 */
describe("which answers Sage remembers", () => {
  it.each([
    ["The GitHub repository (owner/name) where the pull request should be opened", "github_repo"],
    ["The repository (owner/name) the pull request goes into, and access if it is private", "github_repo"],
    ["The Discord invite link for the community server", "discord_invite"],
    ["Your Telegram group invite link", "telegram_invite"],
    ["The product's URL", "product_url"],
    ["The link to your app", "product_url"],
    ["The URL of your developer docs", "docs_url"],
  ])("%s → %s", (label, kind) => {
    expect(factKind(label)).toBe(kind);
  });

  it.each([
    ["The contract address on Base the swap goes to"],
    ["The Safe address to deploy against"],
    ["A test account login (email and password)"],
    ["An API key for the staging server"],
    ["Which docs to translate (the folder or list of files)"],
    ["The date of the event"],
  ])("never remembers: %s", (label) => {
    expect(factKind(label)).toBeNull();
  });

  it("keeps only clean values of each kind", () => {
    expect(normalizeFact("github_repo", "https://github.com/sage-labs/docs.git")).toBe("sage-labs/docs");
    expect(normalizeFact("github_repo", "sage-labs/docs")).toBe("sage-labs/docs");
    expect(normalizeFact("github_repo", "our main repo")).toBeNull();
    expect(normalizeFact("discord_invite", "https://discord.gg/abc123")).toBe("https://discord.gg/abc123");
    expect(normalizeFact("discord_invite", "https://evil.example/discord.gg/x")).toBeNull();
    expect(normalizeFact("product_url", "http://insecure.example")).toBeNull();
    expect(normalizeFact("product_url", "https://sagepays.xyz")).toBe("https://sagepays.xyz");
  });
});

describe("the workspace's memory", () => {
  beforeEach(() => {
    db.delete(workspaceFacts).run();
  });

  it("remembers the latest clean answer per kind, and drops the rest", () => {
    expect(rememberWorkspaceFacts("ws-1", [{ kind: "github_repo", value: "sage-labs/docs" }, { kind: "github_repo", value: "not a repo" }, { kind: "password", value: "hunter2" }])).toBe(1);
    expect(rememberWorkspaceFacts("ws-1", [{ kind: "github_repo", value: "https://github.com/sage-labs/site" }])).toBe(1);
    expect(getWorkspaceFacts("ws-1")).toEqual({ github_repo: "sage-labs/site" });
    expect(getWorkspaceFacts("ws-2")).toEqual({});
  });
});

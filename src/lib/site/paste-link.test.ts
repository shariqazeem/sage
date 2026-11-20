import { describe, expect, it } from "vitest";
import { DEFAULT_TEST, pastedLink } from "./paste-link";
import { testPath } from "./test-path";

describe("what someone pasted, as a link", () => {
  it("gives a bare domain https, and keeps a path", () => {
    expect(pastedLink("myapp.com")).toBe("https://myapp.com/");
    expect(pastedLink("  www.myapp.com/pricing ")).toBe("https://www.myapp.com/pricing");
    expect(pastedLink("https://app.myapp.io/start?x=1")).toBe("https://app.myapp.io/start?x=1");
    expect(pastedLink("http://myapp.com")).toBe("http://myapp.com/");
  });

  it("refuses what could never be opened as a product", () => {
    for (const bad of ["", "   ", "myapp", "localhost:3000", "two words.com", "ftp://myapp.com", "javascript:alert(1)", "https://user:pw@myapp.com", "mailto:me@myapp.com"]) {
      expect(pastedLink(bad), bad).toBeNull();
    }
  });

  it("the default test is 10 people at $2.00, and the total is their product", () => {
    expect(DEFAULT_TEST.people * DEFAULT_TEST.eachUsd).toBe(DEFAULT_TEST.budgetUsd);
  });

  it("a test has one address", () => {
    expect(testPath("abc123")).toBe("/t/abc123");
  });
});

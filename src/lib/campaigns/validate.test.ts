import { describe, expect, it } from "vitest";
import {
  isAddressLike,
  validateCampaignInput,
  validateEvidenceUrl,
  validateRewardUsd,
} from "./validate";

describe("validateEvidenceUrl", () => {
  it("accepts a normal https link", () => {
    const r = validateEvidenceUrl("https://github.com/acme/repo/pull/12");
    expect(r.ok && r.value).toBe("https://github.com/acme/repo/pull/12");
  });

  it("rejects non-https", () => {
    expect(validateEvidenceUrl("http://example.com").ok).toBe(false);
    expect(validateEvidenceUrl("ftp://example.com").ok).toBe(false);
    expect(validateEvidenceUrl("javascript:alert(1)").ok).toBe(false);
  });

  it("rejects SSRF hosts: localhost, private, link-local, metadata", () => {
    for (const u of [
      "https://localhost/x",
      "https://127.0.0.1/x",
      "https://10.0.0.5/x",
      "https://192.168.1.1/x",
      "https://172.16.0.1/x",
      "https://169.254.169.254/latest/meta-data",
      "https://0.0.0.0/x",
      "https://service.internal/x",
      "https://box.local/x",
      "https://[::1]/x",
    ]) {
      expect(validateEvidenceUrl(u).ok, u).toBe(false);
    }
  });

  it("rejects credentials in the URL and over-long URLs", () => {
    expect(validateEvidenceUrl("https://user:pass@example.com").ok).toBe(false);
    expect(validateEvidenceUrl("https://x.com/" + "a".repeat(3000)).ok).toBe(false);
  });

  it("rejects empty / non-string", () => {
    expect(validateEvidenceUrl("").ok).toBe(false);
    expect(validateEvidenceUrl(undefined).ok).toBe(false);
    expect(validateEvidenceUrl(42).ok).toBe(false);
  });

  it("allows a public host that merely starts with a private-looking octet", () => {
    // 172.15 and 172.32 are public (private band is 172.16–172.31)
    expect(validateEvidenceUrl("https://172.15.0.1/x").ok).toBe(true);
    expect(validateEvidenceUrl("https://172.32.0.1/x").ok).toBe(true);
  });
});

describe("validateRewardUsd", () => {
  it("converts whole and decimal USD to 6dp base units", () => {
    expect((validateRewardUsd(10) as { value: number }).value).toBe(10_000_000);
    expect((validateRewardUsd("2.5") as { value: number }).value).toBe(2_500_000);
  });

  it("rejects zero, negative, NaN, and over-cap", () => {
    expect(validateRewardUsd(0).ok).toBe(false);
    expect(validateRewardUsd(-5).ok).toBe(false);
    expect(validateRewardUsd("abc").ok).toBe(false);
    expect(validateRewardUsd(10_001).ok).toBe(false);
  });
});

describe("validateCampaignInput", () => {
  const base = {
    title: "Test the onboarding",
    description: "Do the thing",
    criteria: "Connected wallet\nReported one issue",
    rewardUsd: "10",
    maxRecipients: "25",
  };

  it("accepts a well-formed campaign and splits newline criteria", () => {
    const r = validateCampaignInput(base);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.criteria).toEqual(["Connected wallet", "Reported one issue"]);
      expect(r.value.rewardAmount).toBe(10_000_000);
      expect(r.value.maxRecipients).toBe(25);
    }
  });

  it("requires a title", () => {
    expect(validateCampaignInput({ ...base, title: "  " }).ok).toBe(false);
  });

  it("rejects a bad reward", () => {
    expect(validateCampaignInput({ ...base, rewardUsd: "0" }).ok).toBe(false);
  });
});

describe("isAddressLike", () => {
  it("matches a 20-byte hex address, rejects junk", () => {
    expect(isAddressLike("0x" + "a".repeat(40))).toBe(true);
    expect(isAddressLike("0x123")).toBe(false);
    expect(isAddressLike(123)).toBe(false);
  });
});

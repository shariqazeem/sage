import { describe, expect, it } from "vitest";
import { MANDATE_NAME_MAX, mandateName } from "./mandate-name";

describe("mandateName — under Privy's 50-character policy name cap, with room for derived rules", () => {
  it("keeps a Telegram chat id as it was", () => {
    expect(mandateName("123456789")).toBe("mandate:123456789");
  });
  it("shortens a website treasury key, which is 43 characters on its own", () => {
    const key = "web:0x0deF3D4124D0cD1708aEFFE6c1BC8182342a44D6";
    const name = mandateName(key);
    expect(name.length).toBeLessThanOrEqual(MANDATE_NAME_MAX);
    expect(name.startsWith("mandate:web:0x")).toBe(true);
    expect(name.endsWith("2a44D6")).toBe(true);
  });
  it("every derived rule name stays under Privy's cap", () => {
    for (const key of ["web:0x0deF3D4124D0cD1708aEFFE6c1BC8182342a44D6", "web:0x0000000000000000000000000000000000000000000000000000000000000001", "987654321"]) {
      for (const suffix of [":withdraw", ":stop", ""]) expect((mandateName(key) + suffix).length).toBeLessThan(50);
    }
  });
});

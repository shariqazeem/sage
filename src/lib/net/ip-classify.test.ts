import { describe, it, expect } from "vitest";
import { isPublicIp, classifyIp, isIpLiteral } from "./ip-classify";

describe("isPublicIp — only plain global unicast is public; everything else fails closed", () => {
  it("allows genuine public addresses", () => {
    for (const ip of ["8.8.8.8", "1.1.1.1", "93.184.216.34", "2606:4700::1111", "2001:4860:4860::8888"]) {
      expect(isPublicIp(ip), ip).toBe(true);
    }
  });

  it("refuses IPv4 loopback / private / CGNAT / link-local (metadata) / reserved / multicast / broadcast", () => {
    for (const ip of [
      "127.0.0.1", "127.1.2.3", "0.0.0.0", "10.0.0.1", "172.16.5.5", "172.31.255.255", "192.168.1.1",
      "100.64.0.1", "169.254.169.254", "169.254.0.1", "192.0.0.1", "192.0.2.5", "198.18.0.1", "198.51.100.1",
      "203.0.113.9", "224.0.0.1", "239.255.255.255", "240.0.0.1", "255.255.255.255",
    ]) {
      expect(isPublicIp(ip), ip).toBe(false);
    }
  });

  it("refuses IPv6 loopback / ULA / link-local / multicast / unspecified / doc / transition ranges", () => {
    for (const ip of [
      "::1", "::", "fe80::1", "fc00::1", "fd12:3456::1", "ff02::1", "2001:db8::1",
      "2002:7f00:1::", "64:ff9b::7f00:1", "2001:0000:4136::", // 6to4, NAT64, teredo
    ]) {
      expect(isPublicIp(ip), ip).toBe(false);
    }
  });

  it("re-classifies IPv4-mapped IPv6 by the embedded IPv4 (::ffff:127.0.0.1 is loopback)", () => {
    expect(isPublicIp("::ffff:127.0.0.1")).toBe(false);
    expect(isPublicIp("::ffff:10.0.0.1")).toBe(false);
    expect(isPublicIp("::ffff:169.254.169.254")).toBe(false);
    expect(isPublicIp("::ffff:8.8.8.8")).toBe(true); // a mapped PUBLIC v4 is still public
  });

  it("fails closed on anything unparseable (hostnames, garbage, empty)", () => {
    for (const s of ["", "not-an-ip", "example.com", "999.999.999.999", "0x7f000001", "2130706433"]) {
      expect(isPublicIp(s), s).toBe(false);
    }
  });
});

describe("classifyIp — audit label", () => {
  it("labels the range without leaking beyond the class", () => {
    expect(classifyIp("127.0.0.1")).toBe("loopback");
    expect(classifyIp("169.254.169.254")).toBe("linkLocal");
    expect(classifyIp("8.8.8.8")).toBe("unicast");
    expect(classifyIp("::ffff:10.0.0.1")).toBe("ipv4Mapped:private");
    expect(classifyIp("garbage")).toBe("unparseable");
  });
});

describe("isIpLiteral + weird IPv4 encodings", () => {
  it("recognizes IP literals, not hostnames", () => {
    expect(isIpLiteral("127.0.0.1")).toBe(true);
    expect(isIpLiteral("::1")).toBe(true);
    expect(isIpLiteral("example.com")).toBe(false);
  });
  it("hex / integer / octal IPv4 encodings ARE literals and classify to their real address (loopback → blocked)", () => {
    for (const s of ["0x7f000001", "2130706433", "017700000001"]) {
      expect(isIpLiteral(s), s).toBe(true); // ipaddr.js canonicalizes these to 127.0.0.1
      expect(isPublicIp(s), s).toBe(false); // → loopback → refused, no DNS needed
    }
  });
});

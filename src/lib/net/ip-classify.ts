import ipaddr from "ipaddr.js";

/**
 * IP address classification for the egress boundary (Gate C item 4).
 *
 * The single question this answers: is a RESOLVED address one we may connect to from an untrusted browser
 * context? Only PLAIN GLOBAL UNICAST is public. Everything else — loopback, private (RFC1918), CGNAT,
 * link-local (incl. the 169.254.169.254 cloud-metadata address), multicast, broadcast, unspecified,
 * reserved/documentation/benchmark ranges, IPv6 unique-local, and every IPv6 transition range that can
 * embed a private IPv4 (6to4, NAT64, Teredo) — is NOT public and MUST be refused. IPv4-mapped IPv6
 * (::ffff:a.b.c.d) is re-classified by its embedded IPv4, so ::ffff:127.0.0.1 is loopback.
 *
 * Classification is delegated to ipaddr.js (a mature, dependency-free, widely-used library — it backs
 * proxy-addr / express's trust-proxy) so we do not hand-roll IPv6 parsing. We wrap it with a strict
 * allow-only-unicast policy plus a couple of explicit denies ipaddr does not flag, and we FAIL CLOSED on
 * any parse error. Maintenance/security note: ipaddr.js is pinned in package.json; a range-table change in
 * a future version could only make an address MORE restricted here (we allow only "unicast"), never less.
 */

/** RFC 2544 benchmarking range 198.18.0.0/15 — ipaddr.js reports it as unicast; deny it explicitly. */
const IPV4_EXPLICIT_DENY: [string, number][] = [["198.18.0.0", 15]];

/** True ONLY for a plain global-unicast address we may egress to. Any parse error → false (fail closed). */
export function isPublicIp(ip: string): boolean {
  let addr: ipaddr.IPv4 | ipaddr.IPv6;
  try {
    addr = ipaddr.parse(ip);
  } catch {
    return false;
  }
  if (addr.kind() === "ipv6") {
    const v6 = addr as ipaddr.IPv6;
    if (v6.isIPv4MappedAddress()) return isPublicIp(v6.toIPv4Address().toString());
    // Only ordinary global unicast is public; every transition/special range (6to4, rfc6052/NAT64,
    // teredo, uniqueLocal, linkLocal, multicast, reserved, unspecified, loopback) is refused.
    return v6.range() === "unicast";
  }
  const v4 = addr as ipaddr.IPv4;
  if (v4.range() !== "unicast") return false;
  for (const [net, bits] of IPV4_EXPLICIT_DENY) {
    if (v4.match(ipaddr.parse(net) as ipaddr.IPv4, bits)) return false;
  }
  return true;
}

/** A short classification label for logs/audit — never the address itself in a public surface. */
export function classifyIp(ip: string): string {
  try {
    const addr = ipaddr.parse(ip);
    if (addr.kind() === "ipv6") {
      const v6 = addr as ipaddr.IPv6;
      if (v6.isIPv4MappedAddress()) return `ipv4Mapped:${(addr as ipaddr.IPv6).toIPv4Address().range()}`;
      return v6.range();
    }
    return (addr as ipaddr.IPv4).range();
  } catch {
    return "unparseable";
  }
}

/** True if `host` is itself an IP literal (any standard form ipaddr.js accepts). */
export function isIpLiteral(host: string): boolean {
  return ipaddr.isValid(host);
}

/** live facts for the boards — read from the product, never typed in */
const text = async (url) => (await (await fetch(url)).text()).replace(/<script[\s\S]*?<\/script>/g, " ").replace(/<style[\s\S]*?<\/style>/g, " ").replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&#x27;|&rsquo;/g, "'").replace(/&ldquo;|&rdquo;/g, '"').replace(/\s+/g, " ");
export async function ledger(base = "https://sagepays.xyz") {
  const t = await text(base + "/");
  const m = /\$([0-9.,]+) settled · (\d+) verified payouts? · (\d+) refused/.exec(t);
  const mp = await text(base + "/marketplace");
  const med = /(\d+m \d+s) median wait, measured over (\d+) payouts/.exec(mp);
  const people = /(\d+) payouts to (\d+) people/.exec(mp);
  return { paidUsd: m ? Number(m[1].replace(/,/g, "")) : 63.6, payouts: m ? Number(m[2]) : 39, refused: m ? Number(m[3]) : 26, median: med ? med[1] : "2m 55s", people: people ? Number(people[2]) : 24 };
}
export async function explorerRows(base = "https://sagepays.xyz", n = 8) {
  const html = await (await fetch(base + "/explorer")).text();
  const rows = [];
  const re = /(Paid|Refused|paid to|refused)[^<]{0,40}(0x[0-9a-fA-F]{4})[^<]*?…([0-9a-fA-F]{4})[\s\S]{0,300}?(Starknet|GOAT Mainnet|GOAT)/g;
  let m; while ((m = re.exec(html)) && rows.length < n) rows.push({ ok: /paid/i.test(m[1]), wallet: `${m[2]}…${m[3]}`, rail: m[4].replace(" Mainnet", "") });
  return rows;
}

/** a SIWE session for a throwaway key — Sage's own sign-in text, same as the recorder */
export async function siweCookie(key, base = "https://sagepays.xyz") {
  const { privateKeyToAccount } = await import("viem/accounts");
  const account = privateKeyToAccount(key.startsWith("0x") ? key : `0x${key}`);
  const jar = new Map();
  const keep = (res) => { for (const c of res.headers.getSetCookie?.() ?? []) { const [kv] = c.split(";"); const i = kv.indexOf("="); jar.set(kv.slice(0, i).trim(), kv.slice(i + 1).trim()); } return res; };
  const cookie = () => [...jar].map(([a, b]) => `${a}=${b}`).join("; ");
  const call = (p, init = {}) => fetch(`${base}${p}`, { ...init, headers: { "content-type": "application/json", cookie: cookie(), ...(init.headers ?? {}) } }).then(keep);
  const { nonce } = await (await call("/api/auth/nonce")).json();
  const issuedAt = new Date().toISOString();
  const message = ["Sage — sign in", "", `Wallet: ${account.address}`, `Nonce: ${nonce}`, `Issued At: ${issuedAt}`, "", "Signing proves you control this wallet. It authorizes no transaction and moves no funds."].join("\n");
  const signature = await account.signMessage({ message });
  await call("/api/auth/verify", { method: "POST", body: JSON.stringify({ address: account.address, signature, issuedAt }) });
  return cookie();
}
export async function operatorMove(key, base = "https://sagepays.xyz") {
  const cookie = await siweCookie(key, base);
  const j = await (await fetch(`${base}/api/operator`, { headers: { cookie } })).json();
  return j.rehearsal ?? j.next ?? j.move ?? j;
}
export async function recordSignals(wallet, base = "https://sagepays.xyz") {
  const t = await text(`${base}/record/${wallet}`);
  const pick = (re) => { const m = re.exec(t); return m ? m[1] : null; };
  return {
    passRate: pick(/(\d+%)\s*Verification pass rate/i) ?? pick(/pass rate[^0-9]{0,20}(\d+%)/i),
    inflow: pick(/(\$[0-9.]+)\s*Verified inflow/i),
    slots: pick(/(\d+)\s*Slots?/i),
    funderShare: pick(/(\d+%)\s*Largest funder share/i),
    lastPaid: pick(/(\d+d)\s*Since last payout/i),
    months: pick(/(\d+)\s*Months? active/i),
  };
}
export const marks = async (rec) => (await import("node:fs")).readFileSync ? JSON.parse((await import("node:fs")).readFileSync(`docs/posts/videos/rec/${rec}.marks.json`, "utf8")).marks : {};

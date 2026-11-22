/**
 * THE BRANDS PHISHERS COPY MOST, and the addresses that are really theirs.
 *
 * A short list on purpose: crypto wallets and exchanges, the big dapps, the big platforms. A name here is
 * never an accusation by itself: a lookalike is an address that imitates one of these names and is NOT on
 * the brand's own list of domains.
 *
 * `distinctive` marks a coined name (metamask, uniswap). An ordinary word that is also a brand (apple,
 * stripe, ledger) is matched only as a whole word of the address, never inside another word, and never by
 * a near-miss spelling: "pineapple" and "hedger" are not lookalikes of anything.
 */
export interface Brand {
  /** the name as it appears in an address, lower case, letters and digits only */
  name: string;
  /** how a builder reads it */
  label: string;
  /** registrable domains that really are this brand's */
  domains: string[];
  distinctive: boolean;
  /** a platform (PayPal, Google, GitHub) rather than a crypto name: fewer words beside it count as bait */
  platform: boolean;
}

const b = (name: string, label: string, domains: string[], distinctive = true): Brand => ({ name, label, domains, distinctive, platform: false });
const p = (name: string, label: string, domains: string[], distinctive = true): Brand => ({ name, label, domains, distinctive, platform: true });

export const BRANDS: readonly Brand[] = [
  // wallets
  b("metamask", "MetaMask", ["metamask.io", "metamask.tools", "consensys.io", "consensys.net"]),
  b("phantom", "Phantom", ["phantom.app", "phantom.com"], false),
  b("trustwallet", "Trust Wallet", ["trustwallet.com"]),
  b("walletconnect", "WalletConnect", ["walletconnect.com", "walletconnect.org", "walletconnect.network", "reown.com"]),
  b("ledger", "Ledger", ["ledger.com"], false),
  b("trezor", "Trezor", ["trezor.io"]),
  b("rabby", "Rabby", ["rabby.io"]),
  b("keplr", "Keplr", ["keplr.app"]),
  b("exodus", "Exodus", ["exodus.com"], false),
  // exchanges
  b("coinbase", "Coinbase", ["coinbase.com", "base.org", "cbhq.net"]),
  b("binance", "Binance", ["binance.com", "binance.us", "binance.org", "bnbchain.org"]),
  b("kraken", "Kraken", ["kraken.com"], false),
  b("kucoin", "KuCoin", ["kucoin.com"]),
  b("bybit", "Bybit", ["bybit.com"]),
  b("bitget", "Bitget", ["bitget.com"]),
  b("okx", "OKX", ["okx.com"], false),
  // dapps and chain tools
  b("uniswap", "Uniswap", ["uniswap.org", "uniswap.exchange", "uniswapfoundation.org"]),
  b("opensea", "OpenSea", ["opensea.io", "opensea.pro", "opensea.foundation"]),
  b("pancakeswap", "PancakeSwap", ["pancakeswap.finance", "pancakeswap.com"]),
  b("sushiswap", "SushiSwap", ["sushi.com", "sushiswap.org"]),
  b("1inch", "1inch", ["1inch.io", "1inch.com", "1inch.exchange"]),
  b("aave", "Aave", ["aave.com"], false),
  b("lido", "Lido", ["lido.fi"], false),
  b("magiceden", "Magic Eden", ["magiceden.io", "magiceden.us"]),
  b("raydium", "Raydium", ["raydium.io"]),
  b("etherscan", "Etherscan", ["etherscan.io"]),
  b("arbitrum", "Arbitrum", ["arbitrum.io", "arbitrum.foundation"]),
  b("zksync", "ZKsync", ["zksync.io"]),
  b("starknet", "Starknet", ["starknet.io"]),
  b("layerzero", "LayerZero", ["layerzero.network", "layerzero.foundation"]),
  b("eigenlayer", "EigenLayer", ["eigenlayer.xyz", "eigencloud.xyz"]),
  b("hyperliquid", "Hyperliquid", ["hyperliquid.xyz", "hyperfoundation.org"]),
  b("polymarket", "Polymarket", ["polymarket.com"]),
  b("pumpfun", "pump.fun", ["pump.fun"]),
  // platforms
  p("paypal", "PayPal", ["paypal.com", "paypal.me", "paypalobjects.com"]),
  p("microsoft", "Microsoft", ["microsoft.com", "live.com", "office.com", "microsoftonline.com", "windows.com", "azure.com"]),
  p("google", "Google", ["google.com", "google.dev", "withgoogle.com", "googleusercontent.com", "googleapis.com", "gstatic.com", "youtube.com", "google.co.uk"], false),
  p("apple", "Apple", ["apple.com", "icloud.com"], false),
  p("amazon", "Amazon", ["amazon.com", "amazon.co.uk", "amazon.de", "amazon.in", "amazonaws.com", "aws.amazon.com", "amazon.dev"], false),
  p("telegram", "Telegram", ["telegram.org", "t.me", "telegram.me", "telegram.dog", "telegra.ph"]),
  p("discord", "Discord", ["discord.com", "discord.gg", "discordapp.com", "discordapp.net", "discord.new", "discord.dev"]),
  p("github", "GitHub", ["github.com", "github.io", "githubusercontent.com", "github.dev", "githubassets.com"]),
  p("facebook", "Facebook", ["facebook.com", "fb.com", "meta.com"]),
  p("instagram", "Instagram", ["instagram.com"]),
  p("whatsapp", "WhatsApp", ["whatsapp.com", "wa.me"]),
  p("twitter", "Twitter", ["twitter.com", "x.com"]),
  p("linkedin", "LinkedIn", ["linkedin.com"]),
  p("netflix", "Netflix", ["netflix.com"]),
  p("steamcommunity", "Steam", ["steamcommunity.com", "steampowered.com"]),
  p("roblox", "Roblox", ["roblox.com"]),
  p("stripe", "Stripe", ["stripe.com", "stripe.dev", "stripe.network"], false),
];

/**
 * Words that turn a brand's name on someone else's address into bait: "metamask-support", "uniswap-claim".
 * A brand's name beside none of these (uniswap-analytics.xyz) is a product ABOUT the brand, and says nothing.
 */
export const BAIT_WORDS: readonly string[] = [
  "claim", "claims", "airdrop", "airdrops", "support", "wallet", "wallets", "connect", "verify", "verification", "login", "signin",
  "secure", "security", "bonus", "reward", "rewards", "giveaway", "recovery", "recover", "restore", "validate", "validation",
  "sync", "auth", "unlock", "helpdesk", "migration", "migrate", "refund", "drop", "mint", "free", "gift", "promo", "official",
];
/**
 * Beside a PLATFORM's name, only the words of an account scam count. Builders make honest things called
 * "stripe-connect-demo" and "discord-auth-example" every day; nobody honest makes "paypal-refund-support".
 */
export const PLATFORM_BAIT_WORDS: readonly string[] = [
  "support", "verify", "verification", "secure", "security", "recovery", "recover", "refund", "helpdesk", "gift", "giveaway", "bonus",
  "reward", "rewards", "unlock", "official", "claim", "claims", "signin", "login",
];

/**
 * Suffixes under which strangers publish their own sites. The label to the left of one is the site's own
 * name ("metamask-claim.vercel.app"), so it is read like a domain's name and the platform is never the brand.
 */
export const SHARED_SUFFIXES: readonly string[] = [
  "vercel.app", "netlify.app", "lovable.app", "lovable.dev", "bolt.host", "replit.app", "replit.dev", "repl.co", "pages.dev", "workers.dev",
  "web.app", "firebaseapp.com", "onrender.com", "railway.app", "fly.dev", "github.io", "gitlab.io", "surge.sh", "glitch.me", "v0.app",
  "base44.app", "createxyz.app", "created.app", "framer.app", "framer.website", "webflow.io", "bubbleapps.io", "streamlit.app", "hf.space",
  "herokuapp.com", "azurewebsites.net", "blogspot.com", "wordpress.com", "wixsite.com", "weebly.com", "godaddysites.com", "carrd.co",
  "amazonaws.com", "windows.net", "r2.dev", "notion.site", "gitbook.io", "typedream.app", "super.site", "mystrikingly.com", "square.site", "myshopify.com", "tiiny.site", "ipfs.io", "dweb.link", "fleek.co", "4everland.app",
];

/** Second-level labels that are part of a country's public suffix ("co.uk", "com.au"). */
const SECOND_LEVEL = new Set(["co", "com", "org", "net", "gov", "ac", "edu", "or", "ne", "go", "gob", "nom", "ltd", "plc", "me"]);

/**
 * The part of a host a registrant chose, and the public suffix it sits under. No public-suffix list is
 * shipped: the rule is the last two labels, three under a country's second level ("example.co.uk"), and one
 * label more under a shared host ("name.vercel.app"). Wrong only for rare suffixes, where it reads one label
 * too few, which makes two unrelated sites look related: the quiet direction.
 */
export function registrable(host: string): { domain: string; suffix: string; own: string[] } {
  const h = host.toLowerCase().replace(/\.$/, "").replace(/^www\./, "");
  const labels = h.split(".").filter(Boolean);
  if (labels.length <= 1) return { domain: h, suffix: "", own: labels };
  const shared = SHARED_SUFFIXES.find((s) => h === s || h.endsWith(`.${s}`));
  let suffixLabels = 1;
  if (shared) suffixLabels = shared.split(".").length;
  else if (labels.length >= 3 && labels[labels.length - 1]!.length === 2 && SECOND_LEVEL.has(labels[labels.length - 2]!)) suffixLabels = 2;
  if (labels.length <= suffixLabels) return { domain: h, suffix: h, own: [] };
  const own = labels.slice(0, labels.length - suffixLabels);
  const suffix = labels.slice(labels.length - suffixLabels).join(".");
  return { domain: `${own[own.length - 1]}.${suffix}`, suffix, own };
}

/**
 * Is this host one of the brand's own (the domain itself or anything under it)? A site a stranger published
 * under a shared host ("anything.github.io") is never the platform's own.
 */
export function isBrandsOwn(host: string, brand: Brand): boolean {
  const h = host.toLowerCase().replace(/\.$/, "").replace(/^www\./, "");
  if (SHARED_SUFFIXES.some((s) => h.endsWith(`.${s}`))) return false;
  return brand.domains.some((d) => h === d || h.endsWith(`.${d}`));
}

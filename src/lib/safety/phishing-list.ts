import "server-only";
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { compilePhishingList, type PhishingConfig, type PhishingList } from "./product-screen";

/**
 * METAMASK'S PHISHING LIST, kept on the server.
 *
 * Source: https://github.com/MetaMask/eth-phishing-detect, `src/config.json` (version, tolerance, fuzzylist,
 * whitelist, blacklist; about 120,000 blocked domains and 3.6 MB on 22 Nov 2026).
 *
 * Licence, checked 22 Nov 2026: the "Don't Be A Dick" Public License v1.2 (copyright 2018 kumavis). It
 * permits any use of the work, including this one. Sage reads the list as data, credits it by name wherever
 * a refusal cites it, never republishes or sells it, and never ships a copy in this repository (the test
 * fixture is hand-written, with made-up domains).
 *
 * Fetched at most once a day, to one file under var/ (git-ignored). Never in a test. A copy that cannot be
 * refreshed keeps being used for a week; with no copy at all the screen says the list was unavailable and
 * every other check still runs.
 */
export const PHISHING_LIST_URL = "https://raw.githubusercontent.com/MetaMask/eth-phishing-detect/main/src/config.json";
const DAY_MS = 24 * 3600_000;
const STALE_MS = 7 * DAY_MS;
const MAX_BYTES = 24 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 20_000;
/** after a failed fetch, do not ask again for this long */
const RETRY_MS = 3600_000;

const filePath = (): string => process.env.PHISHING_LIST_PATH?.trim() || path.join(process.cwd(), "var", "phishing-list.json");

interface State {
  list: PhishingList | null;
  /** the file's mtime the in-memory copy was read from */
  loadedMtime: number;
  refreshing: Promise<PhishingList | null> | null;
  lastAttempt: number;
}
const g = globalThis as typeof globalThis & { __sagePhishingList?: State };
const state: State = (g.__sagePhishingList ??= { list: null, loadedMtime: 0, refreshing: null, lastAttempt: 0 });

function isConfig(v: unknown): v is PhishingConfig {
  const c = v as Partial<PhishingConfig> | null;
  return !!c && Array.isArray(c.blacklist) && Array.isArray(c.whitelist) && Array.isArray(c.fuzzylist) && c.blacklist.length > 0;
}

/** The copy on disk, read once per change of the file. Null when there is none or it is unreadable. */
function fromDisk(): PhishingList | null {
  const file = filePath();
  try {
    if (!existsSync(file)) return null;
    const mtime = statSync(file).mtimeMs;
    if (state.list && state.loadedMtime === mtime) return state.list;
    const parsed: unknown = JSON.parse(readFileSync(file, "utf8"));
    if (!isConfig(parsed)) return null;
    state.list = compilePhishingList(parsed, mtime);
    state.loadedMtime = mtime;
    return state.list;
  } catch {
    return null;
  }
}

/**
 * The list as the server has it NOW, without touching the network: what a launch door asks. Null when no
 * copy exists or the copy is more than a week old (an old list is not evidence of anything).
 */
export function phishingListNow(nowMs = Date.now()): PhishingList | null {
  const list = fromDisk();
  if (!list) return null;
  return nowMs - list.fetchedAt > STALE_MS ? null : list;
}

/** Tests never fetch. So does any process told not to (`PHISHING_LIST=off`). */
function mayFetch(): boolean {
  if (process.env.VITEST || process.env.NODE_ENV === "test") return false;
  return (process.env.PHISHING_LIST ?? "").trim().toLowerCase() !== "off";
}

async function download(fetchImpl: typeof fetch): Promise<PhishingList | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetchImpl(PHISHING_LIST_URL, { signal: controller.signal, headers: { accept: "application/json", "user-agent": "phishing-list-reader" }, redirect: "error" });
    if (!res.ok) return null;
    const body = await res.text();
    if (body.length > MAX_BYTES) return null;
    const parsed: unknown = JSON.parse(body);
    if (!isConfig(parsed)) return null;
    const file = filePath();
    mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    // only what the screen reads is kept, so the file is the list and nothing else
    writeFileSync(tmp, JSON.stringify({ version: parsed.version, tolerance: parsed.tolerance, fuzzylist: parsed.fuzzylist, whitelist: parsed.whitelist, blacklist: parsed.blacklist }));
    renameSync(tmp, file);
    return fromDisk();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The list for a screen that is about to run. A copy from today is returned at once. An older copy is
 * returned at once too, and refreshed in the background. With no copy, the fetch is awaited (bounded), so the
 * first product a fresh server screens is still checked.
 */
export async function phishingListForScreen(deps: { fetch?: typeof fetch; nowMs?: number } = {}): Promise<PhishingList | null> {
  const nowMs = deps.nowMs ?? Date.now();
  const have = fromDisk();
  const fresh = have && nowMs - have.fetchedAt < DAY_MS;
  if (fresh || !mayFetch()) return have && nowMs - have.fetchedAt <= STALE_MS ? have : null;
  if (!state.refreshing && nowMs - state.lastAttempt > RETRY_MS) {
    state.lastAttempt = nowMs;
    state.refreshing = download(deps.fetch ?? fetch).finally(() => {
      state.refreshing = null;
    });
  }
  if (have && nowMs - have.fetchedAt <= STALE_MS) return have;
  return state.refreshing ? await state.refreshing : null;
}

/** For the suite: forget the in-memory copy. */
export function resetPhishingListForTest(): void {
  state.list = null;
  state.loadedMtime = 0;
  state.refreshing = null;
  state.lastAttempt = 0;
}

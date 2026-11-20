import "server-only";

/**
 * THE FOUNDER'S SWITCHES FOR SAGE ON X. All read straight from the environment at use, never at boot,
 * so a missing or odd value turns the agent quieter and can never stop the app.
 *
 *   X_AGENT                 off | dry | live      (default off)
 *   X_API_KEY, X_API_SECRET                       the developer app's consumer key and secret
 *   X_ACCESS_TOKEN, X_ACCESS_TOKEN_SECRET         the AGENT account's own token and secret
 *   X_DAILY_BUDGET_USD      a day's ceiling for what X is paid (default 2)
 *   X_REPLIES               on arms the tag flow (default off: X asks for written approval first)
 *   X_INSPECTIONS_DAILY_CAP how many tagged links Sage tries a day (default 10)
 *
 * `live` without all four credentials is treated as `dry`: the agent records what it would post and
 * sends nothing, which is the honest reading of "switched on but not set up".
 */
export type XMode = "off" | "dry" | "live";

export type XCredentials = {
  apiKey: string;
  apiSecret: string;
  accessToken: string;
  accessTokenSecret: string;
};

export function xCredentials(env: NodeJS.ProcessEnv = process.env): XCredentials | null {
  const apiKey = env.X_API_KEY?.trim();
  const apiSecret = env.X_API_SECRET?.trim();
  const accessToken = env.X_ACCESS_TOKEN?.trim();
  const accessTokenSecret = env.X_ACCESS_TOKEN_SECRET?.trim();
  if (!apiKey || !apiSecret || !accessToken || !accessTokenSecret) return null;
  return { apiKey, apiSecret, accessToken, accessTokenSecret };
}

export function xMode(env: NodeJS.ProcessEnv = process.env): XMode {
  const raw = env.X_AGENT?.trim().toLowerCase();
  if (raw === "dry") return "dry";
  if (raw === "live") return xCredentials(env) ? "live" : "dry";
  return "off";
}

export function xRepliesOn(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.X_REPLIES?.trim().toLowerCase() === "on";
}

function positive(raw: string | undefined, fallback: number): number {
  const n = Number(raw?.trim());
  return Number.isFinite(n) && n >= 0 && raw?.trim() ? n : fallback;
}

/** The day's ceiling in millionths of a dollar. */
export function xDailyBudgetMicros(env: NodeJS.ProcessEnv = process.env): number {
  return Math.round(positive(env.X_DAILY_BUDGET_USD, 2) * 1_000_000);
}

export function xInspectionsDailyCap(env: NodeJS.ProcessEnv = process.env): number {
  return Math.floor(positive(env.X_INSPECTIONS_DAILY_CAP, 10));
}

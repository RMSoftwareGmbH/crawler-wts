export interface GoogleScrollConfig {
  /** GOOGLE_MAX_SCROLL_ATTEMPTS: hard cap on scroll steps per crawl. */
  maxScrollAttempts: number;
  /** GOOGLE_REVIEW_SCROLL_WAIT_MS: max wait for new cards after each scroll. */
  scrollWaitMs: number;
  /** GOOGLE_NO_PROGRESS_LIMIT: cardless steps tolerated while the list still moves. */
  noProgressLimit: number;
  /** GOOGLE_CRAWL_TIMEOUT_MS: total time budget for the scrolling phase. */
  crawlTimeoutMs: number;
}

export const GOOGLE_SCROLL_DEFAULTS: GoogleScrollConfig = {
  maxScrollAttempts: 50,
  scrollWaitMs: 1_000,
  noProgressLimit: 3,
  crawlTimeoutMs: 120_000,
};

function readPositiveInt(
  env: NodeJS.ProcessEnv,
  name: string,
  fallback: number,
): number {
  const raw = env[name];
  if (raw === undefined || raw.trim() === "") {
    return fallback;
  }
  const value = raw.trim();
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value))) {
    throw new Error(`${name} must be a positive integer.`);
  }
  const parsed = Number(value);
  if (parsed <= 0) {
    throw new Error(`${name} must be a positive integer.`);
  }
  return parsed;
}

/**
 * Reads the scroll settings from the environment. Explicit overrides win over
 * the environment, which wins over the defaults. Invalid values throw.
 */
export function loadGoogleScrollConfig(
  env: NodeJS.ProcessEnv = process.env,
  overrides: Partial<GoogleScrollConfig> = {},
): GoogleScrollConfig {
  return {
    maxScrollAttempts:
      overrides.maxScrollAttempts ??
      readPositiveInt(
        env,
        "GOOGLE_MAX_SCROLL_ATTEMPTS",
        GOOGLE_SCROLL_DEFAULTS.maxScrollAttempts,
      ),
    scrollWaitMs:
      overrides.scrollWaitMs ??
      readPositiveInt(
        env,
        "GOOGLE_REVIEW_SCROLL_WAIT_MS",
        GOOGLE_SCROLL_DEFAULTS.scrollWaitMs,
      ),
    noProgressLimit:
      overrides.noProgressLimit ??
      readPositiveInt(
        env,
        "GOOGLE_NO_PROGRESS_LIMIT",
        GOOGLE_SCROLL_DEFAULTS.noProgressLimit,
      ),
    crawlTimeoutMs:
      overrides.crawlTimeoutMs ??
      readPositiveInt(
        env,
        "GOOGLE_CRAWL_TIMEOUT_MS",
        GOOGLE_SCROLL_DEFAULTS.crawlTimeoutMs,
      ),
  };
}

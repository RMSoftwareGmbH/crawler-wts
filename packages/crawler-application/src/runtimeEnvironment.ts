import type { ReviewSource } from "../../crawler-contracts/src/source/sourceType.js";
import { createDecodoProxyConfiguration } from "../../crawler-core/src/proxy/decodoProvider.js";
import {
  loadMongoPersistenceConfig,
  type MongoPersistenceConfig,
} from "../../review-persistence/src/config.js";

export interface RuntimeEnvironmentOptions {
  source: ReviewSource;
  persist: boolean;
  proxyEnabledOverride?: boolean;
}

export interface RuntimeEnvironment {
  proxyEnabled: boolean;
  mongoPersistenceConfig?: MongoPersistenceConfig;
}

const GOOGLE_BOOLEAN_SETTINGS = [
  "GOOGLE_CRAWLER_HEADED",
  "GOOGLE_CRAWLER_INTERACT",
  "GOOGLE_CRAWLER_OPTIMIZE",
  "GOOGLE_CRAWLER_DIAGNOSTIC_SCREENSHOT",
  "GOOGLE_CRAWLER_DOM_DIAGNOSTIC",
  "GOOGLE_CRAWLER_DIAGNOSTIC_SNAPSHOT",
  "GOOGLE_CRAWLER_ALLOW_LEGACY_SCROLL",
  "GOOGLE_DIAG_HEADLESS",
] as const;

const GOOGLE_NON_NEGATIVE_INTEGER_SETTINGS = [
  "GOOGLE_CRAWLER_SETTLE_MS",
  "GOOGLE_CRAWLER_PANEL_WAIT_MS",
  "GOOGLE_CRAWLER_INTERACTION_WAIT_MS",
  "GOOGLE_CRAWLER_PAGINATION_WAIT_MS",
  "GOOGLE_DIAG_PAUSE_MS",
] as const;

const GOOGLE_POSITIVE_INTEGER_SETTINGS = [
  "GOOGLE_MAX_REVIEWS_PER_RUN",
  "GOOGLE_MAX_SCROLL_ATTEMPTS",
  "GOOGLE_REVIEW_SCROLL_WAIT_MS",
  "GOOGLE_NO_PROGRESS_LIMIT",
  "GOOGLE_CRAWL_TIMEOUT_MS",
] as const;

function optionalBoolean(
  env: NodeJS.ProcessEnv,
  name: string,
  fallback: boolean,
): boolean {
  const raw = env[name]?.trim().toLowerCase();
  if (!raw) return fallback;
  if (raw === "true") return true;
  if (raw === "false") return false;
  throw new Error(`${name} must be true or false.`);
}

function validateInteger(
  env: NodeJS.ProcessEnv,
  name: string,
  positive: boolean,
): void {
  const raw = env[name]?.trim();
  if (!raw) return;
  if (!/^\d+$/.test(raw)) {
    throw new Error(
      `${name} must be a ${positive ? "positive" : "non-negative"} integer.`,
    );
  }
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || (positive ? value <= 0 : value < 0)) {
    throw new Error(
      `${name} must be a ${positive ? "positive" : "non-negative"} integer.`,
    );
  }
}

function validateGoogleSettings(env: NodeJS.ProcessEnv): void {
  for (const name of GOOGLE_BOOLEAN_SETTINGS) {
    optionalBoolean(env, name, false);
  }
  for (const name of GOOGLE_NON_NEGATIVE_INTEGER_SETTINGS) {
    validateInteger(env, name, false);
  }
  for (const name of GOOGLE_POSITIVE_INTEGER_SETTINGS) {
    validateInteger(env, name, true);
  }

  const diagnosticUrl = env.GOOGLE_DIAG_URL?.trim();
  if (diagnosticUrl) {
    try {
      const url = new URL(diagnosticUrl);
      if (url.protocol !== "http:" && url.protocol !== "https:") {
        throw new Error();
      }
    } catch {
      throw new Error("GOOGLE_DIAG_URL must be a valid HTTP or HTTPS URL.");
    }
  }
}

function validateConfiguredLocale(env: NodeJS.ProcessEnv): void {
  const locale = env.GOOGLE_CRAWLER_LOCALE?.trim();
  if (!locale) return;
  try {
    if (Intl.getCanonicalLocales(locale).length !== 1) {
      throw new Error();
    }
  } catch {
    throw new Error("GOOGLE_CRAWLER_LOCALE must be a valid BCP-47 tag.");
  }
}

export function loadRuntimeEnvironment(
  options: RuntimeEnvironmentOptions,
  env: NodeJS.ProcessEnv = process.env,
): RuntimeEnvironment {
  const configuredProxyEnabled = optionalBoolean(
    env,
    "DECODO_PROXY_ENABLED",
    false,
  );
  const proxyEnabled = options.proxyEnabledOverride ?? configuredProxyEnabled;

  if (proxyEnabled) {
    createDecodoProxyConfiguration(env);
  }
  validateConfiguredLocale(env);
  if (options.source === "google") {
    validateGoogleSettings(env);
  }

  return {
    proxyEnabled,
    ...(options.persist
      ? { mongoPersistenceConfig: loadMongoPersistenceConfig(env) }
      : {}),
  };
}

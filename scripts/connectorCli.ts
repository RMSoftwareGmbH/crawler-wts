import { parseArgs } from "node:util";
import type { ReviewSource } from "../packages/crawler-contracts/src/source/sourceType.js";
import type { CrawlRequest } from "../packages/crawler-core/src/crawler/CrawlRequest.js";
import { isReviewSource } from "../packages/crawler-application/src/connectorRegistry.js";

export interface ConnectorCliOptions {
  source: ReviewSource;
  requests: CrawlRequest[];
  persist: boolean;
  dryRun: boolean;
  showPersistence: boolean;
}

export const CONNECTOR_CLI_USAGE =
  "Usage: pnpm tsx scripts/run-connector.ts --connector <google|tripadvisor|booking|holidaycheck|expedia|hotels-com> --url <hotel-url> [--url <hotel-url> ...] [--max-pages N] [--max-reviews N] [--timeout MS] [--locale TAG] [--proxy|--no-proxy] [--persist|--dry-run]";

function positiveInteger(
  value: string | undefined,
  option: string,
): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`--${option} must be a positive integer.`);
  }
  return parsed;
}

function validHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

export function parseConnectorCliArgs(
  args: readonly string[],
): ConnectorCliOptions {
  const { values } = parseArgs({
    args: [...args],
    allowPositionals: false,
    strict: true,
    options: {
      connector: { type: "string" },
      url: { type: "string", multiple: true },
      "max-pages": { type: "string" },
      "max-reviews": { type: "string" },
      timeout: { type: "string" },
      locale: { type: "string" },
      "last-seen-review-id": { type: "string" },
      "last-successful-crawl-at": { type: "string" },
      "persisted-review-id": { type: "string", multiple: true },
      proxy: { type: "boolean", default: false },
      "no-proxy": { type: "boolean", default: false },
      persist: { type: "boolean", default: false },
      "dry-run": { type: "boolean", default: false },
    },
  });

  if (!values.connector || !isReviewSource(values.connector)) {
    throw new Error(
      `--connector must be one of: google, tripadvisor, booking, holidaycheck, expedia, hotels-com.`,
    );
  }
  const urls = values.url ?? [];
  if (urls.length === 0) {
    throw new Error("--url must be provided at least once.");
  }
  if (urls.some((url) => !validHttpUrl(url))) {
    throw new Error("Every --url value must be a valid HTTP or HTTPS URL.");
  }
  if (values.proxy && values["no-proxy"]) {
    throw new Error("Choose either --proxy or --no-proxy.");
  }
  if (values.persist && values["dry-run"]) {
    throw new Error("Choose either --persist or --dry-run.");
  }

  const maxPages = positiveInteger(values["max-pages"], "max-pages");
  const maxReviews = positiveInteger(values["max-reviews"], "max-reviews");
  const timeoutMs = positiveInteger(values.timeout, "timeout");
  if (values.locale) {
    try {
      Intl.getCanonicalLocales(values.locale);
    } catch {
      throw new Error("--locale must be a valid BCP-47 language tag.");
    }
  }

  const sharedRequestOptions: Omit<CrawlRequest, "url"> = {
    ...(maxPages !== undefined ? { maxPages } : {}),
    ...(maxReviews !== undefined ? { maxReviews } : {}),
    ...(timeoutMs !== undefined ? { timeoutMs } : {}),
    ...(values.locale ? { locale: values.locale } : {}),
    ...(values["last-seen-review-id"]
      ? { lastSeenReviewId: values["last-seen-review-id"] }
      : {}),
    ...(values["last-successful-crawl-at"]
      ? { lastSuccessfulCrawlAt: values["last-successful-crawl-at"] }
      : {}),
    ...(values["persisted-review-id"]
      ? { persistedReviewIds: values["persisted-review-id"] }
      : {}),
    ...(values.proxy ? { proxyEnabled: true } : {}),
    ...(values["no-proxy"] ? { proxyEnabled: false } : {}),
  };

  return {
    source: values.connector,
    requests: urls.map((url) => ({ ...sharedRequestOptions, url })),
    persist: values.persist,
    dryRun: !values.persist,
    showPersistence: values.persist || values["dry-run"],
  };
}

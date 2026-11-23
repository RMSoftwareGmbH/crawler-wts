import { randomUUID } from "node:crypto";
import type { ReviewSource } from "../../crawler-contracts/src/source/sourceType.js";
import type {
  CrawlDiagnostics,
  CrawlFailure,
  CrawlRequest,
  CrawlResult,
  ReviewConnector,
} from "../../crawler-core/src/index.js";
import { CrawlError } from "../../crawler-core/src/index.js";
import {
  ReviewPersistenceError,
  ReviewPersistenceService,
  type ReviewPersistenceResult,
} from "../../review-persistence/src/index.js";

export interface CrawlAndPersistOptions {
  persist?: boolean;
}

export interface CrawlAndPersistResult {
  crawlResult?: CrawlResult;
  crawlFailure?: CrawlFailure;
  persistenceResult?: ReviewPersistenceResult;
  persistenceFailure?: {
    kind: string;
    message: string;
  };
  persistenceSkippedBecause?: "crawl_failed";
}

function safeConnectorFailure(error: unknown): CrawlFailure {
  if (error instanceof CrawlError) {
    const message = error.message
      .replace(/https?:\/\/[^\s)"'<>]+/gi, "[URL]")
      .replace(
        /((?:password|token|cookie|authorization|secret|api[_-]?key)\s*[=:]\s*)[^\s&]+/gi,
        "$1[redacted]",
      )
      .slice(0, 500);
    return { classification: error.classification, message };
  }
  return {
    classification: "browser_failure",
    message: "The connector could not complete the crawl.",
  };
}

function persistenceFailure(error: unknown): {
  kind: string;
  message: string;
} {
  if (error instanceof ReviewPersistenceError) {
    return { kind: error.kind, message: error.message };
  }
  return {
    kind: "operation",
    message: "Review persistence failed.",
  };
}

function safeUrl(value: string): string {
  try {
    const url = new URL(value);
    url.username = "";
    url.password = "";
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return "[invalid URL]";
  }
}

export class CrawlAndPersistService {
  constructor(
    private readonly source: ReviewSource,
    private readonly connector: ReviewConnector,
    private readonly persistence: ReviewPersistenceService,
  ) {}

  async run(
    request: CrawlRequest,
    options: CrawlAndPersistOptions = {},
  ): Promise<CrawlAndPersistResult> {
    let crawlResult: CrawlResult;
    try {
      crawlResult = await this.connector.crawl(request);
    } catch (error) {
      return {
        crawlFailure: safeConnectorFailure(error),
        persistenceSkippedBecause: "crawl_failed",
      };
    }
    return this.persistCrawlResult(crawlResult, options);
  }

  async runBatch(
    requests: readonly CrawlRequest[],
    options: CrawlAndPersistOptions = {},
  ): Promise<CrawlAndPersistResult[]> {
    if (requests.length === 0) return [];

    let crawlResults: CrawlResult[];
    if (this.connector.crawlBatch) {
      try {
        crawlResults = await this.connector.crawlBatch(requests);
      } catch (error) {
        const crawlFailure = safeConnectorFailure(error);
        return requests.map(() => ({
          crawlFailure,
          persistenceSkippedBecause: "crawl_failed",
        }));
      }
      if (crawlResults.length !== requests.length) {
        const crawlFailure: CrawlFailure = {
          classification: "browser_failure",
          message: "The connector returned an incomplete batch result.",
        };
        return requests.map(() => ({
          crawlFailure,
          persistenceSkippedBecause: "crawl_failed",
        }));
      }
    } else {
      crawlResults = [];
      for (const request of requests) {
        try {
          crawlResults.push(await this.connector.crawl(request));
        } catch (error) {
          const failure = safeConnectorFailure(error);
          crawlResults.push(this.failedCrawlResult(request, failure));
        }
      }
    }

    const results: CrawlAndPersistResult[] = [];
    for (const crawlResult of crawlResults) {
      results.push(await this.persistCrawlResult(crawlResult, options));
    }
    return results;
  }

  private async persistCrawlResult(
    crawlResult: CrawlResult,
    options: CrawlAndPersistOptions,
  ): Promise<CrawlAndPersistResult> {
    if (!crawlResult.success) {
      return {
        crawlResult,
        persistenceSkippedBecause: "crawl_failed",
      };
    }

    try {
      const persistenceResult = await this.persistence.persist(
        crawlResult.reviews,
        { persist: options.persist === true },
      );
      return { crawlResult, persistenceResult };
    } catch (error) {
      return {
        crawlResult,
        persistenceFailure: persistenceFailure(error),
      };
    }
  }

  private failedCrawlResult(
    request: CrawlRequest,
    failure: CrawlFailure,
  ): CrawlResult {
    const now = new Date().toISOString();
    const diagnostics: CrawlDiagnostics = {
      crawlId: randomUUID(),
      source: this.source,
      hotelUrl: safeUrl(request.url),
      startedAt: now,
      finishedAt: now,
      pagesVisited: 0,
      reviewsExtracted: 0,
      reviewsAccepted: 0,
      duplicatesRemoved: 0,
      retries: 0,
      crawlerVersion: "unknown",
      consentPageDetected: failure.classification === "consent_page",
      challengePageDetected: failure.classification === "challenge_page",
      authenticationPageDetected:
        failure.classification === "authentication_required",
      restrictedMapsViewDetected:
        failure.classification === "restricted_maps_view",
      pageClassification: failure.classification,
      failure,
    };
    return { success: false, reviews: [], diagnostics };
  }
}

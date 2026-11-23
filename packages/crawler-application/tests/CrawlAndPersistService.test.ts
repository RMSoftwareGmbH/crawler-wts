import { describe, expect, it, vi } from "vitest";
import {
  canonicalReviewSchema,
  type ReviewSource,
} from "../../crawler-contracts/src/index.js";
import {
  CrawlError,
  type CrawlDiagnostics,
  type CrawlRequest,
  type CrawlResult,
  type ReviewConnector,
} from "../../crawler-core/src/index.js";
import {
  ReviewPersistenceService,
  type ReviewRepository,
} from "../../review-persistence/src/index.js";
import { CrawlAndPersistService } from "../src/CrawlAndPersistService.js";

const request: CrawlRequest = {
  url: "https://www.google.com/maps/place/example-hotel",
};
const review = canonicalReviewSchema.parse({
  source: "google",
  externalReviewId: "review-001",
  hotel: { name: "Example Hotel", url: request.url },
  rating: { value: 4.5, scale: 5 },
  comment: "Test-only review text.",
  sourceMetadata: {
    sourceUrl: request.url,
    fetchedAt: "2026-01-11T00:00:00.000Z",
    crawlerVersion: "1.0.0",
    schemaVersion: "1.0.0",
  },
});

function diagnostics(
  source: ReviewSource = "google",
  failure?: CrawlDiagnostics["failure"],
): CrawlDiagnostics {
  return {
    crawlId: "test-crawl",
    source,
    hotelUrl: request.url,
    startedAt: "2026-01-11T00:00:00.000Z",
    finishedAt: "2026-01-11T00:00:01.000Z",
    pagesVisited: failure ? 1 : 1,
    reviewsExtracted: failure ? 0 : 1,
    reviewsAccepted: failure ? 0 : 1,
    duplicatesRemoved: 0,
    retries: 0,
    crawlerVersion: "1.0.0",
    consentPageDetected: false,
    challengePageDetected: false,
    authenticationPageDetected: false,
    restrictedMapsViewDetected: false,
    ...(failure ? { failure, pageClassification: failure.classification } : {}),
  };
}

function successResult(source: ReviewSource = "google"): CrawlResult {
  return {
    success: true,
    reviews: [review],
    diagnostics: diagnostics(source),
  };
}

function blockedResult(): CrawlResult {
  const failure = {
    classification: "blocked_page" as const,
    message: "The public crawl was blocked.",
  };
  return {
    success: false,
    reviews: [],
    diagnostics: diagnostics("google", failure),
  };
}

function repository(
  upsertMany = vi.fn(async () => ({
    inserted: 1,
    updated: 0,
    skipped: 0,
    failed: 0,
  })),
): ReviewRepository {
  return {
    upsert: vi.fn(),
    upsertMany,
    find: vi.fn(),
  };
}

describe("CrawlAndPersistService", () => {
  it("returns separate crawl and dry-run persistence results by default", async () => {
    const connector: ReviewConnector = {
      crawl: vi.fn(async () => successResult()),
    };
    const persistence = new ReviewPersistenceService();
    const service = new CrawlAndPersistService(
      "google",
      connector,
      persistence,
    );

    const result = await service.run(request);

    expect(result.crawlResult?.success).toBe(true);
    expect(result.persistenceResult).toEqual({
      inserted: 0,
      updated: 0,
      skipped: 1,
      failed: 0,
      dryRun: true,
    });
  });

  it("writes only when persistence is explicitly enabled", async () => {
    const mockRepository = repository();
    const service = new CrawlAndPersistService(
      "google",
      { crawl: async () => successResult() },
      new ReviewPersistenceService(mockRepository),
    );

    const dryRun = await service.run(request, { persist: false });
    expect(dryRun.persistenceResult?.dryRun).toBe(true);
    expect(mockRepository.upsertMany).not.toHaveBeenCalled();

    const persisted = await service.run(request, { persist: true });
    expect(persisted.persistenceResult).toMatchObject({
      inserted: 1,
      dryRun: false,
    });
    expect(mockRepository.upsertMany).toHaveBeenCalledOnce();
  });

  it("does not turn blocked crawls into successful empty results or persist them", async () => {
    const mockRepository = repository();
    const service = new CrawlAndPersistService(
      "google",
      { crawl: async () => blockedResult() },
      new ReviewPersistenceService(mockRepository),
    );

    const result = await service.run(request, { persist: true });

    expect(result.crawlResult?.success).toBe(false);
    expect(result.crawlResult?.diagnostics.failure?.classification).toBe(
      "blocked_page",
    );
    expect(result.crawlResult?.reviews).toEqual([]);
    expect(result.persistenceSkippedBecause).toBe("crawl_failed");
    expect(result.persistenceResult).toBeUndefined();
    expect(mockRepository.upsertMany).not.toHaveBeenCalled();
  });

  it("keeps crawl and persistence failures visible for each batch item", async () => {
    const mockRepository = repository(
      vi.fn(async () => ({
        inserted: 0,
        updated: 0,
        skipped: 0,
        failed: 1,
      })),
    );
    const connector: ReviewConnector = {
      crawl: vi.fn(),
      crawlBatch: vi.fn(async () => [successResult(), blockedResult()]),
    };
    const service = new CrawlAndPersistService(
      "google",
      connector,
      new ReviewPersistenceService(mockRepository),
    );

    const results = await service.runBatch([request, request], {
      persist: true,
    });

    expect(results[0]?.crawlResult?.success).toBe(true);
    expect(results[0]?.persistenceResult?.failed).toBe(1);
    expect(results[1]?.crawlResult?.success).toBe(false);
    expect(results[1]?.persistenceSkippedBecause).toBe("crawl_failed");
    expect(mockRepository.upsertMany).toHaveBeenCalledOnce();
  });

  it("reports unexpected connector exceptions without leaking URL credentials", async () => {
    const credentialedRequest = {
      url: "https://user:secret@example.com/hotel",
    };
    const connector: ReviewConnector = {
      crawl: async () => {
        throw new CrawlError(
          "navigation_failure",
          "Navigation failed for https://user:secret@example.com/hotel?token=hidden",
        );
      },
    };
    const service = new CrawlAndPersistService(
      "google",
      connector,
      new ReviewPersistenceService(),
    );

    const result = await service.run(credentialedRequest);

    expect(result.crawlFailure?.classification).toBe("navigation_failure");
    expect(result.crawlFailure?.message).not.toContain("secret");
    expect(result.crawlFailure?.message).not.toContain("token=hidden");
    expect(result.persistenceSkippedBecause).toBe("crawl_failed");
  });

  it("reports persistence exceptions separately from a successful crawl", async () => {
    const mockRepository = repository(
      vi.fn(async () => {
        throw new Error("mongodb://user:private-password@host");
      }),
    );
    const service = new CrawlAndPersistService(
      "google",
      { crawl: async () => successResult() },
      new ReviewPersistenceService(mockRepository),
    );

    const result = await service.run(request, { persist: true });

    expect(result.crawlResult?.success).toBe(true);
    expect(result.persistenceFailure?.message).toBe(
      "Review persistence failed.",
    );
    expect(result.persistenceFailure?.message).not.toContain(
      "private-password",
    );
  });
});

import { readFile } from "node:fs/promises";
import { describe, expect, it, vi } from "vitest";
import { FixturePage } from "../../google/tests/fixturePage.js";
import { CrawlError } from "../../../crawler-core/src/index.js";
import { TripadvisorCrawler } from "../src/TripadvisorCrawler.js";

const url =
  "https://www.tripadvisor.com/Hotel_Review-g1-d1-Reviews-Example.html";
const fixture = new URL("./fixtures/basic.html", import.meta.url);

function session(page: FixturePage) {
  return { page, close: async () => undefined };
}

describe("TripadvisorCrawler", () => {
  it("returns canonical reviews and deduplicates by external id", async () => {
    const html = await readFile(fixture, "utf8");
    const result = await new TripadvisorCrawler({
      sessionFactory: async () => session(new FixturePage(html)),
      now: () => new Date("2026-06-20T12:00:00.000Z"),
      delayMs: 0,
    }).crawl({ url, maxReviews: 10, maxPages: 2 });

    expect(result.success).toBe(true);
    expect(result.reviews).toHaveLength(2);
    expect(result.reviews[0]).toMatchObject({
      source: "tripadvisor",
      rating: { value: 5, scale: 5 },
    });
    expect(result.diagnostics.pagesVisited).toBe(1);
  });

  it("does not propagate URL credentials or query tokens into output", async () => {
    const sensitiveUrl =
      "https://www.tripadvisor.com/Hotel_Review-g1-d1-Reviews-Example.html?token=fixture-token";
    const result = await new TripadvisorCrawler({
      sessionFactory: async () =>
        session(new FixturePage(await readFile(fixture, "utf8"))),
      maxRetries: 0,
      delayMs: 0,
    }).crawl({ url: sensitiveUrl });
    const serialized = JSON.stringify(result);

    expect(result.success).toBe(true);
    expect(result.reviews[0]?.hotel.url).toBe(url);
    expect(result.reviews[0]?.sourceMetadata.sourceUrl).toBe(url);
    expect(serialized).not.toContain("fixture-user");
    expect(serialized).not.toContain("fixture-password");
    expect(serialized).not.toContain("fixture-token");

    const credentialUrl =
      "https://fixture-user:fixture-password@www.tripadvisor.com/Hotel_Review-g1-d1-Reviews-Example.html";
    const credentialResult = await new TripadvisorCrawler({
      sessionFactory: async () =>
        session(new FixturePage(await readFile(fixture, "utf8"))),
      maxRetries: 0,
    }).crawl({ url: credentialUrl });
    expect(credentialResult.success).toBe(false);
    expect(credentialResult.diagnostics.failure?.classification).toBe(
      "invalid_page",
    );
    expect(JSON.stringify(credentialResult)).not.toContain("fixture-user");
    expect(JSON.stringify(credentialResult)).not.toContain("fixture-password");
  });

  it("fails safely on challenge pages without attempting to bypass them", async () => {
    const page = new FixturePage(
      "<html><head><title>Verify you are human</title></head><body>captcha challenge</body></html>",
    );
    const result = await new TripadvisorCrawler({
      sessionFactory: async () => session(page),
    }).crawl({ url });
    expect(result.success).toBe(false);
    expect(result.reviews).toEqual([]);
    expect(result.diagnostics.failure?.classification).toBe("challenge_page");
    expect(result.diagnostics.challengePageDetected).toBe(true);
  });

  it("fails safely on consent pages", async () => {
    const page = new FixturePage(
      "<html><head><title>Cookie consent</title></head><body>Accept cookies</body></html>",
    );
    const result = await new TripadvisorCrawler({
      sessionFactory: async () => session(page),
    }).crawl({ url });
    expect(result.success).toBe(false);
    expect(result.diagnostics.failure?.classification).toBe("consent_page");
    expect(result.diagnostics.consentPageDetected).toBe(true);
  });

  it("classifies HTTP 403 as a blocked page instead of a successful empty crawl", async () => {
    const page = new FixturePage(
      "<html><head><title>Access denied</title></head><body>DataDome blocked this request.</body></html>",
      403,
    );
    const result = await new TripadvisorCrawler({
      sessionFactory: async () => session(page),
    }).crawl({ url });
    expect(result.success).toBe(false);
    expect(result.reviews).toEqual([]);
    expect(result.diagnostics.navigationStatus).toBe(403);
    expect(result.diagnostics.failure?.classification).toBe("blocked_page");
  });

  it("classifies HTTP 429 as a truthful blocked-page failure", async () => {
    const page = new FixturePage(
      "<html><body>Too many requests</body></html>",
      429,
    );
    const result = await new TripadvisorCrawler({
      sessionFactory: async () => session(page),
      maxRetries: 0,
    }).crawl({ url });

    expect(result.success).toBe(false);
    expect(result.reviews).toEqual([]);
    expect(result.diagnostics.failure?.classification).toBe("blocked_page");
  });

  it("classifies authentication pages and always closes the session", async () => {
    const page = new FixturePage(
      "<html><head><title>Sign in to continue</title></head><body>Please sign in to view this hotel.</body></html>",
    );
    const close = vi.fn(async () => undefined);
    const result = await new TripadvisorCrawler({
      sessionFactory: async () => ({ page, close }),
      maxRetries: 0,
    }).crawl({ url });

    expect(result.success).toBe(false);
    expect(result.diagnostics.failure?.classification).toBe(
      "authentication_required",
    );
    expect(result.diagnostics.authenticationPageDetected).toBe(true);
    expect(close).toHaveBeenCalledOnce();
  });

  it("uses request locale and optional Decodo proxy settings", async () => {
    const page = new FixturePage(await readFile(fixture, "utf8"));
    const sessionFactory = vi.fn(async () => session(page));
    const result = await new TripadvisorCrawler({
      sessionFactory,
      maxRetries: 0,
      delayMs: 0,
    }).crawl({
      url,
      locale: "fr-FR",
      proxyEnabled: true,
    });

    expect(result.success).toBe(true);
    expect(sessionFactory).toHaveBeenCalledWith({
      proxyEnabled: true,
      locale: "fr-FR",
    });
  });

  it("uses the configured default proxy only when the request does not override it", async () => {
    const original = process.env.DECODO_PROXY_ENABLED;
    process.env.DECODO_PROXY_ENABLED = "true";
    try {
      const page = new FixturePage(await readFile(fixture, "utf8"));
      const sessionFactory = vi.fn(async () => session(page));
      const result = await new TripadvisorCrawler({
        sessionFactory,
        maxRetries: 0,
        delayMs: 0,
      }).crawl({ url });

      expect(result.success).toBe(true);
      expect(sessionFactory).toHaveBeenCalledWith(
        expect.objectContaining({ proxyEnabled: true }),
      );
      await new TripadvisorCrawler({
        sessionFactory,
        maxRetries: 0,
        delayMs: 0,
      }).crawl({ url, proxyEnabled: false });
      expect(sessionFactory).toHaveBeenLastCalledWith(
        expect.objectContaining({ proxyEnabled: false }),
      );
    } finally {
      if (original === undefined) {
        delete process.env.DECODO_PROXY_ENABLED;
      } else {
        process.env.DECODO_PROXY_ENABLED = original;
      }
    }
  });

  it("retries navigation timeouts and reports the retry count", async () => {
    const page = new FixturePage(await readFile(fixture, "utf8"));
    vi.spyOn(page, "goto")
      .mockRejectedValueOnce(new Error("Timeout 1000ms exceeded"))
      .mockImplementationOnce(async (targetUrl) => {
        await FixturePage.prototype.goto.call(page, targetUrl);
        return { status: () => 200 };
      });
    const close = vi.fn(async () => undefined);
    const sessionFactory = vi.fn(async () => ({ page, close }));
    const result = await new TripadvisorCrawler({
      sessionFactory,
      maxRetries: 1,
      retryBaseDelayMs: 0,
      delayMs: 0,
    }).crawl({ url });

    expect(result.success).toBe(true);
    expect(result.diagnostics.retries).toBe(1);
    expect(sessionFactory).toHaveBeenCalledTimes(2);
    expect(close).toHaveBeenCalledTimes(2);
  });

  it("reports configured proxy connection failures without exposing errors", async () => {
    const result = await new TripadvisorCrawler({
      sessionFactory: async () => {
        throw new CrawlError(
          "proxy_failure",
          "Proxy connection failed without credentials.",
        );
      },
      maxRetries: 0,
    }).crawl({ url, proxyEnabled: true });

    expect(result.success).toBe(false);
    expect(result.diagnostics.failure).toMatchObject({
      classification: "proxy_failure",
      message: "Proxy connection failed without credentials.",
    });
  });

  it("paginates bounded public review cards and stops on no progress", async () => {
    const html =
      '<html><body><h1>Example Hotel</h1><article data-automation="reviewCard" data-review-id="first">' +
      '<span data-rating="5"></span><p data-review-text>First review.</p></article>' +
      '<button data-load-more data-next-review-id="second" data-next-rating="4" ' +
      'data-next-comment="Second review.">Load more</button></body></html>';
    const page = new FixturePage(html);
    const result = await new TripadvisorCrawler({
      sessionFactory: async () => session(page),
      maxRetries: 0,
      delayMs: 0,
    }).crawl({ url, maxPages: 3, maxReviews: 10 });

    expect(result.success).toBe(true);
    expect(result.reviews).toHaveLength(2);
    expect(result.diagnostics.pagesVisited).toBe(2);
    expect(result.diagnostics.paginationStoppedBecause).toBe(
      "no_load_more_control",
    );
  });

  it("stops pagination after an unchanged card count", async () => {
    const html =
      '<html><body><article data-automation="reviewCard" data-review-id="first">' +
      '<span data-rating="5"></span><p data-review-text>First review.</p></article>' +
      "<button data-load-more>Load more</button></body></html>";
    const page = new FixturePage(html);
    const result = await new TripadvisorCrawler({
      sessionFactory: async () => session(page),
      maxRetries: 0,
      delayMs: 0,
    }).crawl({ url, maxPages: 3 });

    expect(result.success).toBe(true);
    expect(result.diagnostics.paginationStoppedBecause).toBe("no_progress");
    expect(result.diagnostics.pagesVisited).toBe(2);
  });

  it("honors the max-review and max-page bounds", async () => {
    const html =
      '<html><body><article data-automation="reviewCard" data-review-id="first">' +
      '<span data-rating="5"></span><p data-review-text>First review.</p></article>' +
      "<button data-load-more>Load more</button></body></html>";
    const maxReviewsResult = await new TripadvisorCrawler({
      sessionFactory: async () => session(new FixturePage(html)),
      maxRetries: 0,
      delayMs: 0,
    }).crawl({ url, maxPages: 5, maxReviews: 1 });
    const maxPagesResult = await new TripadvisorCrawler({
      sessionFactory: async () => session(new FixturePage(html)),
      maxRetries: 0,
      delayMs: 0,
    }).crawl({ url, maxPages: 1, maxReviews: 5 });

    expect(maxReviewsResult.reviews).toHaveLength(1);
    expect(maxReviewsResult.diagnostics.paginationStoppedBecause).toBe(
      "max_reviews",
    );
    expect(maxPagesResult.reviews).toHaveLength(1);
    expect(maxPagesResult.diagnostics.paginationStoppedBecause).toBe(
      "max_pages",
    );
    expect(maxPagesResult.diagnostics.pagesVisited).toBe(1);
  });

  it("rejects non-hotel URLs and malformed review markup", async () => {
    const invalidUrl = await new TripadvisorCrawler({
      sessionFactory: async () => session(new FixturePage("")),
      maxRetries: 0,
    }).crawl({
      url: "https://www.tripadvisor.com/Attraction_Review-g1-d1.html",
    });
    const malformed = await new TripadvisorCrawler({
      sessionFactory: async () =>
        session(
          new FixturePage(
            '<html><body><article data-automation="reviewCard"><p data-review-text>Broken.</p></article></body></html>',
          ),
        ),
      maxRetries: 0,
    }).crawl({ url });

    expect(invalidUrl.diagnostics.failure?.classification).toBe("invalid_page");
    expect(malformed.diagnostics.failure?.classification).toBe(
      "selector_drift",
    );
  });
});

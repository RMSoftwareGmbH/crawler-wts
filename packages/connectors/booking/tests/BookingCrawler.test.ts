import { readFile } from "node:fs/promises";
import { describe, expect, it, vi } from "vitest";
import { FixturePage } from "../../google/tests/fixturePage.js";
import { BookingCrawler } from "../src/BookingCrawler.js";

const hotelUrl = "https://www.booking.com/hotel/us/example-hotel.html";
const fixture = new URL("./fixtures/review-cards.html", import.meta.url);

function session(page: FixturePage, close = async () => undefined) {
  return { page, close };
}

async function fixtureHtml(): Promise<string> {
  return readFile(fixture, "utf8");
}

describe("BookingCrawler", () => {
  it("returns canonical reviews with diagnostics and duplicate filtering", async () => {
    const result = await new BookingCrawler({
      sessionFactory: async () => session(new FixturePage(await fixtureHtml())),
      now: () => new Date("2026-06-20T12:00:00.000Z"),
      pageDelayMs: 0,
    }).crawl({ url: hotelUrl });

    expect(result.success).toBe(true);
    expect(result.reviews).toHaveLength(2);
    expect(result.reviews[0]).toMatchObject({
      source: "booking",
      rating: { value: 4.6, scale: 5 },
      hotel: { url: hotelUrl },
    });
    expect(result.diagnostics).toMatchObject({
      source: "booking",
      pagesVisited: 1,
      reviewsExtracted: 2,
      reviewsAccepted: 2,
      stoppedBecause: "no_next_page_control",
    });
  });

  it("does not return persisted IDs, older reviews, or the last-seen review", async () => {
    const persisted = await new BookingCrawler({
      sessionFactory: async () => session(new FixturePage(await fixtureHtml())),
      pageDelayMs: 0,
    }).crawl({
      url: hotelUrl,
      persistedReviewIds: ["booking-review-001"],
    });
    const older = await new BookingCrawler({
      sessionFactory: async () => session(new FixturePage(await fixtureHtml())),
      pageDelayMs: 0,
    }).crawl({
      url: hotelUrl,
      lastSuccessfulCrawlAt: "2026-06-13T00:00:00.000Z",
    });
    const lastSeen = await new BookingCrawler({
      sessionFactory: async () => session(new FixturePage(await fixtureHtml())),
      pageDelayMs: 0,
    }).crawl({
      url: hotelUrl,
      lastSeenReviewId: "booking-review-001",
    });

    expect(
      persisted.reviews.map((review) => review.externalReviewId),
    ).not.toContain("booking-review-001");
    expect(
      older.reviews.map((review) => review.externalReviewId),
    ).not.toContain("booking-review-001");
    expect(lastSeen.reviews).toEqual([]);
    expect(lastSeen.diagnostics.stoppedBecause).toBe("last_seen_review_id");
  });

  it("paginates through visible review controls and stops when the page makes no progress", async () => {
    const html =
      "<html><body><h1>Example Hotel</h1>" +
      '<article data-testid="review-card" data-review-id="first">' +
      '<span data-testid="review-score">9</span><p data-testid="review-text">First review.</p></article>' +
      '<button data-testid="load-more-reviews-button" data-load-more ' +
      'data-next-review-id="second" data-next-rating="8" data-next-comment="Second review.">Load more</button>' +
      "</body></html>";
    const page = new FixturePage(html);
    const result = await new BookingCrawler({
      sessionFactory: async () => session(page),
      pageDelayMs: 0,
    }).crawl({ url: hotelUrl, maxPages: 4 });

    expect(result.success).toBe(true);
    expect(result.reviews).toHaveLength(2);
    expect(result.diagnostics.pagesVisited).toBe(2);
    expect(result.diagnostics.stoppedBecause).toBe("no_next_page_control");

    const noProgressPage = new FixturePage(
      html.replace(
        'data-next-review-id="second" data-next-rating="8" data-next-comment="Second review."',
        "",
      ),
    );
    const noProgress = await new BookingCrawler({
      sessionFactory: async () => session(noProgressPage),
      pageDelayMs: 0,
    }).crawl({ url: hotelUrl, maxPages: 4 });
    expect(noProgress.success).toBe(true);
    expect(noProgress.diagnostics.stoppedBecause).toBe("no_progress");
    expect(noProgress.diagnostics.duplicatesRemoved).toBe(1);
  });

  it("honors the max-review limit and reports empty public review pages", async () => {
    const limited = await new BookingCrawler({
      sessionFactory: async () => session(new FixturePage(await fixtureHtml())),
      pageDelayMs: 0,
    }).crawl({ url: hotelUrl, maxReviews: 1 });
    const empty = await new BookingCrawler({
      sessionFactory: async () =>
        session(
          new FixturePage(
            "<html><body><h1>Example Hotel</h1><p>No guest reviews yet.</p></body></html>",
          ),
        ),
      pageDelayMs: 0,
    }).crawl({ url: hotelUrl });

    expect(limited.reviews).toHaveLength(1);
    expect(limited.diagnostics.stoppedBecause).toBe("max_reviews");
    expect(empty.success).toBe(true);
    expect(empty.reviews).toEqual([]);
    expect(empty.diagnostics.stoppedBecause).toBe("no_reviews");
  });

  it.each([
    [
      "challenge",
      "<title>Verify you are human</title><body>CAPTCHA</body>",
      "challenge_page",
    ],
    [
      "consent",
      "<title>Cookie consent</title><body>Accept cookies</body>",
      "consent_page",
    ],
    [
      "authentication",
      "<title>Sign in to continue</title><body>Please sign in to view</body>",
      "authentication_required",
    ],
  ] as const)(
    "fails safely on %s pages",
    async (_name, markup, classification) => {
      const result = await new BookingCrawler({
        sessionFactory: async () =>
          session(new FixturePage(`<html>${markup}</html>`)),
        maxRetries: 0,
      }).crawl({ url: hotelUrl });

      expect(result.success).toBe(false);
      expect(result.reviews).toEqual([]);
      expect(result.diagnostics.failure?.classification).toBe(classification);
    },
  );

  it.each([401, 403, 429])("classifies HTTP %s explicitly", async (status) => {
    const result = await new BookingCrawler({
      sessionFactory: async () =>
        session(new FixturePage("<html><body>Blocked</body></html>", status)),
      maxRetries: 0,
    }).crawl({ url: hotelUrl });

    expect(result.success).toBe(false);
    expect(result.diagnostics.failure?.classification).toBe(
      status === 401 ? "authentication_required" : "blocked_page",
    );
  });

  it("retries timeouts and closes every browser session", async () => {
    const page = new FixturePage(await fixtureHtml());
    vi.spyOn(page, "goto")
      .mockRejectedValueOnce(new Error("Timeout 1000ms exceeded"))
      .mockImplementationOnce(async (targetUrl) => {
        await FixturePage.prototype.goto.call(page, targetUrl);
        return { status: () => 200 };
      });
    const close = vi.fn(async () => undefined);
    const sessionFactory = vi.fn(async () => session(page, close));
    const result = await new BookingCrawler({
      sessionFactory,
      maxRetries: 1,
      retryBaseDelayMs: 0,
      pageDelayMs: 0,
    }).crawl({ url: hotelUrl });

    expect(result.success).toBe(true);
    expect(result.diagnostics.retries).toBe(1);
    expect(sessionFactory).toHaveBeenCalledTimes(2);
    expect(close).toHaveBeenCalledTimes(2);
  });

  it("rejects non-hotel and credentialed URLs without exposing secrets", async () => {
    const crawler = new BookingCrawler({ maxRetries: 0 });
    const nonHotel = await crawler.crawl({
      url: "https://www.booking.com/flights.html",
    });
    const credentialed = await crawler.crawl({
      url: "https://fixture-user:fixture-password@www.booking.com/hotel/us/example.html",
    });

    expect(nonHotel.diagnostics.failure?.classification).toBe("invalid_page");
    expect(credentialed.diagnostics.failure?.classification).toBe(
      "invalid_page",
    );
    expect(JSON.stringify(credentialed)).not.toContain("fixture-user");
    expect(JSON.stringify(credentialed)).not.toContain("fixture-password");
  });

  it("strips tracking parameters from canonical hotel and source URLs", async () => {
    const result = await new BookingCrawler({
      sessionFactory: async () => session(new FixturePage(await fixtureHtml())),
      maxRetries: 0,
      pageDelayMs: 0,
    }).crawl({ url: `${hotelUrl}?token=fixture-token` });

    expect(result.success).toBe(true);
    expect(result.reviews[0]?.hotel.url).toBe(hotelUrl);
    expect(result.reviews[0]?.sourceMetadata.sourceUrl).toBe(hotelUrl);
    expect(JSON.stringify(result)).not.toContain("fixture-token");
  });
});

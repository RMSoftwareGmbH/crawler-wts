import { readFile } from "node:fs/promises";
import { describe, expect, it, vi } from "vitest";
import { FixturePage } from "../../google/tests/fixturePage.js";
import { ExpediaCrawler } from "../src/ExpediaCrawler.js";

const hotelUrl =
  "https://www.expedia.com/New-York-Hotels-Example.h123.Hotel-Information";
const fixture = new URL("./fixtures/review-cards.html", import.meta.url);

function session(page: FixturePage, close = async () => undefined) {
  return { page, close };
}

async function fixtureHtml(): Promise<string> {
  return readFile(fixture, "utf8");
}

describe("ExpediaCrawler", () => {
  it("returns canonical reviews and crawl diagnostics", async () => {
    const result = await new ExpediaCrawler({
      sessionFactory: async () => session(new FixturePage(await fixtureHtml())),
      now: () => new Date("2026-06-20T12:00:00.000Z"),
      pageDelayMs: 0,
    }).crawl({ url: hotelUrl });

    expect(result.success).toBe(true);
    expect(result.reviews).toHaveLength(2);
    expect(result.reviews[0]).toMatchObject({
      source: "expedia",
      rating: { value: 4.6, scale: 5 },
      hotel: { url: hotelUrl },
    });
    expect(result.diagnostics).toMatchObject({
      source: "expedia",
      pagesVisited: 1,
      reviewsExtracted: 2,
      reviewsAccepted: 2,
      stoppedBecause: "no_next_page_control",
    });
  });

  it("accepts localized Expedia.net hotel URLs", async () => {
    const localizedUrl =
      "https://euro.expedia.net/Basel-Hotels-Merian-Basel-Self-Check-In.h101392702.Hotel-Information";
    const result = await new ExpediaCrawler({
      sessionFactory: async () => session(new FixturePage(await fixtureHtml())),
      now: () => new Date("2026-06-20T12:00:00.000Z"),
      pageDelayMs: 0,
    }).crawl({ url: localizedUrl });

    expect(result.success).toBe(true);
    expect(result.reviews).toHaveLength(2);
    expect(result.reviews[0]?.hotel.url).toBe(localizedUrl);
  });

  it("filters persisted IDs and stops at incremental crawl markers", async () => {
    const persisted = await new ExpediaCrawler({
      sessionFactory: async () => session(new FixturePage(await fixtureHtml())),
      pageDelayMs: 0,
    }).crawl({
      url: hotelUrl,
      persistedReviewIds: ["expedia-review-001"],
    });
    const lastSeen = await new ExpediaCrawler({
      sessionFactory: async () => session(new FixturePage(await fixtureHtml())),
      pageDelayMs: 0,
    }).crawl({
      url: hotelUrl,
      lastSeenReviewId: "expedia-review-001",
    });

    expect(
      persisted.reviews.map((review) => review.externalReviewId),
    ).not.toContain("expedia-review-001");
    expect(lastSeen.reviews).toEqual([]);
    expect(lastSeen.diagnostics.stoppedBecause).toBe("last_seen_review_id");
  });

  it("follows a public next-page control and stops safely without new cards", async () => {
    const html =
      "<html><body><h1>Example Expedia Hotel</h1>" +
      '<article data-stid="review-card" data-review-id="first">' +
      '<span data-stid="review-rating">9</span><p data-stid="review-text">First review.</p></article>' +
      '<button data-stid="reviews-next-page" data-load-more ' +
      'data-next-review-id="second" data-next-rating="8" data-next-comment="Second review.">Next</button>' +
      "</body></html>";
    const result = await new ExpediaCrawler({
      sessionFactory: async () => session(new FixturePage(html)),
      pageDelayMs: 0,
    }).crawl({ url: hotelUrl, maxPages: 4 });

    expect(result.success).toBe(true);
    expect(result.reviews).toHaveLength(2);
    expect(result.diagnostics.pagesVisited).toBe(2);
    expect(result.diagnostics.stoppedBecause).toBe("no_next_page_control");

    const noProgressHtml = html.replace(
      'data-next-review-id="second" data-next-rating="8" data-next-comment="Second review."',
      "",
    );
    const noProgress = await new ExpediaCrawler({
      sessionFactory: async () => session(new FixturePage(noProgressHtml)),
      pageDelayMs: 0,
    }).crawl({ url: hotelUrl, maxPages: 4 });
    expect(noProgress.success).toBe(true);
    expect(noProgress.diagnostics.stoppedBecause).toBe("no_progress");
    expect(noProgress.diagnostics.duplicatesRemoved).toBe(1);
  });

  it("honors review limit and treats an explicit no-reviews page as valid", async () => {
    const limited = await new ExpediaCrawler({
      sessionFactory: async () => session(new FixturePage(await fixtureHtml())),
      pageDelayMs: 0,
    }).crawl({ url: hotelUrl, maxReviews: 1 });
    const empty = await new ExpediaCrawler({
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
      const result = await new ExpediaCrawler({
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
    const result = await new ExpediaCrawler({
      sessionFactory: async () =>
        session(new FixturePage("<html><body>Blocked</body></html>", status)),
      maxRetries: 0,
    }).crawl({ url: hotelUrl });

    expect(result.success).toBe(false);
    expect(result.diagnostics.failure?.classification).toBe(
      status === 401 ? "authentication_required" : "blocked_page",
    );
  });

  it("retries navigation timeouts and closes every session", async () => {
    const page = new FixturePage(await fixtureHtml());
    vi.spyOn(page, "goto")
      .mockRejectedValueOnce(new Error("Timeout 1000ms exceeded"))
      .mockImplementationOnce(async (targetUrl) => {
        await FixturePage.prototype.goto.call(page, targetUrl);
        return { status: () => 200 };
      });
    const close = vi.fn(async () => undefined);
    const sessionFactory = vi.fn(async () => session(page, close));
    const result = await new ExpediaCrawler({
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

  it("rejects non-hotel and credentialed URLs without exposing credentials", async () => {
    const crawler = new ExpediaCrawler({ maxRetries: 0 });
    const nonHotel = await crawler.crawl({
      url: "https://www.expedia.com/Flights",
    });
    const credentialed = await crawler.crawl({
      url: "https://fixture-user:fixture-password@www.expedia.com/hotel/us/example",
    });

    expect(nonHotel.diagnostics.failure?.classification).toBe("invalid_page");
    expect(credentialed.diagnostics.failure?.classification).toBe(
      "invalid_page",
    );
    expect(JSON.stringify(credentialed)).not.toContain("fixture-user");
    expect(JSON.stringify(credentialed)).not.toContain("fixture-password");
  });

  it("strips query parameters from persisted canonical URLs", async () => {
    const result = await new ExpediaCrawler({
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

import { readFile } from "node:fs/promises";
import { describe, expect, it, vi } from "vitest";
import { FixturePage } from "../../google/tests/fixturePage.js";
import { HolidayCheckCrawler } from "../src/HolidayCheckCrawler.js";

const hotelUrl = "https://www.holidaycheck.de/hi/beispielhotel/abc123";
const fixture = new URL("./fixtures/review-cards.html", import.meta.url);

function session(page: FixturePage, close = async () => undefined) {
  return { page, close };
}

async function fixtureHtml(): Promise<string> {
  return readFile(fixture, "utf8");
}

describe("HolidayCheckCrawler", () => {
  it("returns canonical reviews and diagnostics", async () => {
    const result = await new HolidayCheckCrawler({
      sessionFactory: async () => session(new FixturePage(await fixtureHtml())),
      now: () => new Date("2026-06-20T12:00:00.000Z"),
      pageDelayMs: 0,
    }).crawl({ url: hotelUrl });

    expect(result.success).toBe(true);
    expect(result.reviews).toHaveLength(2);
    expect(result.reviews[0]).toMatchObject({
      source: "holidaycheck",
      rating: { value: 4.58, scale: 5 },
      hotel: { url: hotelUrl },
    });
    expect(result.diagnostics).toMatchObject({
      source: "holidaycheck",
      pagesVisited: 1,
      reviewsExtracted: 2,
      reviewsAccepted: 2,
      stoppedBecause: "no_next_page_control",
    });
  });

  it("filters persisted IDs, older reviews, and stops at last-seen ID", async () => {
    const persisted = await new HolidayCheckCrawler({
      sessionFactory: async () => session(new FixturePage(await fixtureHtml())),
      pageDelayMs: 0,
    }).crawl({
      url: hotelUrl,
      persistedReviewIds: ["holidaycheck-review-001"],
    });
    const old = await new HolidayCheckCrawler({
      sessionFactory: async () => session(new FixturePage(await fixtureHtml())),
      pageDelayMs: 0,
    }).crawl({
      url: hotelUrl,
      lastSuccessfulCrawlAt: "2026-06-13T00:00:00.000Z",
    });
    const lastSeen = await new HolidayCheckCrawler({
      sessionFactory: async () => session(new FixturePage(await fixtureHtml())),
      pageDelayMs: 0,
    }).crawl({
      url: hotelUrl,
      lastSeenReviewId: "holidaycheck-review-001",
    });

    expect(
      persisted.reviews.map((review) => review.externalReviewId),
    ).not.toContain("holidaycheck-review-001");
    expect(old.reviews.map((review) => review.externalReviewId)).not.toContain(
      "holidaycheck-review-001",
    );
    expect(lastSeen.reviews).toEqual([]);
    expect(lastSeen.diagnostics.stoppedBecause).toBe("last_seen_review_id");
  });

  it("paginates bounded public cards and stops on no progress", async () => {
    const html =
      "<html><body><h1>Beispielhotel</h1>" +
      '<article data-testid="review-card" data-review-id="first">' +
      '<span data-testid="review-rating">5,0</span><p data-testid="review-text">Erste Bewertung.</p></article>' +
      '<button data-testid="reviews-next-page" data-load-more ' +
      'data-next-review-id="second" data-next-rating="4.8" data-next-comment="Zweite Bewertung.">Weiter</button>' +
      "</body></html>";
    const result = await new HolidayCheckCrawler({
      sessionFactory: async () => session(new FixturePage(html)),
      pageDelayMs: 0,
    }).crawl({ url: hotelUrl, maxPages: 4 });

    expect(result.success).toBe(true);
    expect(result.reviews).toHaveLength(2);
    expect(result.diagnostics.pagesVisited).toBe(2);
    expect(result.diagnostics.stoppedBecause).toBe("no_next_page_control");

    const unchanged = await new HolidayCheckCrawler({
      sessionFactory: async () =>
        session(
          new FixturePage(
            html.replace(
              'data-next-review-id="second" data-next-rating="4.8" data-next-comment="Zweite Bewertung."',
              "",
            ),
          ),
        ),
      pageDelayMs: 0,
    }).crawl({ url: hotelUrl, maxPages: 4 });
    expect(unchanged.success).toBe(true);
    expect(unchanged.diagnostics.stoppedBecause).toBe("no_progress");
    expect(unchanged.diagnostics.duplicatesRemoved).toBe(1);
  });

  it("honors maxReviews and accepts an explicit no-reviews page", async () => {
    const limited = await new HolidayCheckCrawler({
      sessionFactory: async () => session(new FixturePage(await fixtureHtml())),
      pageDelayMs: 0,
    }).crawl({ url: hotelUrl, maxReviews: 1 });
    const empty = await new HolidayCheckCrawler({
      sessionFactory: async () =>
        session(
          new FixturePage(
            "<html><body><h1>Beispielhotel</h1><p>Keine Bewertungen vorhanden.</p></body></html>",
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
      "<title>Cookie consent</title><body>Cookies akzeptieren</body>",
      "consent_page",
    ],
    [
      "authentication",
      "<title>Bitte anmelden</title><body>Bitte anmelden, um fortzufahren.</body>",
      "authentication_required",
    ],
  ] as const)(
    "fails safely on %s pages",
    async (_name, markup, classification) => {
      const result = await new HolidayCheckCrawler({
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
    const result = await new HolidayCheckCrawler({
      sessionFactory: async () =>
        session(new FixturePage("<html><body>Blocked</body></html>", status)),
      maxRetries: 0,
    }).crawl({ url: hotelUrl });

    expect(result.success).toBe(false);
    expect(result.diagnostics.failure?.classification).toBe(
      status === 401 ? "authentication_required" : "blocked_page",
    );
  });

  it("retries timeouts and closes each browser session", async () => {
    const page = new FixturePage(await fixtureHtml());
    vi.spyOn(page, "goto")
      .mockRejectedValueOnce(new Error("Timeout 1000ms exceeded"))
      .mockImplementationOnce(async (targetUrl) => {
        await FixturePage.prototype.goto.call(page, targetUrl);
        return { status: () => 200 };
      });
    const close = vi.fn(async () => undefined);
    const sessionFactory = vi.fn(async () => session(page, close));
    const result = await new HolidayCheckCrawler({
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

  it("rejects unrelated or credentialed URLs without exposing credentials", async () => {
    const crawler = new HolidayCheckCrawler({ maxRetries: 0 });
    const unrelated = await crawler.crawl({
      url: "https://www.holidaycheck.de/urlaub",
    });
    const credentialed = await crawler.crawl({
      url: "https://fixture-user:fixture-password@www.holidaycheck.de/hi/hotel/abc",
    });

    expect(unrelated.diagnostics.failure?.classification).toBe("invalid_page");
    expect(credentialed.diagnostics.failure?.classification).toBe(
      "invalid_page",
    );
    expect(JSON.stringify(credentialed)).not.toContain("fixture-user");
    expect(JSON.stringify(credentialed)).not.toContain("fixture-password");
  });

  it("removes URL query parameters from persisted review data", async () => {
    const result = await new HolidayCheckCrawler({
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

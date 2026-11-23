import { readFile } from "node:fs/promises";
import { describe, expect, it, vi } from "vitest";
import type {
  CrawlerLocator,
  CrawlerPage,
} from "../../../crawler-core/src/browser/pageFactory.js";
import { FixturePage } from "../../google/tests/fixturePage.js";
import { BookingCrawler } from "../src/BookingCrawler.js";

const hotelUrl = "https://www.booking.com/hotel/us/example-hotel.html";
const fixture = new URL("./fixtures/review-cards.html", import.meta.url);

async function readBookingFixture(name: string): Promise<string> {
  return readFile(new URL(`./fixtures/${name}`, import.meta.url), "utf8");
}

function session(page: FixturePage, close = async () => undefined) {
  return { page, close };
}

async function fixtureHtml(): Promise<string> {
  return readFile(fixture, "utf8");
}

function withReviewPanel(markup: string): string {
  const content = markup.match(/<body[^>]*>([\s\S]*?)<\/body>/i)?.[1] ?? markup;
  const title = markup.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "";
  return (
    `<html><head><title>${title}</title></head><body><h1 data-testid="title">Example Hotel</h1>` +
    '<button type="button" role="tab" aria-label="Guest reviews" ' +
    'data-testid="guest-reviews-tab" data-action="open-reviews">Guest Reviews</button>' +
    '<section role="dialog" aria-label="Guest reviews" data-testid="reviews-panel" ' +
    "data-reviews-panel hidden></section>" +
    `<template data-reviews-content><header>Guest Reviews</header>${content}</template>` +
    "</body></html>"
  );
}

class DelayedFixturePage implements CrawlerPage {
  private activePage: FixturePage;

  constructor(
    initialHtml: string,
    private readonly readyHtml: string,
    private readonly status = 200,
  ) {
    this.activePage = new FixturePage(initialHtml, status);
  }

  goto(url: string): Promise<unknown> {
    return this.activePage.goto(url);
  }

  url(): string {
    return this.activePage.url();
  }

  title(): Promise<string> {
    return this.activePage.title();
  }

  locator(selector: string): CrawlerLocator {
    return this.activePage.locator(selector);
  }

  async waitForTimeout(timeout: number): Promise<void> {
    await this.activePage.waitForTimeout(timeout);
    this.activePage = new FixturePage(this.readyHtml, this.status);
  }

  scrollFirstScrollable(selector: string): Promise<boolean> {
    return this.activePage.scrollFirstScrollable(selector);
  }
}

describe("BookingCrawler", () => {
  it("returns canonical reviews with diagnostics and duplicate filtering", async () => {
    const result = await new BookingCrawler({
      sessionFactory: async () =>
        session(new FixturePage(withReviewPanel(await fixtureHtml()))),
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
      sessionFactory: async () =>
        session(new FixturePage(withReviewPanel(await fixtureHtml()))),
      pageDelayMs: 0,
    }).crawl({
      url: hotelUrl,
      persistedReviewIds: ["booking-review-001"],
    });
    const older = await new BookingCrawler({
      sessionFactory: async () =>
        session(new FixturePage(withReviewPanel(await fixtureHtml()))),
      pageDelayMs: 0,
    }).crawl({
      url: hotelUrl,
      lastSuccessfulCrawlAt: "2026-06-13T00:00:00.000Z",
    });
    const lastSeen = await new BookingCrawler({
      sessionFactory: async () =>
        session(new FixturePage(withReviewPanel(await fixtureHtml()))),
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
      'data-load-target="reviews-panel" ' +
      'data-next-review-id="second" data-next-rating="8" data-next-comment="Second review.">Load more</button>' +
      "</body></html>";
    const page = new FixturePage(withReviewPanel(html));
    const result = await new BookingCrawler({
      sessionFactory: async () => session(page),
      pageDelayMs: 0,
    }).crawl({ url: hotelUrl, maxPages: 4 });

    expect(result.success).toBe(true);
    expect(result.reviews).toHaveLength(2);
    expect(result.diagnostics.pagesVisited).toBe(2);
    expect(result.diagnostics.stoppedBecause).toBe("no_next_page_control");

    const noProgressPage = new FixturePage(
      withReviewPanel(
        html.replace(
          'data-next-review-id="second" data-next-rating="8" data-next-comment="Second review."',
          "",
        ),
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
      sessionFactory: async () =>
        session(new FixturePage(withReviewPanel(await fixtureHtml()))),
      pageDelayMs: 0,
    }).crawl({ url: hotelUrl, maxReviews: 1 });
    const empty = await new BookingCrawler({
      sessionFactory: async () =>
        session(
          new FixturePage(
            withReviewPanel(
              "<html><body><p>No guest reviews yet.</p></body></html>",
            ),
          ),
        ),
      pageDelayMs: 0,
    }).crawl({ url: hotelUrl });

    expect(limited.reviews).toHaveLength(1);
    expect(limited.diagnostics.stoppedBecause).toBe("max_reviews");
    expect(empty.success).toBe(false);
    expect(empty.reviews).toEqual([]);
    expect(empty.diagnostics.failure?.classification).toBe(
      "no_reviews_available",
    );
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
    const page = new FixturePage(withReviewPanel(await fixtureHtml()));
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
      sessionFactory: async () =>
        session(new FixturePage(withReviewPanel(await fixtureHtml()))),
      maxRetries: 0,
      pageDelayMs: 0,
    }).crawl({ url: `${hotelUrl}?token=fixture-token` });

    expect(result.success).toBe(true);
    expect(result.reviews[0]?.hotel.url).toBe(hotelUrl);
    expect(result.reviews[0]?.sourceMetadata.sourceUrl).toBe(hotelUrl);
    expect(JSON.stringify(result)).not.toContain("fixture-token");
  });

  it("waits for delayed hotel content and records readiness diagnostics", async () => {
    const page = new DelayedFixturePage(
      await readBookingFixture("delayed-hotel-initial.html"),
      withReviewPanel(await readBookingFixture("valid-hotel.html")),
    );
    const sessionFactory = vi.fn(async () => ({ page, close: async () => {} }));
    const result = await new BookingCrawler({
      sessionFactory,
      maxRetries: 0,
      pageDelayMs: 0,
    }).crawl({ url: hotelUrl, timeoutMs: 2_000 });

    expect(result.success).toBe(true);
    expect(result.reviews).toHaveLength(1);
    expect(result.diagnostics).toMatchObject({
      navigationStatus: 200,
      documentTitle: "NH Berlin Alexanderplatz reviews",
      bodyTextLength: expect.any(Number),
      hotelContentMarkerCount: 1,
      reviewCardCount: 1,
      interstitialPageDetected: false,
    });
    expect(result.diagnostics.bodyTextLength).toBeGreaterThan(0);
    expect(sessionFactory).toHaveBeenCalledWith(
      expect.objectContaining({ optimizationEnabled: false }),
    );
  });

  it("does not classify an empty HTTP 202 response as invalid_page", async () => {
    const page = new FixturePage(
      await readBookingFixture("http-202-empty.html"),
      202,
    );
    const result = await new BookingCrawler({
      sessionFactory: async () => session(page),
      maxRetries: 0,
    }).crawl({ url: hotelUrl, timeoutMs: 200 });

    expect(result.success).toBe(false);
    expect(result.reviews).toEqual([]);
    expect(result.diagnostics).toMatchObject({
      navigationStatus: 202,
      finalUrl: hotelUrl,
      documentTitle: "",
      bodyTextLength: 0,
      hotelContentMarkerCount: 0,
      reviewCardCount: 0,
      interstitialPageDetected: false,
      pageClassification: "navigation_failure",
      failure: {
        classification: "navigation_failure",
        message:
          "Booking.com returned an empty HTTP 202 response without usable page content.",
      },
    });
    expect(
      page.waitDurations.reduce((total, duration) => total + duration, 0),
    ).toBeLessThanOrEqual(200);
  });

  it("classifies a Booking HTTP 202 challenge interstitial without parsing reviews", async () => {
    const page = new FixturePage(
      await readBookingFixture("http-202-interstitial.html"),
      202,
    );
    const result = await new BookingCrawler({
      sessionFactory: async () => session(page),
      maxRetries: 0,
    }).crawl({ url: hotelUrl });

    expect(result.success).toBe(false);
    expect(result.reviews).toEqual([]);
    expect(result.diagnostics).toMatchObject({
      navigationStatus: 202,
      reviewCardCount: 0,
      challengePageDetected: true,
      interstitialPageDetected: true,
      pageClassification: "challenge_page",
    });
  });

  it("classifies Booking challenge redirect markers and sanitizes the title", async () => {
    const page = new FixturePage(
      await readBookingFixture("http-202-challenge-marker.html"),
      202,
    );
    const result = await new BookingCrawler({
      sessionFactory: async () => session(page),
      maxRetries: 0,
    }).crawl({ url: hotelUrl, timeoutMs: 200 });

    expect(result.success).toBe(false);
    expect(result.diagnostics.failure?.classification).toBe("challenge_page");
    expect(result.diagnostics.challengePageDetected).toBe(true);
    expect(result.diagnostics.documentTitle).toBe(
      "Loading https://www.booking.com/hotel/de/example.html",
    );
    expect(JSON.stringify(result)).not.toContain("fixture-token");
  });

  it("classifies the AWS WAF challenge container from an HTTP 202 response", async () => {
    const page = new FixturePage(
      await readBookingFixture("http-202-aws-waf.html"),
      202,
    );
    const result = await new BookingCrawler({
      sessionFactory: async () => session(page),
      maxRetries: 0,
    }).crawl({ url: hotelUrl });

    expect(result.success).toBe(false);
    expect(result.diagnostics).toMatchObject({
      navigationStatus: 202,
      challengePageDetected: true,
      interstitialPageDetected: true,
      pageClassification: "challenge_page",
    });
    expect(result.diagnostics.failure?.message).toBe(
      "Booking.com served a challenge page.",
    );
  });

  it.each([
    ["consent.html", "consent_page", "consentPageDetected"],
    ["challenge.html", "challenge_page", "challengePageDetected"],
  ] as const)(
    "identifies %s interstitials",
    async (fixtureName, classification, diagnosticFlag) => {
      const page = new FixturePage(await readBookingFixture(fixtureName));
      const result = await new BookingCrawler({
        sessionFactory: async () => session(page),
        maxRetries: 0,
      }).crawl({ url: hotelUrl });

      expect(result.success).toBe(false);
      expect(result.reviews).toEqual([]);
      expect(result.diagnostics.failure?.classification).toBe(classification);
      expect(result.diagnostics[diagnosticFlag]).toBe(true);
      expect(result.diagnostics.interstitialPageDetected).toBe(true);
    },
  );

  it("classifies a non-hotel document as invalid after bounded readiness polling", async () => {
    const page = new FixturePage(await readBookingFixture("invalid.html"));
    const result = await new BookingCrawler({
      sessionFactory: async () => session(page),
      maxRetries: 0,
    }).crawl({ url: hotelUrl, timeoutMs: 200 });

    expect(result.success).toBe(false);
    expect(result.diagnostics).toMatchObject({
      navigationStatus: 200,
      bodyTextLength: expect.any(Number),
      hotelContentMarkerCount: 0,
      reviewCardCount: 0,
      pageClassification: "invalid_page",
    });
    expect(
      page.waitDurations.reduce((total, duration) => total + duration, 0),
    ).toBeLessThanOrEqual(200);
  });

  it("clicks Guest Reviews and parses cards only from the opened panel", async () => {
    const page = new FixturePage(
      await readBookingFixture("hotel-with-guest-reviews.html"),
    );
    const result = await new BookingCrawler({
      sessionFactory: async () => session(page),
      maxRetries: 0,
    }).crawl({ url: hotelUrl, timeoutMs: 2_000 });

    expect(result.success).toBe(true);
    expect(result.reviews).toHaveLength(1);
    expect(page.reviewsClickCount).toBe(1);
    expect(result.diagnostics).toMatchObject({
      guestReviewsControlFound: true,
      guestReviewsControlClicked: true,
      reviewPanelFound: true,
      reviewPanelSelector: "[role='dialog']",
      reviewCardCountBeforeClick: 0,
      reviewCardCountAfterClick: 1,
      paginationControlFound: false,
      paginationClicks: 0,
      interactionStoppedBecause: "review_cards_found",
    });
  });

  it("recognizes localized Guest Reviews labels and preserves missing optional fields", async () => {
    const page = new FixturePage(
      await readBookingFixture("localized-guest-reviews.html"),
    );
    const result = await new BookingCrawler({
      sessionFactory: async () => session(page),
      maxRetries: 0,
    }).crawl({ url: hotelUrl, timeoutMs: 2_000, locale: "de-DE" });

    expect(result.success).toBe(true);
    expect(page.reviewsClickCount).toBe(1);
    expect(result.reviews).toHaveLength(1);
    expect(result.reviews[0]).toMatchObject({
      source: "booking",
      externalReviewId: "de-review-001",
      comment: "Ein angenehmer Aufenthalt.",
      rating: { value: 4, scale: 5 },
    });
    expect(result.reviews[0]?.author).toBeUndefined();
    expect(result.reviews[0]?.reviewDate).toBeUndefined();
    expect(result.reviews[0]?.businessReply).toBeUndefined();
  });

  it("uses visible control text only as a fallback", async () => {
    const page = new FixturePage(
      await readBookingFixture("text-guest-reviews.html"),
    );
    const result = await new BookingCrawler({
      sessionFactory: async () => session(page),
      maxRetries: 0,
    }).crawl({ url: hotelUrl, timeoutMs: 2_000 });

    expect(result.success).toBe(true);
    expect(page.reviewsClickCount).toBe(1);
    expect(result.diagnostics.guestReviewsControlFound).toBe(true);
    expect(result.diagnostics.reviewPanelFound).toBe(true);
  });

  it("paginates only inside the opened review panel", async () => {
    const page = new FixturePage(
      await readBookingFixture("panel-pagination.html"),
    );
    const result = await new BookingCrawler({
      sessionFactory: async () => session(page),
      maxRetries: 0,
      pageDelayMs: 300,
    }).crawl({ url: hotelUrl, maxPages: 4, timeoutMs: 3_000 });

    expect(result.success).toBe(true);
    expect(result.reviews.map((review) => review.externalReviewId)).toEqual([
      "page-review-001",
      "page-review-002",
    ]);
    expect(result.diagnostics.paginationControlFound).toBe(true);
    expect(result.diagnostics.paginationClicks).toBe(1);
    expect(result.diagnostics.pagesVisited).toBe(2);
  });

  it("stops pagination when the panel yields no new review IDs", async () => {
    const page = new FixturePage(
      await readBookingFixture("panel-no-progress.html"),
    );
    const result = await new BookingCrawler({
      sessionFactory: async () => session(page),
      maxRetries: 0,
      pageDelayMs: 0,
    }).crawl({ url: hotelUrl, maxPages: 4, timeoutMs: 2_000 });

    expect(result.success).toBe(true);
    expect(result.reviews).toHaveLength(1);
    expect(result.diagnostics.paginationClicks).toBe(1);
    expect(result.diagnostics.stoppedBecause).toBe("no_progress");
    expect(result.diagnostics.interactionStoppedBecause).toBe(
      "pagination_no_progress",
    );
  });

  it("reports a missing panel as interaction failure and still closes the session", async () => {
    const page = new FixturePage(
      await readBookingFixture("hotel-with-missing-panel.html"),
    );
    const close = vi.fn(async () => undefined);
    const result = await new BookingCrawler({
      sessionFactory: async () => session(page, close),
      maxRetries: 0,
    }).crawl({ url: hotelUrl, timeoutMs: 250 });

    expect(result.success).toBe(false);
    expect(result.diagnostics.failure?.classification).toBe(
      "interaction_failure",
    );
    expect(result.diagnostics.guestReviewsControlFound).toBe(true);
    expect(result.diagnostics.guestReviewsControlClicked).toBe(true);
    expect(result.diagnostics.reviewPanelFound).toBe(false);
    expect(result.diagnostics.interactionStoppedBecause).toBe(
      "review_panel_not_found",
    );
    expect(close).toHaveBeenCalledOnce();
  });

  it("reports a missing Guest Reviews control precisely", async () => {
    const page = new FixturePage(
      await readBookingFixture("hotel-without-reviews-control.html"),
    );
    const result = await new BookingCrawler({
      sessionFactory: async () => session(page),
      maxRetries: 0,
    }).crawl({ url: hotelUrl, timeoutMs: 250 });

    expect(result.success).toBe(false);
    expect(result.diagnostics.failure?.classification).toBe(
      "interaction_failure",
    );
    expect(result.diagnostics.guestReviewsControlFound).toBe(false);
    expect(result.diagnostics.interactionStoppedBecause).toBe(
      "guest_reviews_control_not_found",
    );
  });

  it("does not claim success when an opened review panel has no cards", async () => {
    const page = new FixturePage(await readBookingFixture("panel-empty.html"));
    const result = await new BookingCrawler({
      sessionFactory: async () => session(page),
      maxRetries: 0,
    }).crawl({ url: hotelUrl, timeoutMs: 250 });

    expect(result.success).toBe(false);
    expect(result.reviews).toEqual([]);
    expect(result.diagnostics.reviewPanelFound).toBe(true);
    expect(result.diagnostics.reviewCardCountAfterClick).toBe(0);
    expect(result.diagnostics.failure?.classification).toBe("selector_drift");
  });

  it("reports an explicitly empty review panel as no_reviews_available", async () => {
    const page = new FixturePage(
      await readBookingFixture("panel-no-reviews.html"),
    );
    const result = await new BookingCrawler({
      sessionFactory: async () => session(page),
      maxRetries: 0,
    }).crawl({ url: hotelUrl, timeoutMs: 250 });

    expect(result.success).toBe(false);
    expect(result.reviews).toEqual([]);
    expect(result.diagnostics.failure?.classification).toBe(
      "no_reviews_available",
    );
  });

  it("classifies a blocked page before attempting the review interaction", async () => {
    const page = new FixturePage(
      await readBookingFixture("interaction-blocked.html"),
      202,
    );
    const result = await new BookingCrawler({
      sessionFactory: async () => session(page),
      maxRetries: 0,
    }).crawl({ url: hotelUrl });

    expect(result.success).toBe(false);
    expect(result.reviews).toEqual([]);
    expect(result.diagnostics.failure?.classification).toBe("blocked_page");
    expect(result.diagnostics.guestReviewsControlClicked).toBe(false);
  });
});

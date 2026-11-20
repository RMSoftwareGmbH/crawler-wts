import { readFile, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { shouldAbortRequest } from "../../../crawler-core/src/browser/browserFactory.js";
import { GoogleCrawler } from "../src/GoogleCrawler.js";
import { supportsDomScrolling } from "../src/GoogleScrollRoot.js";
import { FixturePage } from "./fixturePage.js";

const hotelUrl = "https://www.google.com/maps/place/example-hotel";
let originalLegacyScroll: string | undefined;

beforeEach(() => {
  originalLegacyScroll = process.env.GOOGLE_CRAWLER_ALLOW_LEGACY_SCROLL;
  process.env.GOOGLE_CRAWLER_ALLOW_LEGACY_SCROLL = "true";
});

afterEach(() => {
  if (originalLegacyScroll === undefined) {
    delete process.env.GOOGLE_CRAWLER_ALLOW_LEGACY_SCROLL;
  } else {
    process.env.GOOGLE_CRAWLER_ALLOW_LEGACY_SCROLL = originalLegacyScroll;
  }
});

async function fixture(name: string): Promise<string> {
  return readFile(
    resolve(process.cwd(), `packages/connectors/google/tests/fixtures/${name}`),
    "utf8",
  );
}

function crawlerFor(html: string) {
  const page = new FixturePage(html);
  const close = vi.fn(async () => {});
  const crawler = new GoogleCrawler({
    sessionFactory: async () => ({ page, close }),
    now: () => new Date("2025-05-01T12:00:00.000Z"),
    maxRetries: 0,
    delayMs: 0,
    initialWaitMs: 0,
  });
  return { crawler, close, page };
}

function scrollableReviewFixture(): string {
  const initialCards = Array.from(
    { length: 5 },
    (_value, index) =>
      `<article data-review-id="review-${index + 1}">` +
      '<span data-rating aria-label="5 out of 5 stars"></span>' +
      `<span data-review-text>Review ${index + 1}.</span></article>`,
  ).join("");
  return (
    "<html><body><h1>Example Hotel</h1>" +
    '<button role="tab" aria-label="Reviews" data-action="open-reviews">Reviews</button>' +
    '<section role="region" aria-label="Reviews" data-scrollable="true" ' +
    'data-next-review-id="review-6" data-next-rating="4 out of 5 stars" ' +
    'data-next-comment="Review 6.">' +
    initialCards +
    "</section></body></html>"
  );
}

function setEnvironment(name: string, value: string): () => void {
  const originalValue = process.env[name];
  process.env[name] = value;
  return () => {
    if (originalValue === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = originalValue;
    }
  };
}

function clearEnvironment(name: string): () => void {
  const originalValue = process.env[name];
  delete process.env[name];
  return () => {
    if (originalValue === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = originalValue;
    }
  };
}

describe("GoogleCrawler", () => {
  it("returns validated canonical reviews and diagnostics", async () => {
    const { crawler } = crawlerFor(await fixture("basic.html"));
    const result = await crawler.crawl({ url: hotelUrl });

    expect(result.success).toBe(true);
    expect(result.reviews).toHaveLength(1);
    expect(result.reviews[0]).toMatchObject({
      source: "google",
      externalReviewId: "example-review-001",
      rating: { value: 5, scale: 5 },
      comment: "The room was clean and the staff were helpful.",
      reviewDate: "2025-03-10T00:00:00.000Z",
    });
    expect(result.diagnostics).toMatchObject({
      source: "google",
      pagesVisited: 1,
      reviewsExtracted: 1,
      reviewsAccepted: 1,
      retries: 0,
      finalUrl: hotelUrl,
      documentTitle: "Example Hotel - Google Maps",
      navigationStatus: 200,
      pageClassification: "valid",
      reviewCardCount: 1,
    });
  });

  it("defaults the run limit to 50 when the environment value is absent", async () => {
    const restoreLimit = clearEnvironment("GOOGLE_MAX_REVIEWS_PER_RUN");
    try {
      const { crawler } = crawlerFor(
        "<html><body><h1>Example Hotel</h1><p>No reviews yet.</p></body></html>",
      );
      const result = await crawler.crawl({ url: hotelUrl });

      expect(result.diagnostics.maxReviewsPerRun).toBe(50);
    } finally {
      restoreLimit();
    }
  });

  it("uses a 9-second settle bound and leaves optimizations disabled by default", async () => {
    const restoreSettle = clearEnvironment("GOOGLE_CRAWLER_SETTLE_MS");
    const restoreOptimize = clearEnvironment("GOOGLE_CRAWLER_OPTIMIZE");
    const restoreInteract = clearEnvironment("GOOGLE_CRAWLER_INTERACT");
    try {
      const page = new FixturePage(await fixture("basic.html"));
      const sessionFactory = vi.fn(async () => ({
        page,
        close: async () => {},
      }));
      const crawler = new GoogleCrawler({ sessionFactory, maxRetries: 0 });

      const result = await crawler.crawl({ url: hotelUrl });

      expect(result.success).toBe(true);
      expect(result.diagnostics).toMatchObject({
        settleWaitMs: 9_000,
        optimizationEnabled: false,
        interactionEnabled: false,
        mapsContentReady: true,
        abortedResourceTypes: [],
      });
      expect(sessionFactory).toHaveBeenCalledWith(
        expect.objectContaining({ optimizationEnabled: false }),
      );
    } finally {
      restoreInteract();
      restoreOptimize();
      restoreSettle();
    }
  });

  it("applies the configured locale to the public Maps UI language", async () => {
    const { crawler, page } = crawlerFor(
      "<html><body><h1>Example Hotel</h1><p>No reviews yet.</p></body></html>",
    );
    const result = await crawler.crawl({ url: hotelUrl, locale: "en-US" });

    expect(result.success).toBe(true);
    expect(new URL(page.url()).searchParams.get("hl")).toBe("en");
  });

  it("limits resource filtering to safe optional resources and analytics pings", () => {
    expect(shouldAbortRequest("document", "https://www.google.com/maps")).toBe(
      false,
    );
    for (const resourceType of [
      "script",
      "stylesheet",
      "xhr",
      "fetch",
      "websocket",
    ]) {
      expect(
        shouldAbortRequest(
          resourceType,
          "https://www.google-analytics.com/collect",
        ),
      ).toBe(false);
    }
    expect(
      shouldAbortRequest("ping", "https://www.google-analytics.com/collect"),
    ).toBe(true);
    expect(shouldAbortRequest("image", "https://example.com/image.jpg")).toBe(
      true,
    );
    expect(
      shouldAbortRequest("font", "https://fonts.gstatic.com/font.woff2"),
    ).toBe(false);
    expect(
      shouldAbortRequest("image", "https://www.google.com/maps/thumbnail"),
    ).toBe(false);
  });

  it("detects when a page exposes measurable DOM scrolling capabilities", () => {
    const fixturePage = new FixturePage("<html><body></body></html>");
    expect(supportsDomScrolling(fixturePage)).toBe(false);
    expect(
      supportsDomScrolling({
        ...fixturePage,
        evaluate: async () => null,
        mouse: {
          move: async () => {},
          wheel: async () => {},
        },
      }),
    ).toBe(true);
  });

  it("uses load navigation by default and enables domcontentloaded only with the optimization flag", async () => {
    const restoreOptimize = clearEnvironment("GOOGLE_CRAWLER_OPTIMIZE");
    const restoreSettle = setEnvironment("GOOGLE_CRAWLER_SETTLE_MS", "0");
    try {
      const defaultPage = new FixturePage(await fixture("basic.html"));
      const defaultGoto = vi.spyOn(defaultPage, "goto");
      const defaultCrawler = new GoogleCrawler({
        sessionFactory: async () => ({
          page: defaultPage,
          close: async () => {},
        }),
        maxRetries: 0,
      });
      await defaultCrawler.crawl({ url: hotelUrl });
      expect(defaultGoto).toHaveBeenCalledWith(
        `${hotelUrl}?hl=en`,
        expect.objectContaining({ waitUntil: "load" }),
      );

      const restoreOptimizeTrue = setEnvironment(
        "GOOGLE_CRAWLER_OPTIMIZE",
        "true",
      );
      try {
        const optimizedPage = new FixturePage(await fixture("basic.html"));
        const optimizedGoto = vi.spyOn(optimizedPage, "goto");
        const optimizedCrawler = new GoogleCrawler({
          sessionFactory: async () => ({
            page: optimizedPage,
            close: async () => {},
          }),
          maxRetries: 0,
        });
        await optimizedCrawler.crawl({ url: hotelUrl });
        expect(optimizedGoto).toHaveBeenCalledWith(
          `${hotelUrl}?hl=en`,
          expect.objectContaining({ waitUntil: "domcontentloaded" }),
        );
      } finally {
        restoreOptimizeTrue();
      }
    } finally {
      restoreSettle();
      restoreOptimize();
    }
  });

  it("enforces the max review count and exercises bounded load-more pagination", async () => {
    const html = await fixture("pagination.html");
    const limited = await crawlerFor(html).crawler.crawl({
      url: hotelUrl,
      maxReviews: 1,
    });
    const paged = await crawlerFor(html).crawler.crawl({
      url: hotelUrl,
      maxReviews: 5,
    });

    expect(limited.reviews).toHaveLength(1);
    expect(limited.diagnostics.pagesVisited).toBe(1);
    expect(paged.diagnostics.pagesVisited).toBe(2);
    expect(paged.diagnostics.duplicatesRemoved).toBe(0);
    expect(paged.reviews).toHaveLength(1);
  });

  it("opens the French Plus d'avis control when it is publicly visible", async () => {
    const html =
      "<html><body><h1>Example Hotel</h1>" +
      '<article data-review-id="review-1"><span data-rating aria-label="5 stars"></span>' +
      "<span data-review-text>Premier avis.</span></article>" +
      '<button data-load-more data-next-review-id="review-2" ' +
      'data-next-rating="4 stars" data-next-comment="Deuxième avis.">Plus d\'avis</button>' +
      "</body></html>";
    const { crawler } = crawlerFor(html);

    const result = await crawler.crawl({ url: hotelUrl, maxReviews: 5 });

    expect(result.success).toBe(true);
    expect(result.diagnostics.pagesVisited).toBe(2);
    expect(result.reviews).toHaveLength(2);
  });

  it("reuses one browser pool while creating a fresh session per hotel", async () => {
    const html = await fixture("basic.html");
    const sessions = [
      { page: new FixturePage(html), close: vi.fn(async () => {}) },
      { page: new FixturePage(html), close: vi.fn(async () => {}) },
    ];
    let sessionIndex = 0;
    const createSession = vi.fn(async () => {
      const session = sessions[sessionIndex];
      sessionIndex += 1;
      if (!session) {
        throw new Error("Unexpected extra browser session.");
      }
      return session;
    });
    const closePool = vi.fn(async () => {});
    const browserPoolFactory = vi.fn(async () => ({
      createSession,
      close: closePool,
    }));
    const crawler = new GoogleCrawler({
      optimizationEnabled: true,
      browserPoolFactory,
      now: () => new Date("2025-05-01T12:00:00.000Z"),
      maxRetries: 0,
      delayMs: 0,
      initialWaitMs: 0,
    });

    const results = await crawler.crawlBatch([
      { url: hotelUrl },
      { url: `${hotelUrl}-second` },
    ]);

    expect(results.map((result) => result.success)).toEqual([true, true]);
    expect(browserPoolFactory).toHaveBeenCalledTimes(1);
    expect(createSession).toHaveBeenCalledTimes(2);
    expect(sessions[0]?.close).toHaveBeenCalledTimes(1);
    expect(sessions[1]?.close).toHaveBeenCalledTimes(1);
    expect(closePool).toHaveBeenCalledTimes(1);
  });

  it("omits persisted reviews and honors the last-seen review boundary", async () => {
    const { crawler: persistedCrawler } = crawlerFor(
      await fixture("basic.html"),
    );
    const persistedResult = await persistedCrawler.crawl({
      url: hotelUrl,
      persistedReviewIds: ["example-review-001"],
    });
    const { crawler: lastSeenCrawler } = crawlerFor(
      await fixture("basic.html"),
    );
    const lastSeenResult = await lastSeenCrawler.crawl({
      url: hotelUrl,
      lastSeenReviewId: "example-review-001",
    });

    expect(persistedResult.success).toBe(true);
    expect(persistedResult.reviews).toEqual([]);
    expect(lastSeenResult.success).toBe(true);
    expect(lastSeenResult.reviews).toEqual([]);
    expect(lastSeenResult.diagnostics.stoppedBecause).toBe(
      "last_seen_review_id_reached",
    );
  });

  it("filters reviews older than the last successful crawl timestamp", async () => {
    const { crawler } = crawlerFor(await fixture("basic.html"));
    const result = await crawler.crawl({
      url: hotelUrl,
      lastSuccessfulCrawlAt: "2025-03-11T00:00:00.000Z",
    });

    expect(result.success).toBe(true);
    expect(result.reviews).toEqual([]);
    expect(result.diagnostics.stoppedBecause).toBe(
      "last_successful_crawl_timestamp",
    );
  });

  it.each([
    ["blocked.html", "blocked_page"],
    ["challenge.html", "challenge_page"],
  ])(
    "classifies %s and does not report it as an empty success",
    async (name, classification) => {
      const { crawler } = crawlerFor(await fixture(name));
      const result = await crawler.crawl({ url: hotelUrl });

      expect(result.success).toBe(false);
      expect(result.reviews).toEqual([]);
      expect(result.diagnostics.failure?.classification).toBe(classification);
      expect(result.diagnostics.challengePageDetected).toBe(
        classification === "challenge_page",
      );
    },
  );

  it("records consent and authentication page signals without returning empty successes", async () => {
    const cases = [
      {
        html:
          "<html><head><title>Before you continue to Google</title></head>" +
          "<body>Cookie consent</body></html>",
        classification: "consent_page",
        signal: "consentPageDetected",
      },
      {
        html:
          "<html><head><title>Sign in to continue</title></head>" +
          "<body>Authentication required</body></html>",
        classification: "authentication_required",
        signal: "authenticationPageDetected",
      },
    ] as const;

    for (const testCase of cases) {
      const { crawler } = crawlerFor(testCase.html);
      const result = await crawler.crawl({ url: hotelUrl });

      expect(result.success).toBe(false);
      expect(result.reviews).toEqual([]);
      expect(result.diagnostics.failure?.classification).toBe(
        testCase.classification,
      );
      expect(result.diagnostics[testCase.signal]).toBe(true);
    }
  });

  it("closes the browser session after a crawl failure", async () => {
    const { crawler, close } = crawlerFor(await fixture("blocked.html"));
    await crawler.crawl({ url: hotelUrl });

    expect(close).toHaveBeenCalledOnce();
  });

  it("returns a valid empty result for a recognizable hotel with no reviews", async () => {
    const { crawler } = crawlerFor(
      "<html><body><h1>Example Hotel</h1><p>No reviews yet.</p></body></html>",
    );
    const result = await crawler.crawl({ url: hotelUrl });

    expect(result.success).toBe(true);
    expect(result.reviews).toEqual([]);
    expect(result.diagnostics.failure).toBeUndefined();
  });

  it("classifies a missing page as invalid without retrying", async () => {
    const page = new FixturePage("<html><body>Not found</body></html>", 404);
    const crawler = new GoogleCrawler({
      sessionFactory: async () => ({ page, close: async () => {} }),
      maxRetries: 2,
      retryBaseDelayMs: 0,
    });
    const result = await crawler.crawl({ url: hotelUrl });

    expect(result.success).toBe(false);
    expect(result.diagnostics.failure?.classification).toBe("invalid_page");
    expect(result.diagnostics.retries).toBe(0);
    expect(result.diagnostics.navigationStatus).toBe(404);
    expect(result.diagnostics.pageClassification).toBe("invalid_page");
  });

  it("records an HTTP authentication response as an authentication page", async () => {
    const page = new FixturePage(
      "<html><title>Sign in</title><body>Sign in</body></html>",
      401,
    );
    const crawler = new GoogleCrawler({
      sessionFactory: async () => ({ page, close: async () => {} }),
      maxRetries: 0,
    });
    const result = await crawler.crawl({ url: hotelUrl });

    expect(result.success).toBe(false);
    expect(result.diagnostics.failure?.classification).toBe(
      "authentication_required",
    );
    expect(result.diagnostics.navigationStatus).toBe(401);
    expect(result.diagnostics.authenticationPageDetected).toBe(true);
  });

  it("does not retry a rate-limited navigation", async () => {
    const page = new FixturePage(
      "<html><body>Too many requests</body></html>",
      429,
    );
    const crawler = new GoogleCrawler({
      sessionFactory: async () => ({ page, close: async () => {} }),
      maxRetries: 2,
      retryBaseDelayMs: 0,
    });
    const result = await crawler.crawl({ url: hotelUrl });

    expect(result.success).toBe(false);
    expect(result.diagnostics.failure?.classification).toBe("blocked_page");
    expect(result.diagnostics.navigationStatus).toBe(429);
    expect(result.diagnostics.retries).toBe(0);
  });

  it("does not report a generic Maps shell as a valid empty hotel page", async () => {
    const { crawler } = crawlerFor(
      "<html><head><title>Google Maps</title></head><body><h1>Google Maps</h1><p>Directions</p></body></html>",
    );
    const result = await crawler.crawl({ url: hotelUrl });

    expect(result.success).toBe(false);
    expect(result.diagnostics.failure?.classification).toBe("timeout");
  });

  it("classifies Google limited-view pages as restricted instead of empty success", async () => {
    const { crawler } = crawlerFor(
      "<html><body><h1>Example Hotel</h1><p>You are seeing a limited view of Google Maps.</p></body></html>",
    );
    const result = await crawler.crawl({ url: hotelUrl });

    expect(result.success).toBe(false);
    expect(result.reviews).toEqual([]);
    expect(result.diagnostics.failure?.classification).toBe(
      "restricted_maps_view",
    );
    expect(result.diagnostics.restrictedMapsViewDetected).toBe(true);
    expect(result.diagnostics.reviewCardCount).toBe(0);
  });

  it("clicks the visible Reviews control and recognizes the opened review panel", async () => {
    const restoreInteract = setEnvironment("GOOGLE_CRAWLER_INTERACT", "true");
    try {
      const { crawler, page } = crawlerFor(
        "<html><body><h1>Example Hotel</h1>" +
          '<button role="tab" aria-label="Reviews" data-action="open-reviews">Reviews</button>' +
          '<section role="region" aria-label="Reviews" data-reviews-panel hidden></section>' +
          "<template data-reviews-content>" +
          '<article data-review-id="review-1"><span data-rating aria-label="5 out of 5 stars"></span>' +
          "<span data-review-text>Comfortable stay.</span></article></template></body></html>",
      );
      const result = await crawler.crawl({ url: hotelUrl });

      expect(page.reviewsClickCount).toBe(1);
      expect(result.success).toBe(true);
      expect(result.diagnostics).toMatchObject({
        reviewsInteractionAttempted: true,
        reviewsControlFound: true,
        reviewsControlClicked: true,
        reviewsPanelFound: true,
        reviewCardCountBeforeClick: 0,
        reviewCardCountAfterClick: 1,
        reviewCardCount: 1,
      });
    } finally {
      restoreInteract();
    }
  });

  it("attempts Reviews on a Google place route before rejecting an unrecognized shell", async () => {
    const restoreInteract = setEnvironment("GOOGLE_CRAWLER_INTERACT", "true");
    try {
      const { crawler, page } = crawlerFor(
        "<html><head><title>Google Maps</title></head><body>" +
          '<button role="tab" aria-label="Reviews" data-action="open-reviews">Reviews</button>' +
          '<section role="region" aria-label="Reviews" data-reviews-panel hidden></section>' +
          "<template data-reviews-content>" +
          '<article data-review-id="review-1"><span data-rating aria-label="5 stars"></span>' +
          "<span data-review-text>Comfortable stay.</span></article></template></body></html>",
      );
      const result = await crawler.crawl({ url: hotelUrl });

      expect(page.reviewsClickCount).toBe(1);
      expect(result.success).toBe(true);
      expect(result.diagnostics.reviewsInteractionAttempted).toBe(true);
      expect(result.diagnostics.reviewsControlClicked).toBe(true);
    } finally {
      restoreInteract();
    }
  });

  it("waits briefly for a Reviews control on an unrecognized Google place shell", async () => {
    const restoreInteract = setEnvironment("GOOGLE_CRAWLER_INTERACT", "true");
    try {
      const { crawler, page } = crawlerFor(
        "<html><head><title>Google Maps</title></head><body>Collapse side panel</body></html>",
      );
      const result = await crawler.crawl({ url: hotelUrl });

      expect(page.reviewsClickCount).toBe(0);
      expect(result.success).toBe(false);
      expect(result.diagnostics.reviewsInteractionAttempted).toBe(true);
      expect(result.diagnostics.reviewsControlFound).toBe(false);
      expect(result.diagnostics.failure?.classification).toBe("timeout");
    } finally {
      restoreInteract();
    }
  });

  it("records an unavailable Reviews control without clicking unrelated controls", async () => {
    const restoreInteract = setEnvironment("GOOGLE_CRAWLER_INTERACT", "true");
    try {
      const { crawler, page } = crawlerFor(
        "<html><body><h1>Example Hotel</h1><p>You are seeing a limited view of Google Maps.</p>" +
          "<button>Directions</button></body></html>",
      );
      const result = await crawler.crawl({ url: hotelUrl });

      expect(page.reviewsClickCount).toBe(0);
      expect(result.success).toBe(false);
      expect(result.diagnostics.failure?.classification).toBe(
        "restricted_maps_view",
      );
      expect(result.diagnostics).toMatchObject({
        reviewsInteractionAttempted: true,
        reviewsControlFound: false,
        reviewsControlClicked: false,
        reviewsPanelFound: false,
        reviewCardCountBeforeClick: 0,
        reviewCardCountAfterClick: 0,
      });
    } finally {
      restoreInteract();
    }
  });

  it("attempts the normal Reviews control before retaining a restricted-view result", async () => {
    const restoreInteract = setEnvironment("GOOGLE_CRAWLER_INTERACT", "true");
    try {
      const { crawler, page } = crawlerFor(
        "<html><body><h1>Example Hotel</h1><p>You are seeing a limited view of Google Maps.</p>" +
          '<button role="tab" aria-label="Reviews" data-action="open-reviews">Reviews</button>' +
          '<section role="region" aria-label="Reviews" data-reviews-panel hidden></section></body></html>',
      );
      const result = await crawler.crawl({ url: hotelUrl });

      expect(page.reviewsClickCount).toBe(1);
      expect(result.success).toBe(false);
      expect(result.diagnostics.failure?.classification).toBe(
        "restricted_maps_view",
      );
      expect(result.diagnostics.reviewsControlClicked).toBe(true);
      expect(result.diagnostics.reviewCardCountAfterClick).toBe(0);
    } finally {
      restoreInteract();
    }
  });

  it("recognizes the localized French Avis control", async () => {
    const restoreInteract = setEnvironment("GOOGLE_CRAWLER_INTERACT", "true");
    try {
      const { crawler, page } = crawlerFor(
        "<html><body><h1>Example Hotel</h1>" +
          '<button role="tab" aria-label="Avis" data-action="open-reviews">Avis</button>' +
          '<section role="region" aria-label="Avis" data-reviews-panel hidden></section>' +
          "<template data-reviews-content>" +
          '<article data-review-id="avis-1"><span data-rating aria-label="5 out of 5 stars"></span>' +
          "<span data-review-text>Très bien.</span></article></template></body></html>",
      );
      const result = await crawler.crawl({ url: hotelUrl });

      expect(page.reviewsClickCount).toBe(1);
      expect(result.success).toBe(true);
      expect(result.diagnostics.reviewsControlFound).toBe(true);
      expect(result.diagnostics.reviewsPanelFound).toBe(true);
      expect(result.diagnostics.reviewCardCountAfterClick).toBe(1);
    } finally {
      restoreInteract();
    }
  });

  it("opens a localized More reviews link to load beyond the preview cards", async () => {
    const restoreInteract = setEnvironment("GOOGLE_CRAWLER_INTERACT", "true");
    try {
      const { crawler, page } = crawlerFor(
        "<html><body><h1>Example Hotel</h1>" +
          '<section role="region" aria-label="Reviews">' +
          '<article data-review-id="review-1"><span data-rating aria-label="5 out of 5 stars"></span>' +
          "<span data-review-text>First review.</span></article>" +
          '<a role="link" aria-label="View all 12 reviews" data-load-more ' +
          'data-next-review-id="review-2" data-next-rating="4 out of 5 stars" ' +
          'data-next-comment="Second review.">View all 12 reviews</a></section></body></html>',
      );
      const result = await crawler.crawl({ url: hotelUrl });

      expect(result.success).toBe(true);
      expect(result.reviews).toHaveLength(2);
      expect(result.diagnostics.moreReviewsControlClicked).toBe(true);
    } finally {
      restoreInteract();
    }
  });

  it("clicks the localized original-text control before parsing a translated review", async () => {
    const restoreInteract = setEnvironment("GOOGLE_CRAWLER_INTERACT", "true");
    try {
      const { crawler, page } = crawlerFor(
        "<html><body><h1>Example Hotel</h1>" +
          '<article data-review-id="review-original-1">' +
          '<span data-rating aria-label="5 out of 5 stars"></span>' +
          '<span data-review-text lang="ar">إقامة رائعة.</span>' +
          '<button aria-label="عرض النص الأصلي" data-action="show-original" ' +
          'data-original-language="de" data-original-text="Sehr gut.">عرض النص الأصلي</button>' +
          "</article></body></html>",
      );
      const result = await crawler.crawl({ url: hotelUrl });

      expect(result.success).toBe(true);
      expect(page.originalLanguageClickCount).toBe(1);
      expect(result.reviews[0]).toMatchObject({
        comment: "Sehr gut.",
        language: "de",
      });
      expect(result.diagnostics).toMatchObject({
        originalLanguageControlsFound: 1,
        originalLanguageControlsClicked: 1,
        originalLanguageControlsChanged: 1,
      });
    } finally {
      restoreInteract();
    }
  });

  it("does not click Reviews controls on challenge pages", async () => {
    const restoreInteract = setEnvironment("GOOGLE_CRAWLER_INTERACT", "true");
    try {
      const { crawler, page } = crawlerFor(
        "<html><body><h1>Example Hotel</h1><p>Unusual traffic. Verify you are human.</p>" +
          '<button role="tab" aria-label="Reviews" data-action="open-reviews">Reviews</button>' +
          "</body></html>",
      );
      const result = await crawler.crawl({ url: hotelUrl });

      expect(page.reviewsClickCount).toBe(0);
      expect(result.diagnostics.failure?.classification).toBe("challenge_page");
      expect(result.diagnostics.reviewsInteractionAttempted).toBe(false);
    } finally {
      restoreInteract();
    }
  });

  it("scrolls the review panel incrementally and expands only review-card More controls", async () => {
    const restoreInteract = setEnvironment("GOOGLE_CRAWLER_INTERACT", "true");
    try {
      const { crawler, page } = crawlerFor(
        "<html><body><h1>Example Hotel</h1>" +
          '<button role="tab" aria-label="Reviews" data-action="open-reviews">Reviews</button>' +
          '<section role="region" aria-label="Reviews" data-scrollable="true" ' +
          'data-next-review-id="review-2" data-next-rating="4 out of 5 stars" ' +
          'data-next-comment="Also comfortable.">' +
          '<article data-review-id="review-1"><span data-rating aria-label="5 out of 5 stars"></span>' +
          "<span data-review-text>Comfortable stay.</span>" +
          '<button role="button" data-action="expand-review">More</button></article></section>' +
          "</body></html>",
      );
      const result = await crawler.crawl({ url: hotelUrl });

      expect(page.reviewsClickCount).toBe(1);
      expect(page.reviewExpansionClickCount).toBe(1);
      expect(page.scrollCount).toBeGreaterThan(0);
      expect(result.success).toBe(true);
      expect(result.diagnostics.reviewCardCount).toBe(2);
      expect(result.reviews).toHaveLength(2);
    } finally {
      restoreInteract();
    }
  });

  it("uses the configured review limit and records new cards for each scroll", async () => {
    const restoreLimit = setEnvironment("GOOGLE_MAX_REVIEWS_PER_RUN", "10");
    const restoreInteract = setEnvironment("GOOGLE_CRAWLER_INTERACT", "true");
    const restoreNoProgress = setEnvironment("GOOGLE_NO_PROGRESS_LIMIT", "1");
    try {
      const { crawler, page } = crawlerFor(scrollableReviewFixture());
      const result = await crawler.crawl({ url: hotelUrl });

      expect(result.success).toBe(true);
      expect(result.reviews).toHaveLength(6);
      expect(result.diagnostics).toMatchObject({
        maxReviewsPerRun: 10,
        reviewCardCountBeforeScroll: 5,
        reviewCardCountAfterEachScroll: [6, 6],
        scrollAttempts: 2,
        newReviewsPerScroll: [1, 0],
        totalUniqueCardsSeen: 6,
        stoppedBecause: "no_new_cards",
        paginationStoppedBecause: "no_load_more_button",
      });
      expect(
        page.waitDurations.filter((duration) => duration > 0).length,
      ).toBeGreaterThan(1);
    } finally {
      restoreNoProgress();
      restoreInteract();
      restoreLimit();
    }
  });

  it("stops scrolling when the configured max is reached", async () => {
    const restoreLimit = setEnvironment("GOOGLE_MAX_REVIEWS_PER_RUN", "10");
    const restoreInteract = setEnvironment("GOOGLE_CRAWLER_INTERACT", "true");
    try {
      const { crawler, page } = crawlerFor(scrollableReviewFixture());
      const result = await crawler.crawl({ url: hotelUrl, maxReviews: 6 });

      expect(result.success).toBe(true);
      expect(result.reviews).toHaveLength(6);
      expect(result.diagnostics).toMatchObject({
        maxReviewsPerRun: 6,
        reviewCardCountBeforeScroll: 5,
        reviewCardCountAfterEachScroll: [6],
        scrollAttempts: 1,
        newReviewsPerScroll: [1],
        totalUniqueCardsSeen: 6,
        stoppedBecause: "max_reviews_reached",
      });
      expect(
        page.waitDurations.filter((duration) => duration === 200),
      ).toHaveLength(1);
    } finally {
      restoreInteract();
      restoreLimit();
    }
  });

  it("uses headed Chromium only when the headed diagnostic flag is enabled", async () => {
    const restoreHeaded = setEnvironment("GOOGLE_CRAWLER_HEADED", "true");
    try {
      const page = new FixturePage(
        "<html><body><h1>Example Hotel</h1><p>No reviews yet.</p></body></html>",
      );
      const sessionFactory = vi.fn(async () => ({
        page,
        close: async () => {},
      }));
      const crawler = new GoogleCrawler({ sessionFactory, maxRetries: 0 });

      await crawler.crawl({ url: hotelUrl });

      expect(sessionFactory).toHaveBeenCalledWith(
        expect.objectContaining({ headless: false }),
      );
    } finally {
      restoreHeaded();
    }
  });

  it("captures a screenshot only when explicitly enabled", async () => {
    const restoreScreenshot = setEnvironment(
      "GOOGLE_CRAWLER_DIAGNOSTIC_SCREENSHOT",
      "true",
    );
    try {
      const page = new FixturePage(
        "<html><body><h1>Example Hotel</h1><p>No reviews yet.</p></body></html>",
      );
      const diagnosticScreenshot = vi.fn(
        async (_path: string, _maskedSelectors: readonly string[]) => {},
      );
      const crawler = new GoogleCrawler({
        sessionFactory: async () => ({
          page,
          diagnosticScreenshot,
          close: async () => {},
        }),
        maxRetries: 0,
      });

      const result = await crawler.crawl({ url: hotelUrl });

      expect(diagnosticScreenshot).toHaveBeenCalledOnce();
      expect(diagnosticScreenshot.mock.calls[0]?.[0]).toMatch(
        /google-crawler-.*\.png$/,
      );
      expect(result.diagnostics.diagnosticScreenshotPath).toMatch(
        /google-crawler-.*\.png$/,
      );
    } finally {
      restoreScreenshot();
    }
  });

  it("does not capture a screenshot when the opt-in flag is disabled", async () => {
    const restoreScreenshot = setEnvironment(
      "GOOGLE_CRAWLER_DIAGNOSTIC_SCREENSHOT",
      "false",
    );
    try {
      const page = new FixturePage(
        "<html><body><h1>Example Hotel</h1><p>No reviews yet.</p></body></html>",
      );
      const diagnosticScreenshot = vi.fn(
        async (_path: string, _maskedSelectors: readonly string[]) => {},
      );
      const crawler = new GoogleCrawler({
        sessionFactory: async () => ({
          page,
          diagnosticScreenshot,
          close: async () => {},
        }),
        maxRetries: 0,
      });

      const result = await crawler.crawl({ url: hotelUrl });

      expect(diagnosticScreenshot).not.toHaveBeenCalled();
      expect(result.diagnostics.diagnosticScreenshotPath).toBeUndefined();
    } finally {
      restoreScreenshot();
    }
  });

  it("writes a review-card DOM diagnostic only when explicitly enabled", async () => {
    const restoreDomDiagnostic = setEnvironment(
      "GOOGLE_CRAWLER_DOM_DIAGNOSTIC",
      "true",
    );
    let diagnosticPath: string | undefined;
    try {
      const page = new FixturePage(
        "<html><body><h1>Example Hotel</h1><p>No reviews yet.</p></body></html>",
      );
      const sanitizedSnippet =
        '<article data-review-id="[stable-id]"><span data-rating="5">5 stars</span><p>[redacted]</p></article>';
      const diagnosticReviewCardSnapshot = vi.fn(
        async (_selector: string) => sanitizedSnippet,
      );
      const crawler = new GoogleCrawler({
        sessionFactory: async () => ({
          page,
          diagnosticReviewCardSnapshot,
          close: async () => {},
        }),
        maxRetries: 0,
      });

      const result = await crawler.crawl({ url: hotelUrl });
      diagnosticPath = result.diagnostics.diagnosticDomPath;

      expect(diagnosticReviewCardSnapshot).toHaveBeenCalledOnce();
      expect(diagnosticReviewCardSnapshot).toHaveBeenCalledWith(
        expect.stringContaining("[data-review-id]"),
      );
      expect(diagnosticPath).toMatch(/google-review-card-.*\.html$/);
      if (!diagnosticPath) {
        throw new Error("The DOM diagnostic path was not returned.");
      }
      expect(await readFile(diagnosticPath, "utf8")).toBe(sanitizedSnippet);
    } finally {
      if (diagnosticPath) {
        await rm(diagnosticPath, { force: true });
      }
      restoreDomDiagnostic();
    }
  });

  it("accepts a Google Maps short link after it redirects to the hotel listing", async () => {
    const page = new FixturePage(await fixture("basic.html"), 200, hotelUrl);
    const crawler = new GoogleCrawler({
      sessionFactory: async () => ({ page, close: async () => {} }),
      now: () => new Date("2025-05-01T12:00:00.000Z"),
      maxRetries: 0,
      delayMs: 0,
    });

    const result = await crawler.crawl({
      url: "https://maps.app.goo.gl/example-share-link",
    });

    expect(result.success).toBe(true);
    expect(result.reviews).toHaveLength(1);
    expect(result.reviews[0]?.hotel.url).toBe(hotelUrl);
    expect(result.diagnostics.finalUrl).toBe(hotelUrl);
  });

  it("passes the complete request URL to Playwright and records the redirect target", async () => {
    const requestUrl = `${hotelUrl}?hl=en&long=${"x".repeat(700)}#reviews`;
    const page = new FixturePage(await fixture("basic.html"), 200, hotelUrl);
    const goto = vi.spyOn(page, "goto");
    const crawler = new GoogleCrawler({
      sessionFactory: async () => ({ page, close: async () => {} }),
      maxRetries: 0,
      delayMs: 0,
    });

    const result = await crawler.crawl({ url: requestUrl });

    expect(goto).toHaveBeenCalledWith(requestUrl, {
      timeout: 30_000,
      waitUntil: "load",
    });
    expect(result.success).toBe(true);
    expect(result.diagnostics.finalUrl).toBe(hotelUrl);
  });

  it("captures a sanitized snapshot only when explicitly enabled", async () => {
    const page = new FixturePage(await fixture("blocked.html"));
    const diagnosticSnapshot = vi.fn(
      async () => "<html><body>[redacted]</body></html>",
    );
    const crawler = new GoogleCrawler({
      sessionFactory: async () => ({
        page,
        diagnosticSnapshot,
        close: async () => {},
      }),
      maxRetries: 0,
      delayMs: 0,
    });
    const originalValue = process.env.GOOGLE_CRAWLER_DIAGNOSTIC_SNAPSHOT;

    try {
      delete process.env.GOOGLE_CRAWLER_DIAGNOSTIC_SNAPSHOT;
      const disabledResult = await crawler.crawl({ url: hotelUrl });
      expect(disabledResult.diagnostics.diagnosticSnapshot).toBeUndefined();
      expect(diagnosticSnapshot).not.toHaveBeenCalled();

      process.env.GOOGLE_CRAWLER_DIAGNOSTIC_SNAPSHOT = "true";
      const enabledResult = await crawler.crawl({ url: hotelUrl });
      expect(enabledResult.diagnostics.diagnosticSnapshot).toBe(
        "<html><body>[redacted]</body></html>",
      );
      expect(diagnosticSnapshot).toHaveBeenCalledOnce();
    } finally {
      if (originalValue === undefined) {
        delete process.env.GOOGLE_CRAWLER_DIAGNOSTIC_SNAPSHOT;
      } else {
        process.env.GOOGLE_CRAWLER_DIAGNOSTIC_SNAPSHOT = originalValue;
      }
    }
  });
});

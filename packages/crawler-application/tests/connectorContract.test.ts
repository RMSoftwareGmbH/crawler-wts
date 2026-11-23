import { readFile } from "node:fs/promises";
import { afterAll, describe, expect, it } from "vitest";
import type { ReviewSource } from "../../crawler-contracts/src/source/sourceType.js";
import type { ReviewConnector } from "../../crawler-core/src/index.js";
import { BookingCrawler } from "../../connectors/booking/src/BookingCrawler.js";
import { ExpediaCrawler } from "../../connectors/expedia/src/ExpediaCrawler.js";
import { GoogleCrawler } from "../../connectors/google/src/GoogleCrawler.js";
import { FixturePage } from "../../connectors/google/tests/fixturePage.js";
import { HolidayCheckCrawler } from "../../connectors/holidaycheck/src/HolidayCheckCrawler.js";
import { HotelsComCrawler } from "../../connectors/hotels-com/src/HotelsComCrawler.js";
import { TripadvisorCrawler } from "../../connectors/tripadvisor/src/TripadvisorCrawler.js";

interface ConnectorContractCase {
  source: ReviewSource;
  url: string;
  fixture: URL;
  createConnector(page: FixturePage): ReviewConnector;
}

const originalInteract = process.env.GOOGLE_CRAWLER_INTERACT;
process.env.GOOGLE_CRAWLER_INTERACT = "false";

afterAll(() => {
  if (originalInteract === undefined) {
    delete process.env.GOOGLE_CRAWLER_INTERACT;
  } else {
    process.env.GOOGLE_CRAWLER_INTERACT = originalInteract;
  }
});

const cases: ConnectorContractCase[] = [
  {
    source: "google",
    url: "https://www.google.com/maps/place/example-hotel",
    fixture: new URL(
      "../../connectors/google/tests/fixtures/basic.html",
      import.meta.url,
    ),
    createConnector: (page) =>
      new GoogleCrawler({
        sessionFactory: async () => ({ page, close: async () => undefined }),
        maxRetries: 0,
        delayMs: 0,
        initialWaitMs: 0,
        optimizationEnabled: false,
      }),
  },
  {
    source: "tripadvisor",
    url: "https://www.tripadvisor.com/Hotel_Review-g1-d1-Reviews-Example.html",
    fixture: new URL(
      "../../connectors/tripadvisor/tests/fixtures/basic.html",
      import.meta.url,
    ),
    createConnector: (page) =>
      new TripadvisorCrawler({
        sessionFactory: async () => ({ page, close: async () => undefined }),
        maxRetries: 0,
        delayMs: 0,
      }),
  },
  {
    source: "booking",
    url: "https://www.booking.com/hotel/us/example-hotel.html",
    fixture: new URL(
      "../../connectors/booking/tests/fixtures/review-cards.html",
      import.meta.url,
    ),
    createConnector: (page) =>
      new BookingCrawler({
        sessionFactory: async () => ({ page, close: async () => undefined }),
        maxRetries: 0,
        pageDelayMs: 0,
      }),
  },
  {
    source: "holidaycheck",
    url: "https://www.holidaycheck.de/hi/beispielhotel/abc123",
    fixture: new URL(
      "../../connectors/holidaycheck/tests/fixtures/review-cards.html",
      import.meta.url,
    ),
    createConnector: (page) =>
      new HolidayCheckCrawler({
        sessionFactory: async () => ({ page, close: async () => undefined }),
        maxRetries: 0,
        pageDelayMs: 0,
      }),
  },
  {
    source: "expedia",
    url: "https://www.expedia.com/New-York-Hotels-Example.h123.Hotel-Information",
    fixture: new URL(
      "../../connectors/expedia/tests/fixtures/review-cards.html",
      import.meta.url,
    ),
    createConnector: (page) =>
      new ExpediaCrawler({
        sessionFactory: async () => ({ page, close: async () => undefined }),
        maxRetries: 0,
        pageDelayMs: 0,
      }),
  },
  {
    source: "hotels-com",
    url: "https://www.hotels.com/ho12345/example-hotel/",
    fixture: new URL(
      "../../connectors/hotels-com/tests/fixtures/review-cards.html",
      import.meta.url,
    ),
    createConnector: (page) =>
      new HotelsComCrawler({
        sessionFactory: async () => ({ page, close: async () => undefined }),
        maxRetries: 0,
        pageDelayMs: 0,
      }),
  },
];

describe("ReviewConnector contract", () => {
  it.each(cases)("$source returns an explicit CrawlResult", async (item) => {
    const markup = await readFile(item.fixture, "utf8");
    const page = new FixturePage(markup);
    const connector = item.createConnector(page);
    const result = await connector.crawl({ url: item.url });

    expect(result.success).toBe(true);
    expect(result.reviews.length).toBeGreaterThan(0);
    expect(
      result.reviews.every((review) => review.source === item.source),
    ).toBe(true);
    expect(result.diagnostics.source).toBe(item.source);
  });
});

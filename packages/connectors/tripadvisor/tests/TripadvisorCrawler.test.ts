import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { FixturePage } from "../../google/tests/fixturePage.js";
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
});

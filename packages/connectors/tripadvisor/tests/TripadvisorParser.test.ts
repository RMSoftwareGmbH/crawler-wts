import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { FixturePage } from "../../google/tests/fixturePage.js";
import { TripadvisorMapper } from "../src/TripadvisorMapper.js";
import { TripadvisorParser } from "../src/TripadvisorParser.js";

const fixture = new URL("./fixtures/basic.html", import.meta.url);

async function pageFromFixture(): Promise<FixturePage> {
  return new FixturePage(await readFile(fixture, "utf8"));
}

describe("TripadvisorParser", () => {
  it("parses ratings, fields, reply and explicit stable ids", async () => {
    const parsed = await new TripadvisorParser().parse(await pageFromFixture());
    expect(parsed).toHaveLength(2);
    expect(parsed[0]).toMatchObject({
      externalReviewId: "ta-review-001",
      rawRating: "5 of 5 bubbles",
      title: "Excellent stay",
      comment: "A clean room and friendly staff.",
      authorName: "Alex Example",
      businessReply: "Thank you for staying with us.",
    });
    expect(parsed[1]).toMatchObject({
      externalReviewId: "ta-review-002",
      rawRating: "4",
    });
  });

  it("creates a Tripadvisor-specific deterministic fallback id", async () => {
    const html =
      '<article data-automation="reviewCard"><span data-rating="3"></span><p data-review-text>Okay.</p></article>';
    const first = await new TripadvisorParser().parse(new FixturePage(html));
    const second = await new TripadvisorParser().parse(new FixturePage(html));
    const anotherHotel = await new TripadvisorParser().parse(
      new FixturePage(html),
      "https://www.tripadvisor.com/Hotel_Review-g2-d2-Reviews-Other.html",
    );
    expect(first[0]?.externalReviewId).toMatch(/^tripadvisor-/);
    expect(first[0]?.externalReviewId).toBe(second[0]?.externalReviewId);
    expect(first[0]?.externalReviewId).not.toBe(
      anotherHotel[0]?.externalReviewId,
    );
  });

  it("skips cards without a usable rating and sanitizes public URLs", async () => {
    const html =
      '<article data-automation="reviewCard" data-review-id="bad"><p data-review-text>Broken.</p></article>' +
      '<article data-automation="reviewCard" data-review-id="good"><span data-rating="4"></span>' +
      '<a data-reviewer-profile href="https://www.tripadvisor.com/Profile/guest?token=private">Guest</a>' +
      "<p data-review-text>Good.</p></article>";
    const parsed = await new TripadvisorParser().parse(
      new FixturePage(html),
      "https://www.tripadvisor.com/Hotel_Review-g1-d1-Reviews-Example.html?token=private",
    );

    expect(parsed).toHaveLength(1);
    expect(parsed[0]?.sourceUrl).toBe(
      "https://www.tripadvisor.com/Hotel_Review-g1-d1-Reviews-Example.html",
    );
    expect(parsed[0]?.authorProfileUrl).toBe(
      "https://www.tripadvisor.com/Profile/guest",
    );
  });

  it("maps the parsed review to deterministic canonical JSON", async () => {
    const parsed = await new TripadvisorParser().parse(
      await pageFromFixture(),
      "https://www.tripadvisor.com/Hotel_Review-g1-d1-Reviews-Example.html",
    );
    const mapped = new TripadvisorMapper().map(
      parsed[0]!,
      {
        url: "https://www.tripadvisor.com/Hotel_Review-g1-d1-Reviews-Example.html",
        hotel: { name: "Example Hotel" },
      },
      new Date("2026-06-20T12:00:00.000Z"),
    );
    expect(mapped).toMatchObject({
      source: "tripadvisor",
      externalReviewId: "ta-review-001",
      rating: { value: 5, scale: 5 },
      hotel: { name: "Example Hotel" },
      sourceMetadata: {
        sourceUrl:
          "https://www.tripadvisor.com/Hotel_Review-g1-d1-Reviews-Example.html",
        crawlerVersion: "1.0.0",
        schemaVersion: "1.0.0",
      },
    });
  });
});

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { GoogleMapper } from "../src/GoogleMapper.js";
import { GoogleParser } from "../src/GoogleParser.js";
import { FixturePage } from "./fixturePage.js";

async function fixture(name: string): Promise<string> {
  return readFile(
    resolve(process.cwd(), `packages/connectors/google/tests/fixtures/${name}`),
    "utf8",
  );
}

describe("GoogleParser", () => {
  it("parses and normalizes a standard review", async () => {
    const page = new FixturePage(await fixture("basic.html"));
    const parsed = await new GoogleParser().parse(page, page.url());

    expect(parsed.reviews).toHaveLength(1);
    expect(parsed.reviews[0]).toMatchObject({
      externalReviewId: "example-review-001",
      rawRating: "5 stars",
      comment: "The room was clean and the staff were helpful.",
      title: "Excellent stay",
      authorName: "Example Guest",
      rawDate: "2025-03-10",
      businessReply: "Thank you for your feedback.",
    });
  });

  it("handles absent optional fields and maps to the canonical contract", async () => {
    const page = new FixturePage(await fixture("missing-fields.html"));
    const parser = new GoogleParser();
    const parsed = await parser.parse(page, page.url());
    const mapped = new GoogleMapper().map(
      parsed.reviews[0]!,
      { url: page.url(), hotel: { name: parsed.hotelName } },
      new Date("2025-05-01T12:00:00.000Z"),
    );

    expect(mapped.rating).toEqual({ value: 4, scale: 5 });
    expect(mapped.comment).toBe("Nice location.");
    expect(mapped.hotel.name).toBe("Example Hotel");
    expect(mapped.author).toBeUndefined();
    expect(mapped.reviewDate).toBeUndefined();
  });

  it("parses the observed Maps card markup and maps its localized date", async () => {
    const page = new FixturePage(await fixture("live-review-card.html"));
    const parsed = await new GoogleParser().parse(page, page.url());
    const mapped = new GoogleMapper().map(
      parsed.reviews[0]!,
      { url: page.url() },
      new Date("2025-05-01T12:00:00.000Z"),
    );

    expect(parsed.reviews).toHaveLength(1);
    expect(parsed.reviews[0]).toMatchObject({
      externalReviewId: "stable-review-key",
      rawRating: "5/5",
      comment: "إقامة مريحة.",
      authorName: "Example Guest",
      rawDate: "قبل شهر",
      language: "ar",
    });
    expect(mapped.reviewDate).toBe("2025-04-01T12:00:00.000Z");
  });

  it("skips malformed cards without a usable rating", async () => {
    const page = new FixturePage(
      '<html><body><h1>Example Hotel</h1><article data-review-id="bad"><span data-review-text>Incomplete</span></article></body></html>',
    );
    const parsed = await new GoogleParser().parse(page, page.url());

    expect(parsed.reviews).toEqual([]);
    expect(parsed.skippedReviews).toBe(1);
  });

  it("generates the same fallback identifier from stable review fields", async () => {
    const html =
      '<html><body><article data-review-card><span data-rating aria-label="4 stars"></span><span data-review-text>Consistent review</span><span data-review-author>Example Guest</span></article></body></html>';
    const parser = new GoogleParser();
    const first = await parser.parse(
      new FixturePage(html),
      "https://www.google.com/maps/place/example",
    );
    const second = await parser.parse(
      new FixturePage(html),
      "https://www.google.com/maps/place/example",
    );

    expect(first.reviews[0]?.externalReviewId).toBe(
      second.reviews[0]?.externalReviewId,
    );
    expect(first.reviews[0]?.externalReviewId).toMatch(/^google-[a-f0-9]{64}$/);
  });

  it("keeps content-derived fallback identifiers stable when card order changes", async () => {
    const firstCard =
      '<article data-review-card><span data-rating aria-label="4 stars"></span><span data-review-text>First review.</span></article>';
    const secondCard =
      '<article data-review-card><span data-rating aria-label="4 stars"></span><span data-review-text>Second review.</span></article>';
    const parser = new GoogleParser();
    const first = await parser.parse(
      new FixturePage(`<html><body>${firstCard}${secondCard}</body></html>`),
      "https://www.google.com/maps/place/example",
    );
    const reversed = await parser.parse(
      new FixturePage(`<html><body>${secondCard}${firstCard}</body></html>`),
      "https://www.google.com/maps/place/example",
    );
    const firstIds = new Map(
      first.reviews.map((review) => [review.comment, review.externalReviewId]),
    );
    const reversedIds = new Map(
      reversed.reviews.map((review) => [
        review.comment,
        review.externalReviewId,
      ]),
    );

    expect(firstIds).toEqual(reversedIds);
    expect(new Set(firstIds.values()).size).toBe(2);
  });

  it("uses a stable review permalink before hashing review fields", async () => {
    const firstHtml =
      '<html><body><article data-review-card><span data-rating aria-label="4 stars"></span><span data-review-text>First wording</span><a href="/maps/reviews/review-123">Review</a></article></body></html>';
    const updatedHtml =
      '<html><body><article data-review-card><span data-rating aria-label="4 stars"></span><span data-review-text>Edited wording</span><a href="/maps/reviews/review-123">Review</a></article></body></html>';
    const parser = new GoogleParser();
    const first = await parser.parse(
      new FixturePage(firstHtml),
      "https://www.google.com/maps/place/example",
    );
    const updated = await parser.parse(
      new FixturePage(updatedHtml),
      "https://www.google.com/maps/place/example",
    );

    expect(first.reviews[0]?.externalReviewId).toBe(
      updated.reviews[0]?.externalReviewId,
    );
  });
});

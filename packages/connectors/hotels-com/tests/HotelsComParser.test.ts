import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { FixturePage } from "../../google/tests/fixturePage.js";
import { HotelsComMapper } from "../src/HotelsComMapper.js";
import { HotelsComParser } from "../src/HotelsComParser.js";
import { normalizeHotelsComRating } from "../src/HotelsComRating.js";

const sourceUrl = "https://www.hotels.com/ho12345/example-hotel/";
const fixture = new URL("./fixtures/review-cards.html", import.meta.url);

async function pageFromFixture(): Promise<FixturePage> {
  return new FixturePage(await readFile(fixture, "utf8"));
}

describe("HotelsComParser", () => {
  it("parses review details and explicit or deterministic IDs", async () => {
    const parsed = await new HotelsComParser().parse(
      await pageFromFixture(),
      sourceUrl,
    );

    expect(parsed).toHaveLength(2);
    expect(parsed[0]).toMatchObject({
      externalReviewId: "hotels-review-001",
      rawRating: "9.4 out of 10",
      title: "Excellent visit",
      comment: "Great service and a comfortable room.",
      authorName: "Morgan Example",
      rawDate: "June 15, 2026",
      language: "en",
      businessReply: "Thank you for your feedback.",
      sourceUrl,
    });
    expect(parsed[1]?.externalReviewId).toMatch(/^hotels-com-/);
  });

  it("creates deterministic fallback IDs from stable fields", async () => {
    const html =
      '<article data-stid="review-card"><div data-stid="review-rating">8</div>' +
      '<p data-stid="review-text">Quiet and clean.</p></article>';
    const first = await new HotelsComParser().parse(
      new FixturePage(html),
      sourceUrl,
    );
    const second = await new HotelsComParser().parse(
      new FixturePage(html),
      sourceUrl,
    );
    const otherHotel = await new HotelsComParser().parse(
      new FixturePage(html),
      "https://www.hotels.com/ho9876/another-hotel/",
    );

    expect(first[0]?.externalReviewId).toMatch(/^hotels-com-/);
    expect(first[0]?.externalReviewId).toBe(second[0]?.externalReviewId);
    expect(first[0]?.externalReviewId).not.toBe(
      otherHotel[0]?.externalReviewId,
    );
  });

  it("normalizes ten-point scores and skips invalid review cards", async () => {
    const html =
      '<article data-stid="review-card"><div data-stid="review-rating">11</div>' +
      '<p data-stid="review-text">Invalid score.</p></article>';
    expect(
      await new HotelsComParser().parse(new FixturePage(html), sourceUrl),
    ).toEqual([]);
    expect(normalizeHotelsComRating("9.4 out of 10")).toEqual({
      value: 4.7,
      scale: 5,
    });
    expect(normalizeHotelsComRating("4 out of 5")).toEqual({
      value: 4,
      scale: 5,
    });
    expect(normalizeHotelsComRating("11")).toBeUndefined();
  });

  it("removes query data from source and author profile URLs", async () => {
    const html =
      '<article data-stid="review-card" data-review-id="r1">' +
      '<div data-stid="review-rating">8</div>' +
      '<a data-stid="reviewer-profile" href="/profile/guest?token=fixture">Guest</a>' +
      '<p data-stid="review-text">Pleasant stay.</p></article>';
    const parsed = await new HotelsComParser().parse(
      new FixturePage(html),
      `${sourceUrl}?token=fixture`,
    );

    expect(parsed[0]?.sourceUrl).toBe(sourceUrl);
    expect(parsed[0]?.authorProfileUrl).toBe(
      "https://www.hotels.com/profile/guest",
    );
  });

  it("maps parsed review data to canonical schema", async () => {
    const parsed = await new HotelsComParser().parse(
      await pageFromFixture(),
      sourceUrl,
    );
    const mapped = new HotelsComMapper().map(
      parsed[0]!,
      { url: sourceUrl, hotel: { name: "Example Hotel" } },
      new Date("2026-06-20T12:00:00.000Z"),
    );

    expect(mapped).toMatchObject({
      source: "hotels-com",
      externalReviewId: "hotels-review-001",
      rating: { value: 4.7, scale: 5 },
      hotel: { name: "Example Hotel", url: sourceUrl },
      language: "en",
      businessReply: { text: "Thank you for your feedback." },
    });
    expect(Date.parse(mapped.reviewDate ?? "")).not.toBeNaN();
  });
});

import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { FixturePage } from "../../google/tests/fixturePage.js";
import { ExpediaMapper } from "../src/ExpediaMapper.js";
import { ExpediaParser } from "../src/ExpediaParser.js";
import { normalizeExpediaRating } from "../src/ExpediaRating.js";

const sourceUrl =
  "https://www.expedia.com/New-York-Hotels-Example.h123.Hotel-Information";
const fixture = new URL("./fixtures/review-cards.html", import.meta.url);

async function pageFromFixture(): Promise<FixturePage> {
  return new FixturePage(await readFile(fixture, "utf8"));
}

describe("ExpediaParser", () => {
  it("parses review fields and uses explicit or deterministic IDs", async () => {
    const parsed = await new ExpediaParser().parse(
      await pageFromFixture(),
      sourceUrl,
    );

    expect(parsed).toHaveLength(2);
    expect(parsed[0]).toMatchObject({
      externalReviewId: "expedia-review-001",
      rawRating: "9.2 out of 10",
      title: "A lovely stay",
      comment: "The room was comfortable and the location was ideal.",
      authorName: "Taylor Example",
      rawDate: "June 12, 2026",
      language: "en",
      businessReply: "Thank you for sharing your experience.",
      sourceUrl,
    });
    expect(parsed[1]?.externalReviewId).toMatch(/^expedia-/);
  });

  it("builds stable fallback IDs from review fields and hotel URL", async () => {
    const html =
      '<article data-stid="review-card"><div data-stid="review-rating">8</div>' +
      '<p data-stid="review-text">Quiet and clean.</p></article>';
    const first = await new ExpediaParser().parse(
      new FixturePage(html),
      sourceUrl,
    );
    const second = await new ExpediaParser().parse(
      new FixturePage(html),
      sourceUrl,
    );
    const differentHotel = await new ExpediaParser().parse(
      new FixturePage(html),
      "https://www.expedia.com/Paris-Hotels-Other.h456.Hotel-Information",
    );

    expect(first[0]?.externalReviewId).toMatch(/^expedia-/);
    expect(first[0]?.externalReviewId).toBe(second[0]?.externalReviewId);
    expect(first[0]?.externalReviewId).not.toBe(
      differentHotel[0]?.externalReviewId,
    );
  });

  it("skips invalid scores and normalizes Expedia's ten-point scale", async () => {
    const html =
      '<article data-stid="review-card"><div data-stid="review-rating">11</div>' +
      '<p data-stid="review-text">Invalid score.</p></article>';
    expect(
      await new ExpediaParser().parse(new FixturePage(html), sourceUrl),
    ).toEqual([]);
    expect(normalizeExpediaRating("9.2 out of 10")).toEqual({
      value: 4.6,
      scale: 5,
    });
    expect(normalizeExpediaRating("4 out of 5")).toEqual({
      value: 4,
      scale: 5,
    });
    expect(normalizeExpediaRating("11")).toBeUndefined();
  });

  it("strips query data from source and author profile URLs", async () => {
    const html =
      '<article data-stid="review-card" data-review-id="r1">' +
      '<div data-stid="review-rating">8</div>' +
      '<a data-stid="reviewer-profile" href="/profile/guest?token=fixture">Guest</a>' +
      '<p data-stid="review-text">Pleasant stay.</p></article>';
    const parsed = await new ExpediaParser().parse(
      new FixturePage(html),
      `${sourceUrl}?token=fixture`,
    );

    expect(parsed[0]?.sourceUrl).toBe(sourceUrl);
    expect(parsed[0]?.authorProfileUrl).toBe(
      "https://www.expedia.com/profile/guest",
    );
  });

  it("maps a parsed review to canonical schema", async () => {
    const parsed = await new ExpediaParser().parse(
      await pageFromFixture(),
      sourceUrl,
    );
    const mapped = new ExpediaMapper().map(
      parsed[0]!,
      { url: sourceUrl, hotel: { name: "Example Hotel" } },
      new Date("2026-06-20T12:00:00.000Z"),
    );

    expect(mapped).toMatchObject({
      source: "expedia",
      externalReviewId: "expedia-review-001",
      rating: { value: 4.6, scale: 5 },
      hotel: { name: "Example Hotel", url: sourceUrl },
      language: "en",
      businessReply: { text: "Thank you for sharing your experience." },
    });
    expect(Date.parse(mapped.reviewDate ?? "")).not.toBeNaN();
  });
});

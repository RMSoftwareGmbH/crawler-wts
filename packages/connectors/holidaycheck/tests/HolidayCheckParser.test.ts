import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { FixturePage } from "../../google/tests/fixturePage.js";
import { HolidayCheckMapper } from "../src/HolidayCheckMapper.js";
import { HolidayCheckParser } from "../src/HolidayCheckParser.js";
import { normalizeHolidayCheckRating } from "../src/HolidayCheckRating.js";

const sourceUrl = "https://www.holidaycheck.de/hi/beispielhotel/abc123";
const fixture = new URL("./fixtures/review-cards.html", import.meta.url);

async function pageFromFixture(): Promise<FixturePage> {
  return new FixturePage(await readFile(fixture, "utf8"));
}

describe("HolidayCheckParser", () => {
  it("parses review details and explicit or deterministic IDs", async () => {
    const parsed = await new HolidayCheckParser().parse(
      await pageFromFixture(),
      sourceUrl,
    );

    expect(parsed).toHaveLength(2);
    expect(parsed[0]).toMatchObject({
      externalReviewId: "holidaycheck-review-001",
      rawRating: "5,5 von 6",
      title: "Sehr schöner Aufenthalt",
      comment: "Das Zimmer war sauber und das Personal freundlich.",
      authorName: "Alex Beispiel",
      rawDate: "2026-06-12",
      language: "de",
      businessReply: "Vielen Dank für Ihre Bewertung.",
      sourceUrl,
    });
    expect(parsed[1]?.externalReviewId).toMatch(/^holidaycheck-/);
  });

  it("creates deterministic fallback IDs from stable fields, not positions", async () => {
    const html =
      '<article data-testid="review-card"><span data-testid="review-rating">5,0</span>' +
      '<p data-testid="review-text">Ruhig und sauber.</p></article>';
    const first = await new HolidayCheckParser().parse(
      new FixturePage(html),
      sourceUrl,
    );
    const second = await new HolidayCheckParser().parse(
      new FixturePage(html),
      sourceUrl,
    );
    const anotherHotel = await new HolidayCheckParser().parse(
      new FixturePage(html),
      "https://www.holidaycheck.de/hi/anderes-hotel/xyz456",
    );

    expect(first[0]?.externalReviewId).toMatch(/^holidaycheck-/);
    expect(first[0]?.externalReviewId).toBe(second[0]?.externalReviewId);
    expect(first[0]?.externalReviewId).not.toBe(
      anotherHotel[0]?.externalReviewId,
    );
  });

  it("normalizes the six-point scale and rejects invalid ratings", async () => {
    const html =
      '<article data-testid="review-card"><span data-testid="review-rating">7 von 6</span>' +
      '<p data-testid="review-text">Invalid rating.</p></article>';
    expect(
      await new HolidayCheckParser().parse(new FixturePage(html), sourceUrl),
    ).toEqual([]);
    expect(normalizeHolidayCheckRating("5,5 von 6")).toEqual({
      value: 4.58,
      scale: 5,
    });
    expect(normalizeHolidayCheckRating("4.5 out of 5")).toEqual({
      value: 4.5,
      scale: 5,
    });
    expect(normalizeHolidayCheckRating("7")).toBeUndefined();
  });

  it("removes query data from source and author profile URLs", async () => {
    const html =
      '<article data-testid="review-card" data-review-id="r1">' +
      '<span data-testid="review-rating">5 von 6</span>' +
      '<a data-testid="reviewer-profile" href="/user/guest?token=fixture">Gast</a>' +
      '<p data-testid="review-text">Schön.</p></article>';
    const parsed = await new HolidayCheckParser().parse(
      new FixturePage(html),
      `${sourceUrl}?token=fixture`,
    );

    expect(parsed[0]?.sourceUrl).toBe(sourceUrl);
    expect(parsed[0]?.authorProfileUrl).toBe(
      "https://www.holidaycheck.de/user/guest",
    );
  });

  it("maps a parsed review to canonical review fields", async () => {
    const parsed = await new HolidayCheckParser().parse(
      await pageFromFixture(),
      sourceUrl,
    );
    const mapped = new HolidayCheckMapper().map(
      parsed[0]!,
      { url: sourceUrl, hotel: { name: "Beispielhotel" } },
      new Date("2026-06-20T12:00:00.000Z"),
    );

    expect(mapped).toMatchObject({
      source: "holidaycheck",
      externalReviewId: "holidaycheck-review-001",
      rating: { value: 4.58, scale: 5 },
      hotel: { name: "Beispielhotel", url: sourceUrl },
      language: "de",
      businessReply: { text: "Vielen Dank für Ihre Bewertung." },
    });
    expect(Date.parse(mapped.reviewDate ?? "")).not.toBeNaN();
  });
});

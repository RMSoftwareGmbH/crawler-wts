import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { FixturePage } from "../../google/tests/fixturePage.js";
import { BookingMapper } from "../src/BookingMapper.js";
import { BookingParser } from "../src/BookingParser.js";
import { normalizeBookingRating } from "../src/BookingRating.js";

const sourceUrl = "https://www.booking.com/hotel/us/example-hotel.html";
const fixture = new URL("./fixtures/review-cards.html", import.meta.url);

async function pageFromFixture(): Promise<FixturePage> {
  return new FixturePage(await readFile(fixture, "utf8"));
}

describe("BookingParser", () => {
  it("parses review fields and retains explicit stable IDs", async () => {
    const parsed = await new BookingParser().parse(
      await pageFromFixture(),
      sourceUrl,
    );

    expect(parsed).toHaveLength(2);
    expect(parsed[0]).toMatchObject({
      externalReviewId: "booking-review-001",
      rawRating: "9.2",
      title: "Wonderful stay",
      comment: "The room was clean and staff were helpful.",
      authorName: "Casey Example",
      rawDate: "12 June 2026",
      language: "en",
      businessReply: "Thank you for your review.",
      sourceUrl,
    });
    expect(parsed[1]?.externalReviewId).toMatch(/^booking-/);
  });

  it("builds deterministic fallback IDs from stable fields, not card position", async () => {
    const html =
      '<article data-testid="review-card"><div data-testid="review-score">8</div>' +
      '<p data-testid="review-text">Quiet and comfortable.</p></article>';
    const first = await new BookingParser().parse(
      new FixturePage(html),
      sourceUrl,
    );
    const second = await new BookingParser().parse(
      new FixturePage(html),
      sourceUrl,
    );
    const anotherHotel = await new BookingParser().parse(
      new FixturePage(html),
      "https://www.booking.com/hotel/fr/another-hotel.html",
    );

    expect(first[0]?.externalReviewId).toMatch(/^booking-/);
    expect(first[0]?.externalReviewId).toBe(second[0]?.externalReviewId);
    expect(first[0]?.externalReviewId).not.toBe(
      anotherHotel[0]?.externalReviewId,
    );
  });

  it("skips invalid or unstable rating-only cards", async () => {
    const html =
      '<article data-testid="review-card"><div data-testid="review-score">11</div>' +
      '<p data-testid="review-text">Invalid score.</p></article>' +
      '<article data-testid="review-card"><div data-testid="review-score">8</div></article>';
    expect(
      await new BookingParser().parse(new FixturePage(html), sourceUrl),
    ).toEqual([]);
    expect(normalizeBookingRating("9.2")).toEqual({
      value: 4.6,
      scale: 5,
    });
    expect(normalizeBookingRating("4.5 out of 5")).toEqual({
      value: 4.5,
      scale: 5,
    });
    expect(normalizeBookingRating("11")).toBeUndefined();
  });

  it("strips query data from review and author URLs", async () => {
    const html =
      '<article data-testid="review-card" data-review-id="review-1">' +
      '<div data-testid="review-score">9</div>' +
      '<a data-testid="reviewer-profile" href="/profile/guest?token=fixture">Guest</a>' +
      '<p data-testid="review-text">Pleasant stay.</p></article>';
    const parsed = await new BookingParser().parse(
      new FixturePage(html),
      `${sourceUrl}?token=fixture`,
    );

    expect(parsed[0]?.sourceUrl).toBe(sourceUrl);
    expect(parsed[0]?.authorProfileUrl).toBe(
      "https://www.booking.com/profile/guest",
    );
  });

  it("maps Booking's ten-point rating and optional fields to canonical review", async () => {
    const parsed = await new BookingParser().parse(
      await pageFromFixture(),
      sourceUrl,
    );
    const mapped = new BookingMapper().map(
      parsed[0]!,
      { url: sourceUrl, hotel: { name: "Example Hotel" } },
      new Date("2026-06-20T12:00:00.000Z"),
    );

    expect(mapped).toMatchObject({
      source: "booking",
      externalReviewId: "booking-review-001",
      rating: { value: 4.6, scale: 5 },
      hotel: { name: "Example Hotel", url: sourceUrl },
      language: "en",
      businessReply: { text: "Thank you for your review." },
    });
    expect(Date.parse(mapped.reviewDate ?? "")).not.toBeNaN();
  });
});

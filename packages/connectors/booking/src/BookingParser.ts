import { createHash } from "node:crypto";
import type {
  CrawlerLocator,
  CrawlerPage,
} from "../../../crawler-core/src/browser/pageFactory.js";
import {
  normalizeLanguage,
  normalizeText,
} from "../../../crawler-normalization/src/index.js";
import { normalizeBookingRating } from "./BookingRating.js";
import {
  BookingSelectors as S,
  bookingSelectorList,
} from "./BookingSelectors.js";

export interface ParsedBookingReview {
  externalReviewId: string;
  rawRating: string;
  title?: string;
  comment?: string;
  authorName?: string;
  authorProfileUrl?: string;
  rawDate?: string;
  language?: string;
  businessReply?: string;
  sourceUrl: string;
}

async function firstText(
  root: CrawlerLocator,
  selectors: readonly string[],
): Promise<string | undefined> {
  for (const selector of selectors) {
    const locator = root.locator(selector).first();
    if ((await locator.count()) > 0) {
      const text = normalizeText(await locator.innerText());
      if (text) return text;
    }
  }
  return undefined;
}

async function firstAttribute(
  root: CrawlerLocator,
  selectors: readonly string[],
  attribute: string,
): Promise<string | undefined> {
  for (const selector of selectors) {
    const locator = root.locator(selector).first();
    if ((await locator.count()) > 0) {
      const value = normalizeText(
        (await locator.getAttribute(attribute)) ?? "",
      );
      if (value) return value;
    }
  }
  return undefined;
}

function publicUrl(
  value: string | undefined,
  baseUrl: string,
): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value, baseUrl);
    url.username = "";
    url.password = "";
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return undefined;
  }
}

function fallbackId(
  review: Omit<ParsedBookingReview, "externalReviewId">,
): string | undefined {
  if (
    !review.title &&
    !review.comment &&
    !review.authorName &&
    !review.rawDate
  ) {
    return undefined;
  }
  const stableFields = [
    review.sourceUrl,
    review.authorName,
    review.rawDate,
    review.title,
    review.comment,
    review.rawRating,
  ]
    .map((value) => normalizeText(value) ?? "")
    .join("|");
  return `booking-${createHash("sha256").update(stableFields).digest("hex").slice(0, 24)}`;
}

export class BookingParser {
  async parse(
    page: CrawlerPage,
    sourceUrl = page.url(),
  ): Promise<ParsedBookingReview[]> {
    const sanitizedSourceUrl = publicUrl(sourceUrl, sourceUrl);
    if (!sanitizedSourceUrl) return [];

    const cards = page.locator(bookingSelectorList(S.reviewCards));
    const parsed: ParsedBookingReview[] = [];
    for (let index = 0; index < (await cards.count()); index += 1) {
      const card = cards.nth(index);
      if (!(await card.isVisible())) continue;

      const rawRating =
        (await firstAttribute(card, S.rating, "aria-label")) ??
        (await firstAttribute(card, S.rating, "data-score")) ??
        (await firstAttribute(card, S.rating, "data-rating")) ??
        (await firstText(card, S.rating));
      if (!rawRating || !normalizeBookingRating(rawRating)) continue;

      const fields: Omit<ParsedBookingReview, "externalReviewId"> = {
        rawRating,
        title: await firstText(card, S.title),
        comment: await firstText(card, S.comment),
        authorName: await firstText(card, S.author),
        authorProfileUrl: publicUrl(
          await firstAttribute(card, S.authorProfile, "href"),
          sanitizedSourceUrl,
        ),
        rawDate: (await firstText(card, S.date))?.replace(
          /^(?:reviewed|date of review)\s*:?\s*/i,
          "",
        ),
        language: normalizeLanguage(
          await firstAttribute(card, S.language, "lang"),
        ),
        businessReply: await firstText(card, S.businessReply),
        sourceUrl: sanitizedSourceUrl,
      };

      const explicitId =
        normalizeText((await card.getAttribute("data-review-id")) ?? "") ??
        normalizeText((await card.getAttribute("data-reviewid")) ?? "") ??
        (await firstAttribute(card, S.reviewId, "data-review-id")) ??
        (await firstAttribute(card, S.reviewId, "data-reviewid"));
      const externalReviewId = explicitId ?? fallbackId(fields);
      if (externalReviewId) parsed.push({ ...fields, externalReviewId });
    }
    return parsed;
  }
}

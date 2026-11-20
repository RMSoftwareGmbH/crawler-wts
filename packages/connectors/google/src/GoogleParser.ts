import type {
  CrawlerLocator,
  CrawlerPage,
} from "../../../crawler-core/src/browser/pageFactory.js";
import {
  createFallbackReviewId,
  normalizeRating,
  normalizeText,
} from "../../../crawler-normalization/src/index.js";
import { GoogleSelectors, selectorList } from "./GoogleSelectors.js";

const exactFractionRatingPattern = /^\d+(?:[.,]\d+)?\s*\/\s*\d+(?:[.,]\d+)?$/;
const relativeDatePattern =
  /^(?:today|yesterday|\d+\s+(?:days?|weeks?|months?|years?)\s+ago|il y a\s+\d+\s+(?:jours?|semaines?|mois|ans?|années?)|(?:قبل|منذ)\s*(?:[0-9٠-٩]+\s*)?(?:يوم|أيام|أسبوع|أسابيع|شهر|أشهر|سنة|سنوات))/i;

export interface ParsedGoogleReview {
  externalReviewId: string;
  sourceUrl?: string;
  rawRating: string;
  title?: string;
  comment?: string;
  authorName?: string;
  authorProfileUrl?: string;
  rawDate?: string;
  language?: string;
  businessReply?: string;
}

export interface GoogleParseResult {
  reviews: ParsedGoogleReview[];
  skippedReviews: number;
  hotelName?: string;
  stoppedAtLastSeenReviewId?: boolean;
}

export interface GoogleParserOptions {
  lastSeenReviewId?: string;
  persistedReviewIds?: readonly string[];
}

async function firstText(
  card: CrawlerLocator,
  selectors: readonly string[],
): Promise<string | undefined> {
  const locator = card.locator(selectorList(selectors)).first();
  if ((await locator.count()) === 0) {
    return undefined;
  }
  return normalizeText(await locator.innerText());
}

async function firstAttribute(
  card: CrawlerLocator,
  selectors: readonly string[],
  attribute: string,
): Promise<string | undefined> {
  const locator = card.locator(selectorList(selectors)).first();
  if ((await locator.count()) === 0) {
    return undefined;
  }
  return normalizeText(await locator.getAttribute(attribute));
}

async function firstRating(card: CrawlerLocator): Promise<string | undefined> {
  const ratings = card.locator(selectorList(GoogleSelectors.ratings));
  for (let index = 0; index < (await ratings.count()); index += 1) {
    const rating = ratings.nth(index);
    if (!(await rating.isVisible())) {
      continue;
    }
    for (const attribute of ["aria-label", "data-rating", "title"]) {
      const value = normalizeText(await rating.getAttribute(attribute));
      if (value && normalizeRating(value)) {
        return value;
      }
    }
    const text = normalizeText(await rating.innerText());
    if (text && exactFractionRatingPattern.test(text)) {
      return text;
    }
  }

  const textCandidates = card.locator(
    selectorList(GoogleSelectors.ratingTextCandidates),
  );
  for (let index = 0; index < (await textCandidates.count()); index += 1) {
    const candidate = textCandidates.nth(index);
    if (!(await candidate.isVisible())) {
      continue;
    }
    const text = normalizeText(await candidate.innerText());
    if (text && exactFractionRatingPattern.test(text)) {
      return text;
    }
  }
  return undefined;
}

function extractDateText(value: string | null | undefined): string | undefined {
  const text = normalizeText(value);
  if (!text) {
    return undefined;
  }
  if (/^\d{4}-\d{2}-\d{2}(?:[t\s].*)?$/i.test(text)) {
    return text;
  }
  return text.match(relativeDatePattern)?.[0];
}

async function firstDate(card: CrawlerLocator): Promise<string | undefined> {
  const dates = card.locator(selectorList(GoogleSelectors.dates));
  for (let index = 0; index < (await dates.count()); index += 1) {
    const date = dates.nth(index);
    if (!(await date.isVisible())) {
      continue;
    }
    for (const attribute of ["datetime", "data-review-date", "aria-label"]) {
      const value = extractDateText(await date.getAttribute(attribute));
      if (value) {
        return value;
      }
    }
    const value = extractDateText(await date.innerText());
    if (value) {
      return value;
    }
  }
  return undefined;
}

function publicUrl(
  value: string | undefined,
  baseUrl: string,
): string | undefined {
  if (!value) {
    return undefined;
  }
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

export class GoogleParser {
  async parse(
    page: CrawlerPage,
    hotelUrl: string,
    options: GoogleParserOptions = {},
  ): Promise<GoogleParseResult> {
    const cards = page.locator(selectorList(GoogleSelectors.reviewCards));
    const count = await cards.count();
    const reviews: ParsedGoogleReview[] = [];
    const persistedReviewIds = new Set(options.persistedReviewIds ?? []);
    let skippedReviews = 0;
    let stoppedAtLastSeenReviewId = false;

    for (let index = 0; index < count; index += 1) {
      const card = cards.nth(index);
      if (!(await card.isVisible())) {
        continue;
      }
      const stableId = await this.readReviewId(card);
      if (stableId && stableId === options.lastSeenReviewId) {
        stoppedAtLastSeenReviewId = true;
        break;
      }
      if (stableId && persistedReviewIds.has(stableId)) {
        continue;
      }
      const rawRating = await firstRating(card);

      if (!rawRating || !normalizeRating(rawRating)) {
        skippedReviews += 1;
        continue;
      }

      const comment = await firstText(card, GoogleSelectors.comments);
      const authorName = await firstText(card, GoogleSelectors.authors);
      const rawDate = await firstDate(card);
      const title = await firstText(card, GoogleSelectors.titles);
      const businessReply = await firstText(card, GoogleSelectors.replies);
      const profileHref = await firstAttribute(
        card,
        GoogleSelectors.authorLinks,
        "href",
      );
      const reviewHref = await firstAttribute(
        card,
        GoogleSelectors.reviewLinks,
        "href",
      );
      const sourceUrl = publicUrl(reviewHref, hotelUrl);
      const hasStableFallbackField = Boolean(
        sourceUrl || comment || authorName || rawDate,
      );
      // The shared fallback hashes stable review fields and the hotel URL; it never uses the array position.
      const externalReviewId =
        stableId ??
        (hasStableFallbackField
          ? createFallbackReviewId(hotelUrl, {
              ...(sourceUrl ? { reviewUrl: sourceUrl } : {}),
              rating: rawRating,
              comment,
              author: authorName,
              date: rawDate,
            })
          : undefined);

      if (
        options.lastSeenReviewId &&
        externalReviewId === options.lastSeenReviewId
      ) {
        stoppedAtLastSeenReviewId = true;
        break;
      }
      if (externalReviewId && persistedReviewIds.has(externalReviewId)) {
        continue;
      }
      if (!externalReviewId) {
        skippedReviews += 1;
        continue;
      }

      const authorProfileUrl = publicUrl(profileHref, hotelUrl);
      const language = await firstAttribute(card, ["[lang]"], "lang");
      reviews.push({
        externalReviewId,
        ...(sourceUrl ? { sourceUrl } : {}),
        rawRating,
        ...(title ? { title } : {}),
        ...(comment ? { comment } : {}),
        ...(authorName ? { authorName } : {}),
        ...(authorProfileUrl ? { authorProfileUrl } : {}),
        ...(rawDate ? { rawDate } : {}),
        ...(language ? { language } : {}),
        ...(businessReply ? { businessReply } : {}),
      });
    }

    const hotelHeading = page.locator("h1").first();
    const hotelName =
      (await hotelHeading.count()) > 0
        ? normalizeText(await hotelHeading.innerText())
        : undefined;

    return {
      reviews,
      skippedReviews,
      ...(stoppedAtLastSeenReviewId ? { stoppedAtLastSeenReviewId } : {}),
      ...(hotelName ? { hotelName } : {}),
    };
  }

  private async readReviewId(
    card: CrawlerLocator,
  ): Promise<string | undefined> {
    for (const attribute of GoogleSelectors.reviewIdAttributes) {
      const value = normalizeText(await card.getAttribute(attribute));
      if (value) {
        return value;
      }
    }
    return undefined;
  }
}
